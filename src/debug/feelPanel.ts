import type { StartedLevel } from '@client/app/levelSession';
import type { TestHost } from '@client/app/testHost';
import { type Feel, FeelSchema } from '@content/schemas/feel';
import {
  FEEL_WRITER_ENDPOINT,
  FEEL_WRITER_HEADER,
  FEEL_WRITER_HEADER_VALUE,
} from '@shared/constants';
import { log } from '@shared/log';
import { asSimMs } from '@shared/time';
import type { Sim } from '@sim';
import { Pane as TweakpanePane } from 'tweakpane';
import { z } from 'zod';
import {
  type ControlDescriptor,
  cleanNumber,
  describeFeelControls,
  getAtPath,
  isOverriddenKey,
  type JsonSchema,
  type LeafDescriptor,
  leafPatch,
  mergePatch,
  overrideLeafKeys,
  subtractPatch,
} from './feelControls.ts';
import { applyFeelPatch, effectiveFeel, layFeelPatch } from './feelPatch.ts';
import type { ButtonLike, FolderLike, PaneConstructor, PaneLike } from './tweakpaneTypes.ts';

const Pane = TweakpanePane as unknown as PaneConstructor;

/** The file the « Enregistrer » button writes; the `feel-writer` accepts no other. */
const FEEL_FILE = 'content/feel.json';
const NEXT_LEVEL_MARK = ' ⏭';
const OVERRIDE_MARK = ' ★';
const LEGEND = `${NEXT_LEVEL_MARK.trim()} next level · ${OVERRIDE_MARK.trim()} level override`;

type Holder = Record<string, unknown>;

interface PaneFactory {
  create(container: HTMLElement, title: string): PaneLike;
  /** Takes the adopted stylesheet back out of the document. */
  dispose(): void;
}

/**
 * Makes the panes of one panel in `doc`. Tweakpane embeds its stylesheet as a `<style>` element
 * (each pane appends it again if the page has none), which the playtest's CSP
 * (`default-src 'self'`) refuses; the CSP is not widened for a debug tool. So the `<style>` the
 * library appends is caught before it is inserted, for every pane, and its text is applied through
 * the CSSOM (`adoptedStyleSheets`), which the CSP does not restrict: one sheet per document, kept
 * until `dispose`. Where that API is missing the library does what it always does.
 */
function createPaneFactory(doc: Document): PaneFactory {
  const canAdopt = typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in doc;
  let sheet: CSSStyleSheet | null = null;
  return {
    create(container, title) {
      if (!canAdopt) return new Pane({ container, title });
      const head = doc.head;
      let css: string | null = null;
      const append = head.appendChild.bind(head);
      head.appendChild = (<T extends Node>(node: T): T => {
        if (node instanceof HTMLStyleElement && node.dataset.tpStyle !== undefined) {
          css = node.textContent;
          return node;
        }
        return append(node);
      }) as typeof head.appendChild;
      let pane: PaneLike;
      try {
        pane = new Pane({ container, title });
      } finally {
        // Our own property shadowed the prototype's method: dropping it gives the original back.
        delete (head as Partial<Node>).appendChild;
      }
      if (css !== null && sheet === null) {
        const adopted = new CSSStyleSheet();
        adopted.replaceSync(css);
        doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, adopted];
        sheet = adopted;
      }
      return pane;
    },
    dispose() {
      if (sheet === null) return;
      const adopted = sheet;
      sheet = null;
      doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((other) => other !== adopted);
    },
  };
}

export interface FeelPanelOptions {
  readonly host: TestHost;
  /** Where the pane is mounted (inside the overlay). */
  readonly container: HTMLElement;
  /** Default: the page's `fetch`. */
  readonly fetchFn?: typeof fetch;
  /**
   * Whether the overlay is open. While it is not, a level start does not rebuild the pane (nothing
   * runs when closed): it is rebuilt by {@link FeelPanel.rebuild}, which the overlay calls when it
   * opens. Default: always open.
   */
  readonly isOpen?: () => boolean;
}

export interface FeelPanel {
  /**
   * Builds the pane again from the sim's feel (its `world.feel` with the `SetFeel`s it still
   * holds) and the level's overrides: those of `started`, or of the running level when it is
   * omitted. The overlay calls it without argument when it opens; the panel itself passes the
   * `StartedLevel` it is told at a level start, where `levelSession.active` is still the
   * previous level (or `null`).
   */
  rebuild(started?: StartedLevel): void;
  dispose(): void;
}

/** What a hint or a folder note looks like with no help from the page's CSS (the CSSOM is not restricted by the CSP). */
function styleNote(element: HTMLElement): void {
  Object.assign(element.style, {
    fontSize: '10px',
    lineHeight: '1.3',
    opacity: '0.75',
    padding: '2px 6px 4px',
    whiteSpace: 'normal',
  });
}

/**
 * The feel panel (story 2.1): a Tweakpane pane generated from `z.toJSONSchema(FeelSchema)` and the
 * running level's feel (see `feelControls.ts`: nothing about the feel's shape is written here).
 * Tweakpane binds to a working copy, never to `world.feel`. When a change is final (`ev.last`, so a
 * slider drag sends one command) the one-leaf patch is checked by `applyFeelPatch` against the
 * feel the sim will have (`effectiveFeel`: the cross-field rules of the schema included); if it
 * passes it is sent as the journaled `SetFeel`, else the control goes back to its value and the
 * schema's message is shown (and logged). The pane is rebuilt from the sim's feel at each level
 * start while the overlay is open, and when the overlay opens.
 */
export function createFeelPanel(options: FeelPanelOptions): FeelPanel {
  const { host, container } = options;
  const doc = container.ownerDocument;
  const fetchFn = options.fetchFn ?? ((...args) => fetch(...args));
  const isOpen = options.isOpen ?? (() => true);
  const schema = z.toJSONSchema(FeelSchema) as JsonSchema;
  const paneFactory = createPaneFactory(doc);

  const status = doc.createElement('div');
  status.className = 'pp-debug-feel-status';
  const paneHost = doc.createElement('div');
  container.append(paneHost, status);

  let pane: PaneLike | null = null;
  /** The sim the pane was built for: a change is sent to it only while it is the running one. */
  let panelSim: Sim | null = null;
  /** The feel the pane showed last, for putting a control back when there is no sim to ask. */
  let lastKnown: Feel = host.levelSession.current.feel;
  /** The leaves changed since the last save, as one patch: what « Enregistrer » sends. */
  let unsaved: Record<string, unknown> = {};
  let saveButton: ButtonLike | null = null;
  let isSaving = false;
  /** True while the panel itself puts a control back: Tweakpane's `change` for that is not an edit. */
  let isRestoring = false;

  const say = (message: string): void => {
    status.textContent = message;
  };

  const refreshSaveButton = (): void => {
    if (saveButton !== null) saveButton.disabled = isSaving || Object.keys(unsaved).length === 0;
  };

  /** Puts the control back to `value`, without the change it makes being taken for an edit. */
  const restore = (
    holder: Holder,
    key: string,
    value: unknown,
    binding: { refresh(): void },
  ): void => {
    if (value === undefined) return;
    isRestoring = true;
    try {
      holder[key] = value;
      binding.refresh();
    } finally {
      isRestoring = false;
    }
  };

  /** A hint (or description) as text under its label; a tap on the label hides and shows it. */
  const addHint = (blade: HTMLElement, hint: string): void => {
    const note = doc.createElement('div');
    note.className = 'pp-debug-feel-hint';
    note.textContent = hint;
    styleNote(note);
    blade.after(note);
    const label = blade.querySelector('.tp-lblv_l') ?? blade;
    label.addEventListener('click', () => {
      note.hidden = !note.hidden;
    });
  };

  const addFolderNote = (folder: FolderLike, description: string): void => {
    const note = doc.createElement('div');
    note.className = 'pp-debug-feel-folder-note';
    note.textContent = description;
    styleNote(note);
    (folder.element.querySelector('.tp-fldv_c') ?? folder.element).prepend(note);
  };

  const addControl = (
    parent: FolderLike,
    descriptor: ControlDescriptor,
    working: unknown,
    overrideKeys: ReadonlySet<string>,
  ): void => {
    if (descriptor.kind === 'folder') {
      const folder = parent.addFolder({ title: descriptor.label, expanded: false });
      if (descriptor.hint !== '') addFolderNote(folder, descriptor.hint);
      for (const child of descriptor.children) addControl(folder, child, working, overrideKeys);
      return;
    }
    const holder = getAtPath(working, descriptor.path.slice(0, -1)) as Holder | undefined;
    const key = String(descriptor.path[descriptor.path.length - 1]);
    if (holder === undefined) return;
    const marks =
      (descriptor.isNextLevel ? NEXT_LEVEL_MARK : '') +
      (isOverriddenKey(descriptor.pathKey, overrideKeys) ? OVERRIDE_MARK : '');
    const label = `${descriptor.label}${marks}`;
    const params: Record<string, unknown> = { label };
    if (descriptor.kind === 'number') {
      if (descriptor.min !== undefined) params.min = descriptor.min;
      if (descriptor.max !== undefined) params.max = descriptor.max;
      if (descriptor.step !== undefined) params.step = descriptor.step;
    } else if (descriptor.kind === 'list') {
      params.options = Object.fromEntries(descriptor.options.map((option) => [option, option]));
    }
    const binding = parent.addBinding(holder, key, params);
    if (descriptor.hint !== '') addHint(binding.element, descriptor.hint);
    binding.on('change', (event) => {
      if (isRestoring || !event.last) return;
      const shown = apply(descriptor, event.value);
      // Back to the value in force (or the cleaned one), and the control shows it again.
      if (shown !== undefined) restore(holder, key, shown, binding);
    });
  };

  /**
   * Sends the change as `SetFeel` if it is valid. Returns the value the control must show when it
   * differs from what Tweakpane gave (the value in force after a refusal, the value without float
   * noise after an acceptance), or `undefined` when it is already right.
   */
  const apply = (descriptor: LeafDescriptor, value: unknown): unknown => {
    const { levelSession } = host;
    const active = levelSession.active;
    if (active === null || panelSim === null) {
      say('no level is running');
      return getAtPath(lastKnown, descriptor.path);
    }
    if (active.sim !== panelSim) {
      // The pane belongs to another level (it was not rebuilt, the overlay being closed).
      rebuild();
      say('the level changed: the panel was rebuilt, change it again');
      return undefined;
    }
    const sim = active.sim;
    const inForce = effectiveFeel(sim);
    lastKnown = inForce;
    if (sim.world.flow.state === 'ended') {
      say('the level has ended: the sim takes no more changes, start a level to tune');
      return getAtPath(inForce, descriptor.path);
    }
    const step = descriptor.kind === 'number' ? descriptor.step : undefined;
    const shown = typeof value === 'number' ? cleanNumber(value, step) : value;
    const patch = leafPatch(inForce, descriptor.path, value, step);
    const merged = applyFeelPatch(inForce, patch);
    if (!merged.ok) {
      say(merged.error.message);
      log.warn('debug', `feel panel: ${descriptor.pathKey} refused`, {
        reason: merged.error.message,
      });
      return getAtPath(inForce, descriptor.path);
    }
    sim.enqueue({ type: 'SetFeel', t: asSimMs(sim.world.time.sim), patch: patch as never });
    lastKnown = merged.value;
    // What is saved and kept for a restart is built over the feel without the level's overrides.
    const baseFeel = levelSession.current.feel;
    const savePatch = leafPatch(layFeelPatch(baseFeel, unsaved), descriptor.path, value, step);
    unsaved = mergePatch(unsaved, savePatch);
    refreshSaveButton();
    // The next restart keeps it too (the level's own overrides are merged over it again there).
    const kept = applyFeelPatch(baseFeel, leafPatch(baseFeel, descriptor.path, value, step));
    let suffix = descriptor.isNextLevel ? ' (next level)' : '';
    if (kept.ok) levelSession.rememberFeel(kept.value);
    else {
      log.warn('debug', `feel panel: ${descriptor.pathKey} not kept for a restart`, {
        reason: kept.error.message,
      });
      suffix += ' — will not survive a restart (the base feel refuses it)';
    }
    say(`sent ${descriptor.pathKey} = ${String(shown)}${suffix}`);
    return shown !== value ? shown : undefined;
  };

  const save = async (): Promise<void> => {
    if (isSaving || Object.keys(unsaved).length === 0) return;
    isSaving = true;
    refreshSaveButton();
    say('saving…');
    // What is sent now; edits made while the request is in flight stay for the next save.
    const sent = structuredClone(unsaved);
    try {
      const response = await fetchFn(FEEL_WRITER_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [FEEL_WRITER_HEADER]: FEEL_WRITER_HEADER_VALUE,
        },
        body: JSON.stringify({ file: FEEL_FILE, patch: sent }),
      });
      let body: { ok?: boolean; message?: string } = {};
      try {
        body = (await response.json()) as typeof body;
      } catch (cause) {
        log.warn('debug', 'feel panel: the feel-writer answered with something that is not JSON', {
          status: response.status,
          cause,
        });
      }
      if (response.ok && body.ok === true) {
        unsaved = subtractPatch(unsaved, sent);
        say(body.message ?? 'saved');
      } else {
        say(`not saved: ${body.message ?? response.status}`);
        log.warn('debug', 'feel panel: the feel-writer refused the save', {
          status: response.status,
          body,
        });
      }
    } catch (cause) {
      say('not saved: the dev server did not answer');
      log.warn('debug', 'feel panel: cannot reach the feel-writer', cause);
    } finally {
      isSaving = false;
      refreshSaveButton();
    }
  };

  const rebuild = (started?: StartedLevel): void => {
    pane?.dispose();
    pane = null;
    saveButton = null;
    paneHost.replaceChildren();
    // At a level start `levelSession.active` is not set yet: the argument is the truth.
    const running = host.levelSession.active;
    const sim = started?.sim ?? running?.sim ?? null;
    const level = started?.level ?? running?.level ?? null;
    panelSim = sim;
    const feel = sim === null ? host.levelSession.current.feel : effectiveFeel(sim);
    lastKnown = feel;
    const working = structuredClone(feel);
    const overrideKeys = new Set(overrideLeafKeys(level?.level.feelOverrides));
    const root = describeFeelControls(schema, feel);
    pane = paneFactory.create(paneHost, 'Feel');
    const legend = doc.createElement('div');
    legend.className = 'pp-debug-feel-legend';
    legend.textContent = LEGEND;
    paneHost.prepend(legend);
    for (const child of root.children) addControl(pane, child, working, overrideKeys);
    if (import.meta.env.DEV) {
      saveButton = pane.addButton({ title: 'Enregistrer' });
      saveButton.on('click', () => void save());
      refreshSaveButton();
    }
    say('');
  };

  const offStarted = host.onLevelStarted((started) => {
    // Nothing runs when closed: the overlay rebuilds the pane when it opens.
    if (!isOpen()) return;
    try {
      rebuild(started);
    } catch (cause) {
      // A debug tool must not take the game down (a throw here would send the app to Oops).
      log.warn('debug', 'feel panel: could not rebuild at the level start', cause);
    }
  });
  rebuild();

  return {
    rebuild,
    dispose() {
      offStarted();
      pane?.dispose();
      paneFactory.dispose();
      status.remove();
      paneHost.remove();
    },
  };
}
