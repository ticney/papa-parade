import type { TestHost } from '@client/app/testHost';
import { type Feel, FeelSchema } from '@content/schemas/feel';
import { FEEL_WRITER_ENDPOINT } from '@shared/constants';
import { log } from '@shared/log';
import { asSimMs } from '@shared/time';
import { Pane as TweakpanePane } from 'tweakpane';
import { z } from 'zod';
import {
  type ControlDescriptor,
  describeFeelControls,
  getAtPath,
  isOverriddenKey,
  type JsonSchema,
  type LeafDescriptor,
  leafPatch,
  mergePatch,
  overrideLeafKeys,
} from './feelControls.ts';
import { applyFeelPatch } from './feelPatch.ts';
import type { ButtonLike, FolderLike, PaneConstructor, PaneLike } from './tweakpaneTypes.ts';

const Pane = TweakpanePane as unknown as PaneConstructor;

/** The file the « Enregistrer » button writes; the `feel-writer` accepts no other. */
const FEEL_FILE = 'content/feel.json';
const NEXT_LEVEL_MARK = ' ⏭';
const OVERRIDE_MARK = ' ★';
const LEGEND = `${NEXT_LEVEL_MARK.trim()} next level · ${OVERRIDE_MARK.trim()} level override`;

type Holder = Record<string, unknown>;

/**
 * A Tweakpane `Pane` in `container`. Tweakpane embeds its stylesheet as a `<style>` element, which
 * the playtest's CSP (`default-src 'self'`) refuses; the CSP is not widened for a debug tool. So
 * the one `<style>` the library appends is caught before it is inserted and its text is applied
 * through the CSSOM (`adoptedStyleSheets`), which the CSP does not restrict. Where that API is
 * missing the library does what it always does.
 */
let hasAdoptedPaneStyle = false;
function createStyledPane(container: HTMLElement, title: string): PaneLike {
  const doc = container.ownerDocument;
  const canAdopt = typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in doc;
  if (!canAdopt || hasAdoptedPaneStyle) return new Pane({ container, title });
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
  if (css !== null) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
    hasAdoptedPaneStyle = true;
  }
  return pane;
}

export interface FeelPanelOptions {
  readonly host: TestHost;
  /** Where the pane is mounted (inside the overlay). */
  readonly container: HTMLElement;
  /** Default: the page's `fetch`. */
  readonly fetchFn?: typeof fetch;
}

export interface FeelPanel {
  /** Builds the pane again from the running sim's feel; the overlay does it when it opens. */
  rebuild(): void;
  dispose(): void;
}

/**
 * The feel panel (story 2.1): a Tweakpane pane generated from `z.toJSONSchema(FeelSchema)` and the
 * running level's feel (see `feelControls.ts`: nothing about the feel's shape is written here).
 * Tweakpane binds to a working copy, never to `world.feel`. When a change is final (`ev.last`, so a
 * slider drag sends one command) the one-leaf patch is checked by `applyFeelPatch` against the
 * feel as Geo has set it so far (the cross-field rules of the schema included); if it passes it is
 * sent as the journaled `SetFeel`, else the control goes back to its value and the schema's message
 * is shown (and logged). The pane is rebuilt from `world.feel` at each level start.
 */
export function createFeelPanel(options: FeelPanelOptions): FeelPanel {
  const { host, container } = options;
  const doc = container.ownerDocument;
  const fetchFn = options.fetchFn ?? ((...args) => fetch(...args));
  const schema = z.toJSONSchema(FeelSchema) as JsonSchema;

  const status = doc.createElement('div');
  status.className = 'pp-debug-feel-status';
  const paneHost = doc.createElement('div');
  container.append(paneHost, status);

  let pane: PaneLike | null = null;
  /** The feel as Geo has set it in this panel: every accepted change laid over the level's feel. */
  let intended: Feel | null = null;
  /** The leaves changed since the last save, as one patch: what « Enregistrer » sends. */
  let unsaved: Record<string, unknown> = {};
  let saveButton: ButtonLike | null = null;

  const say = (message: string): void => {
    status.textContent = message;
  };

  const addControl = (
    parent: FolderLike,
    descriptor: ControlDescriptor,
    working: unknown,
    overrideKeys: ReadonlySet<string>,
    depth: number,
  ): void => {
    if (descriptor.kind === 'folder') {
      const folder = parent.addFolder({ title: descriptor.label, expanded: false });
      for (const child of descriptor.children) {
        addControl(folder, child, working, overrideKeys, depth + 1);
      }
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
    if (descriptor.hint !== '') binding.element.title = descriptor.hint;
    binding.on('change', (event) => {
      if (!event.last) return;
      const accepted = apply(descriptor, event.value);
      if (accepted) return;
      // Back to the value in force, and the control shows it again.
      holder[key] = getAtPath(intended, descriptor.path);
      binding.refresh();
    });
  };

  /** Sends the change as `SetFeel` if it is valid; false (and a message) if not. */
  const apply = (descriptor: LeafDescriptor, value: unknown): boolean => {
    const active = host.levelSession.active;
    if (active === null || intended === null) {
      say('no level is running');
      return false;
    }
    const patch = leafPatch(intended, descriptor.path, value);
    const merged = applyFeelPatch(intended, patch);
    if (!merged.ok) {
      say(merged.error.message);
      log.warn('debug', `feel panel: ${descriptor.pathKey} refused`, {
        reason: merged.error.message,
      });
      return false;
    }
    active.sim.enqueue({
      type: 'SetFeel',
      t: asSimMs(active.sim.world.time.sim),
      patch: patch as never,
    });
    intended = merged.value;
    unsaved = mergePatch(unsaved, patch);
    // The next restart keeps it too (the level's own overrides are merged over it again there).
    const base = applyFeelPatch(host.levelSession.current.feel, patch);
    if (base.ok) host.levelSession.rememberFeel(base.value);
    if (saveButton !== null) saveButton.disabled = false;
    say(
      `sent ${descriptor.pathKey} = ${String(value)}${descriptor.isNextLevel ? ' (next level)' : ''}`,
    );
    return true;
  };

  const save = async (): Promise<void> => {
    say('saving…');
    try {
      const response = await fetchFn(FEEL_WRITER_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: FEEL_FILE, patch: unsaved }),
      });
      const body = (await response.json()) as { ok?: boolean; message?: string };
      if (response.ok && body.ok === true) {
        unsaved = {};
        if (saveButton !== null) saveButton.disabled = true;
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
    }
  };

  const rebuild = (): void => {
    pane?.dispose();
    pane = null;
    saveButton = null;
    paneHost.replaceChildren();
    const active = host.levelSession.active;
    const feel = active?.sim.world.feel ?? host.levelSession.current.feel;
    intended = structuredClone(feel);
    const working = structuredClone(feel);
    const overrideKeys = new Set(overrideLeafKeys(active?.level.level.feelOverrides));
    const root = describeFeelControls(schema, feel);
    pane = createStyledPane(paneHost, 'Feel');
    const legend = doc.createElement('div');
    legend.className = 'pp-debug-feel-legend';
    legend.textContent = LEGEND;
    paneHost.prepend(legend);
    for (const child of root.children) addControl(pane, child, working, overrideKeys, 0);
    if (import.meta.env.DEV) {
      saveButton = pane.addButton({ title: 'Enregistrer' });
      saveButton.disabled = Object.keys(unsaved).length === 0;
      saveButton.on('click', () => void save());
    }
    say('');
  };

  const offStarted = host.onLevelStarted(() => rebuild());
  rebuild();

  return {
    rebuild,
    dispose() {
      offStarted();
      pane?.dispose();
      status.remove();
      paneHost.remove();
    },
  };
}
