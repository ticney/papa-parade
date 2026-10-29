import type { TestHost } from '@client/app/testHost';
import {
  DEBUG_PANEL_REFRESH_MS,
  DEBUG_THREE_FINGER_COUNT,
  DEBUG_TIMELINE_ROWS,
  MIN_TIME_SCALE,
  UINT32_RANGE,
} from '@shared/constants';
import { log } from '@shared/log';
import type { Sim } from '@sim';
import {
  CHEATS,
  clampTimeScale,
  createCheatContext,
  createSkipToEnd,
  launchableThreats,
  launchThreat,
  levelHasFatigue,
  parseCheatNumber,
  parseSeed,
  refusalReason,
} from './cheats.ts';
import './debugOverlay.css';
import { createFeelPanel, type FeelPanel } from './feelPanel.ts';
import { guarded } from './guard.ts';
import { createDebugViews, DEBUG_VIEWS, type DebugView } from './navDebugView.ts';
import { createPerfPanel } from './perfPanel.ts';
import { createSoundBoard, type SoundBoard } from './soundBoard.ts';
import { createStateInspector } from './stateInspector.ts';
import { createTimingTimeline, type ResolvedEvent, type TimingTimeline } from './timingTimeline.ts';

export interface DebugOverlay {
  readonly isVisible: boolean;
  show(): void;
  hide(): void;
  toggle(): void;
  dispose(): void;
}

/** What the first opening builds (see `buildUi`). */
interface Ui {
  readonly root: HTMLElement;
  readonly timeline: TimingTimeline;
  show(): void;
  hide(): void;
  dispose(): void;
}

export interface DebugOverlayEnv {
  readonly document: Document;
  readonly window: Window;
  /** The real-time clock the loop measures with (`performance.now`). */
  readonly clock: () => number;
}

/**
 * Events the overlay keeps to itself: a key typed in a pane field or a press or drag on a panel is
 * not the game's. The releases (`pointerup`, `pointercancel`, `keyup`) are deliberately NOT here:
 * the game binds them on `window` to end a hold or a held movement key, and a release that stops
 * at the panel would leave the press stuck.
 */
const ISOLATED_EVENTS = ['keydown', 'keypress', 'pointerdown', 'pointermove'] as const;

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/**
 * The debug overlay (story 2.1): performance, the timing timeline, the world inspector, the debug
 * views, time controls and cheats, and the feel panel, in one scrolling column over the game. It is
 * hidden until `F1` or three fingers down at once toggle it (`DEBUG_THREE_FINGER_COUNT`), and while
 * hidden it measures nothing and redraws nothing. Everything it does to the game goes through a
 * command or the level session; it never writes the world. Pressing keys or touching inside it
 * stops at its root, so typing in a field never moves Papa or skips the Result screen. Closing it
 * puts back the pause and the time scale it found when it opened.
 */
export function createDebugOverlay(
  host: TestHost,
  env: DebugOverlayEnv = {
    document,
    window,
    clock: () => performance.now(),
  },
): DebugOverlay {
  const { document: doc, window: win } = env;

  /**
   * The responses so far, newest first, as copies (the sim reuses the events it hands out). The
   * timeline's rows are made the first time the overlay opens, so a response that came before is
   * not lost.
   */
  const recent: ResolvedEvent[] = [];
  let ui: Ui | null = null;
  const offResolved = host.onSimEvent(
    guarded('debug overlay: timeline', (event) => {
      if (event.type !== 'ResponseResolved') return;
      const copy: ResolvedEvent = { ...event, responseWindow: { ...event.responseWindow } };
      recent.unshift(copy);
      if (recent.length > DEBUG_TIMELINE_ROWS) recent.length = DEBUG_TIMELINE_ROWS;
      ui?.timeline.add(copy);
    }),
  );
  const offStartedTimeline = host.onLevelStarted(
    guarded('debug overlay: timeline reset', () => {
      recent.length = 0;
      ui?.timeline.clear();
    }),
  );

  /**
   * The overlay's DOM and panels. Built on the first opening only: until then the page holds none
   * of it (no hidden buttons for an audit of the player's controls to count, no cost at all).
   */
  function buildUi(onClose: () => void): Ui {
    const root = el(doc, 'div', 'pp-debug-overlay');
    root.hidden = true;
    root.dataset.debugOverlay = 'closed';
    for (const type of ISOLATED_EVENTS)
      root.addEventListener(type, (event) => event.stopPropagation());

    const header = el(doc, 'div', 'pp-debug-header');
    header.append(el(doc, 'strong', 'pp-debug-title', 'Debug'));
    const close = el(doc, 'button', 'pp-debug-button', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close the debug overlay');
    header.append(close);
    root.append(header);

    const sections = new Map<string, HTMLElement>();
    const section = (id: string, title: string, isOpen: boolean): HTMLElement => {
      const details = el(doc, 'details', 'pp-debug-section');
      details.open = isOpen;
      details.dataset.debugSection = id;
      details.append(el(doc, 'summary', 'pp-debug-summary', title));
      const body = el(doc, 'div', 'pp-debug-body');
      details.append(body);
      root.append(details);
      sections.set(id, details);
      return body;
    };

    // --- Performance, timeline ---
    const perf = createPerfPanel(host, section('perf', 'Performance', true), env.clock);
    const timeline = createTimingTimeline(section('timeline', 'Timing (last 10 responses)', true));
    for (const event of [...recent].reverse()) timeline.add(event);

    // --- Time controls and cheats ---
    const controls = section('controls', 'Time and cheats', true);
    const context = createCheatContext(host);
    const skip = createSkipToEnd(host, (callback) => win.requestAnimationFrame(callback));
    const status = el(doc, 'div', 'pp-debug-status');
    status.dataset.debug = 'status';
    const say = (message: string): void => {
      status.textContent = message;
    };
    const button = (parent: HTMLElement, label: string, id: string, onClick: () => void) => {
      const element = el(doc, 'button', 'pp-debug-button', label);
      element.type = 'button';
      element.dataset.debug = id;
      element.addEventListener('click', onClick);
      parent.append(element);
      return element;
    };
    const row = (): HTMLElement => {
      const element = el(doc, 'div', 'pp-debug-row');
      controls.append(element);
      return element;
    };

    /** What closing the overlay puts back: the pause wish and the sim's base time scale as they were when it opened. */
    let frozenAtShow = false;
    let scaleAtShow: { readonly sim: Sim; readonly value: number } | null = null;
    let hasScaleChanged = false;

    const timeRow = row();
    const pauseButton = button(timeRow, 'Pause', 'pause', () => {
      host.levelSession.freeze(!host.levelSession.isFrozen);
      syncControls();
    });
    button(timeRow, 'Step', 'step', () => {
      const reason = refusalReason(host);
      if (reason !== null) {
        say(`Step: ${reason}`);
        return;
      }
      try {
        host.levelSession.advance(1);
      } catch (cause) {
        say('Step: no level is running');
        log.warn('debug', 'overlay: no level to step', cause);
      }
      syncControls();
    });

    const scaleRow = row();
    scaleRow.append(el(doc, 'span', 'pp-debug-label', 'timeScale'));
    const scale = el(doc, 'input', 'pp-debug-range');
    scale.type = 'range';
    scale.min = String(MIN_TIME_SCALE);
    scale.max = '1';
    scale.step = '0.05';
    scale.value = '1';
    scale.dataset.debug = 'timeScale';
    const scaleText = el(doc, 'span', 'pp-debug-value', '1');
    const showScale = (value: number): void => {
      scale.value = String(value);
      scaleText.textContent = String(value);
    };
    const sendScale = (value: number): void => {
      const clamped = clampTimeScale(value);
      showScale(clamped);
      const reason = refusalReason(host);
      if (reason !== null) {
        say(`timeScale: ${reason}`);
        return;
      }
      context.send({ type: 'SetTimeScale', scale: clamped });
      if (scaleAtShow !== null && clamped !== scaleAtShow.value) hasScaleChanged = true;
      say(`timeScale = ${clamped} sent`);
    };
    scale.addEventListener('input', () => {
      scaleText.textContent = scale.value;
    });
    scale.addEventListener('change', () => sendScale(Number(scale.value)));
    scaleRow.append(scale, scaleText);
    button(scaleRow, '1', 'timeScaleReset', () => sendScale(1));

    const threatRow = row();
    const threatSelect = el(doc, 'select', 'pp-debug-select');
    threatSelect.dataset.debug = 'threatSelect';
    threatRow.append(threatSelect);
    button(threatRow, 'Launch', 'launchThreat', () => {
      const reason = refusalReason(host);
      if (reason !== null) {
        say(`Launch: ${reason}`);
        return;
      }
      const id = Number(threatSelect.value);
      if (Number.isInteger(id) && id > 0 && launchThreat(context, id)) say(`Launch: #${id} sent`);
      else say('Launch: pick a threat first');
    });

    const cheatRows = CHEATS.map((cheat) => {
      const cheatRow = row();
      cheatRow.dataset.cheat = cheat.id;
      let number: HTMLInputElement | null = null;
      if (cheat.input !== null) {
        number = el(doc, 'input', 'pp-debug-number');
        number.type = 'number';
        number.min = String(cheat.input.min);
        number.max = String(cheat.input.max);
        number.value = String(cheat.input.start);
        number.dataset.debug = `${cheat.id}Value`;
        cheatRow.append(number);
      }
      button(cheatRow, cheat.label, cheat.id, () => {
        const reason = refusalReason(host);
        if (reason !== null) {
          say(`${cheat.label}: ${reason}`);
          return;
        }
        let value = 0;
        if (number !== null && cheat.input !== null) {
          const parsed = parseCheatNumber(number.value, cheat.input);
          if (!parsed.ok) {
            say(`${cheat.label}: ${parsed.error}`);
            return;
          }
          value = parsed.value;
          number.value = String(value);
        }
        cheat.run(context, value);
        say(`${cheat.label}${number === null ? '' : ` = ${value}`} sent`);
      });
      return { cheat, row: cheatRow };
    });

    const endRow = row();
    button(endRow, 'Skip to the end', 'skipToEnd', () => {
      const reason = refusalReason(host);
      if (reason !== null) {
        say(`Skip to the end: ${reason}`);
        return;
      }
      skip.start();
    });

    const seedRow = row();
    const seedInput = el(doc, 'input', 'pp-debug-number');
    seedInput.type = 'number';
    seedInput.min = '0';
    seedInput.max = String(UINT32_RANGE - 1);
    seedInput.step = '1';
    seedInput.dataset.debug = 'seed';
    seedRow.append(seedInput);
    button(seedRow, 'Restart with seed', 'restartSeed', () => {
      const parsed = parseSeed(seedInput.value);
      if (!parsed.ok) {
        say(`Restart: ${parsed.error}`);
        log.warn('debug', `overlay: ${parsed.error}`, seedInput.value);
        return;
      }
      skip.cancel();
      say(`Restart: seed ${parsed.value}…`);
      host.levelSession
        .start({ seed: parsed.value })
        .then((outcome) => {
          if (outcome !== 'started') say(`Restart: ${outcome}`);
        })
        .catch((cause: unknown) => {
          say('Restart: the level could not start');
          log.warn('debug', 'overlay: restarting the level failed', cause);
        });
    });
    controls.append(status);

    // --- Views ---
    const views = createDebugViews(host, doc);
    const viewBody = section('views', 'Views', false);
    const viewBoxes = new Map<DebugView, HTMLInputElement>();
    /** Mirrors what is drawn (names, and how many vertices each holds) for the e2e specs. */
    const mirrorViews = (): void => {
      root.dataset.debugViews = views.drawn().join(',');
      const sizes = views.sizes();
      root.dataset.debugViewSizes = views
        .drawn()
        .map((view) => `${view}:${sizes[view] ?? 0}`)
        .join(',');
    };
    for (const view of DEBUG_VIEWS) {
      const label = el(doc, 'label', 'pp-debug-check');
      const box = el(doc, 'input', 'pp-debug-checkbox');
      box.type = 'checkbox';
      box.dataset.debugView = view;
      box.addEventListener('change', () => {
        views.setView(view, box.checked);
        mirrorViews();
      });
      label.append(box, doc.createTextNode(view));
      viewBody.append(label);
      viewBoxes.set(view, box);
    }

    // --- Inspector, feel ---
    const inspector = createStateInspector(host, section('inspector', 'World', false));
    const feelBody = section('feel', 'Feel', false);
    let feelPanel: FeelPanel | null = null;
    const soundsBody = section('sounds', 'Sons', false);
    let soundBoard: SoundBoard | null = null;

    // A new level: the views switch themselves off (the old scene is gone: so do the boxes), a skip
    // in progress stops (it must not fast-forward the new level), and the time scale is the new
    // sim's. The pause wish is kept by the session and put back when the overlay closes.
    const offStarted = host.onLevelStarted(
      guarded('debug overlay: new level', (started) => {
        skip.cancel();
        for (const box of viewBoxes.values()) box.checked = false;
        root.dataset.debugViews = '';
        root.dataset.debugViewSizes = '';
        const baseScale = started.sim.world.time.baseScale;
        showScale(baseScale);
        scaleAtShow = { sim: started.sim, value: baseScale };
        hasScaleChanged = false;
        say('');
      }),
    );

    /** What follows the level: the pause label, the fatigue row, the threat list and the seed. */
    function syncControls(): void {
      pauseButton.textContent = host.levelSession.isFrozen ? 'Resume' : 'Pause';
      const active = host.levelSession.active;
      const hasFatigue = active !== null && levelHasFatigue(active.level);
      for (const { cheat, row: cheatRow } of cheatRows) {
        cheatRow.hidden = active === null || !cheat.isAvailable(active.sim.world, hasFatigue);
      }
      if (active !== null) syncThreatOptions(launchableThreats(active.sim.world));
      if (doc.activeElement !== seedInput) {
        seedInput.value = String(host.levelSession.current.seed ?? '');
      }
    }

    /**
     * The launch list, keyed on the threat ids: an option's text follows the threat's state in
     * place, so the selection and an open picker survive the refresh. Only a change of the set of
     * threats (or their order) replaces the options, and then the selection is put back.
     */
    const optionsById = new Map<number, HTMLOptionElement>();
    function syncThreatOptions(threats: { id: number; label: string }[]): void {
      const wanted = threats.map((threat) => threat.id);
      const current = [...threatSelect.options].map((option) => Number(option.value));
      if (wanted.length !== current.length || wanted.some((id, i) => id !== current[i])) {
        const selected = threatSelect.value;
        optionsById.clear();
        threatSelect.replaceChildren(
          ...threats.map((threat) => {
            const option = el(doc, 'option', '');
            option.value = String(threat.id);
            optionsById.set(threat.id, option);
            return option;
          }),
        );
        if (selected !== '' && optionsById.has(Number(selected))) threatSelect.value = selected;
      }
      for (const threat of threats) {
        const option = optionsById.get(threat.id);
        if (option !== undefined && option.textContent !== threat.label) {
          option.textContent = threat.label;
        }
      }
    }

    let lastRefreshAtReal = Number.NEGATIVE_INFINITY;
    const offFrame = host.onRenderedFrame(
      guarded('debug overlay: refresh', (frameAtReal) => {
        if (root.hidden || frameAtReal - lastRefreshAtReal < DEBUG_PANEL_REFRESH_MS) return;
        lastRefreshAtReal = frameAtReal;
        syncControls();
        views.refresh();
        mirrorViews();
      }),
    );
    close.addEventListener('click', onClose);

    doc.body.append(root);
    return {
      root,
      timeline,
      show() {
        root.hidden = false;
        root.dataset.debugOverlay = 'open';
        frozenAtShow = host.levelSession.isFrozen;
        const active = host.levelSession.active;
        scaleAtShow =
          active === null ? null : { sim: active.sim, value: active.sim.world.time.baseScale };
        if (active !== null) showScale(active.sim.world.time.baseScale);
        hasScaleChanged = false;
        perf.setActive(true);
        inspector.setActive(true);
        views.setShown(true);
        if (feelPanel === null) {
          try {
            // While the overlay is closed a level start leaves the pane as it is: `show()` rebuilds it.
            feelPanel = createFeelPanel({ host, container: feelBody, isOpen: () => !root.hidden });
          } catch (cause) {
            log.warn('debug', 'overlay: the feel panel could not be built', cause);
          }
        } else {
          // The level may have changed, or `__PP__.setFeel` been used, while it was closed.
          try {
            feelPanel.rebuild();
          } catch (cause) {
            log.warn('debug', 'overlay: the feel panel could not be rebuilt', cause);
          }
        }
        if (soundBoard === null) {
          try {
            // The cues never change while the page lives: built once, on the first opening.
            soundBoard = createSoundBoard({ host, container: soundsBody });
          } catch (cause) {
            log.warn('debug', 'overlay: the sound board could not be built', cause);
          }
        }
        syncControls();
      },
      hide() {
        root.hidden = true;
        root.dataset.debugOverlay = 'closed';
        perf.setActive(false);
        inspector.setActive(false);
        views.setShown(false);
        // Put back what the overlay's controls changed: a skip stops, the pause is as it was, and
        // so is the time scale (a sim command, so it is journaled like the change was).
        skip.cancel();
        host.levelSession.freeze(frozenAtShow);
        const active = host.levelSession.active;
        if (
          hasScaleChanged &&
          scaleAtShow !== null &&
          active?.sim === scaleAtShow.sim &&
          refusalReason(host) === null
        ) {
          context.send({ type: 'SetTimeScale', scale: scaleAtShow.value });
        }
        hasScaleChanged = false;
        showScale(scaleAtShow?.value ?? 1);
      },
      dispose() {
        skip.cancel();
        offStarted();
        offFrame();
        perf.dispose();
        timeline.dispose();
        inspector.dispose();
        views.dispose();
        feelPanel?.dispose();
        soundBoard?.dispose();
        root.remove();
      },
    };
  }

  // --- Opening ---
  let isVisible = false;
  const setVisible = (next: boolean): void => {
    if (next === isVisible) return;
    isVisible = next;
    if (next) {
      ui ??= buildUi(() => setVisible(false));
      ui.show();
    } else {
      ui?.hide();
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'F1') return;
    event.preventDefault();
    // A held key repeats `keydown`: the overlay must not flicker open and shut.
    if (event.repeat) return;
    setVisible(!isVisible);
  };
  // Three touch pointers down at the same time. The first finger already sent whatever it sent to
  // the game: opening a debug tool may cost one stray tap (story 2.1, D10). The toggle fires on the
  // pointerdown that takes the count from fewer than three to three, once per gesture. A lost
  // `pointerup` must not leave a finger counted for good: a new primary touch (the first finger of
  // a gesture) starts the count again, and so does losing the focus.
  const touches = new Set<number>();
  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') return;
    if (event.isPrimary) touches.clear();
    const before = touches.size;
    touches.add(event.pointerId);
    if (before < DEBUG_THREE_FINGER_COUNT && touches.size === DEBUG_THREE_FINGER_COUNT) {
      setVisible(!isVisible);
    }
  };
  const onPointerEnd = (event: PointerEvent): void => {
    touches.delete(event.pointerId);
  };
  const onBlur = (): void => touches.clear();
  win.addEventListener('keydown', onKeyDown, true);
  win.addEventListener('pointerdown', onPointerDown, true);
  win.addEventListener('pointerup', onPointerEnd, true);
  win.addEventListener('pointercancel', onPointerEnd, true);
  win.addEventListener('blur', onBlur);

  log.info('debug', 'overlay ready (F1 or three fingers)');

  return {
    get isVisible() {
      return isVisible;
    },
    show: () => setVisible(true),
    hide: () => setVisible(false),
    toggle: () => setVisible(!isVisible),
    dispose() {
      win.removeEventListener('keydown', onKeyDown, true);
      win.removeEventListener('pointerdown', onPointerDown, true);
      win.removeEventListener('pointerup', onPointerEnd, true);
      win.removeEventListener('pointercancel', onPointerEnd, true);
      win.removeEventListener('blur', onBlur);
      offResolved();
      offStartedTimeline();
      ui?.dispose();
    },
  };
}

/** What `boot.ts` calls: makes the overlay and returns what removes it. Hidden until toggled. */
export function installDebugOverlay(host: TestHost): () => void {
  return createDebugOverlay(host).dispose;
}
