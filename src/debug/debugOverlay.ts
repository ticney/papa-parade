import type { TestHost } from '@client/app/testHost';
import {
  DEBUG_PANEL_REFRESH_MS,
  DEBUG_THREE_FINGER_COUNT,
  DEBUG_TIMELINE_ROWS,
  MIN_TIME_SCALE,
} from '@shared/constants';
import { log } from '@shared/log';
import {
  CHEATS,
  clampTimeScale,
  createCheatContext,
  createSkipToEnd,
  launchableThreats,
  launchThreat,
} from './cheats.ts';
import './debugOverlay.css';
import { createFeelPanel, type FeelPanel } from './feelPanel.ts';
import { createDebugViews, DEBUG_VIEWS, type DebugView } from './navDebugView.ts';
import { createPerfPanel } from './perfPanel.ts';
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

/** Events the overlay keeps to itself: a key typed in a pane field or a tap on a panel is not the game's. */
const ISOLATED_EVENTS = [
  'keydown',
  'keyup',
  'keypress',
  'pointerdown',
  'pointerup',
  'pointermove',
  'pointercancel',
] as const;

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
 * command or the level session; it never writes the world. Keys and pointers inside it stop at its
 * root, so typing in a field never moves Papa or skips the Result screen.
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
  const offResolved = host.onSimEvent((event) => {
    if (event.type !== 'ResponseResolved') return;
    const copy: ResolvedEvent = { ...event, responseWindow: { ...event.responseWindow } };
    recent.unshift(copy);
    if (recent.length > DEBUG_TIMELINE_ROWS) recent.length = DEBUG_TIMELINE_ROWS;
    ui?.timeline.add(copy);
  });
  const offStartedTimeline = host.onLevelStarted(() => {
    recent.length = 0;
    ui?.timeline.clear();
  });

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

    const timeRow = row();
    const pauseButton = button(timeRow, 'Pause', 'pause', () => {
      host.levelSession.freeze(!host.levelSession.isFrozen);
      syncControls();
    });
    button(timeRow, 'Step', 'step', () => {
      try {
        host.levelSession.advance(1);
      } catch (cause) {
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
    const sendScale = (value: number): void => {
      const clamped = clampTimeScale(value);
      scale.value = String(clamped);
      scaleText.textContent = String(clamped);
      context.send({ type: 'SetTimeScale', scale: clamped });
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
      const id = Number(threatSelect.value);
      if (Number.isInteger(id) && id > 0) launchThreat(context, id);
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
        const value = number === null ? 0 : Number(number.value);
        if (Number.isFinite(value)) cheat.run(context, value);
      });
      return { cheat, row: cheatRow };
    });

    const endRow = row();
    button(endRow, 'Skip to the end', 'skipToEnd', () => skip.start());

    const seedRow = row();
    const seedInput = el(doc, 'input', 'pp-debug-number');
    seedInput.type = 'number';
    seedInput.min = '0';
    seedInput.step = '1';
    seedInput.dataset.debug = 'seed';
    seedRow.append(seedInput);
    button(seedRow, 'Restart with seed', 'restartSeed', () => {
      const seed = Number(seedInput.value);
      if (!Number.isInteger(seed) || seed < 0) {
        log.warn('debug', 'overlay: the seed must be a non-negative integer');
        return;
      }
      skip.cancel();
      void host.levelSession.start({ seed });
    });

    // --- Views ---
    const views = createDebugViews(host, doc);
    const viewBody = section('views', 'Views', false);
    const viewBoxes = new Map<DebugView, HTMLInputElement>();
    for (const view of DEBUG_VIEWS) {
      const label = el(doc, 'label', 'pp-debug-check');
      const box = el(doc, 'input', 'pp-debug-checkbox');
      box.type = 'checkbox';
      box.dataset.debugView = view;
      box.addEventListener('change', () => {
        views.setView(view, box.checked);
        root.dataset.debugViews = views.drawn().join(',');
      });
      label.append(box, doc.createTextNode(view));
      viewBody.append(label);
      viewBoxes.set(view, box);
    }
    // The views switch themselves off at each level (the old scene is gone): so do the boxes.
    const offStartedViews = host.onLevelStarted(() => {
      for (const box of viewBoxes.values()) box.checked = false;
      root.dataset.debugViews = '';
    });

    // --- Inspector, feel ---
    const inspector = createStateInspector(host, section('inspector', 'World', false));
    const feelBody = section('feel', 'Feel', false);
    let feelPanel: FeelPanel | null = null;

    /** What follows the level: the pause label, the fatigue row, the threat list and the seed. */
    function syncControls(): void {
      pauseButton.textContent = host.levelSession.isFrozen ? 'Resume' : 'Pause';
      const active = host.levelSession.active;
      const hasFatigue = active?.level.level.gauges.fatigue !== undefined;
      for (const { cheat, row: cheatRow } of cheatRows) {
        cheatRow.hidden = active === null || !cheat.isAvailable(active.sim.world, hasFatigue);
      }
      if (active !== null) {
        const threats = launchableThreats(active.sim.world);
        const wanted = threats.map((threat) => `${threat.id}|${threat.label}`).join('\n');
        if (threatSelect.dataset.options !== wanted) {
          threatSelect.dataset.options = wanted;
          threatSelect.replaceChildren(
            ...threats.map((threat) => {
              const option = el(doc, 'option', '', threat.label);
              option.value = String(threat.id);
              return option;
            }),
          );
        }
      }
      if (doc.activeElement !== seedInput) {
        seedInput.value = String(host.levelSession.current.seed ?? '');
      }
    }

    const offFrame = host.onRenderedFrame((frameAtReal) => {
      if (root.hidden || frameAtReal - lastRefreshAtReal < DEBUG_PANEL_REFRESH_MS) return;
      lastRefreshAtReal = frameAtReal;
      syncControls();
      views.refresh();
      root.dataset.debugViews = views.drawn().join(',');
    });
    let lastRefreshAtReal = Number.NEGATIVE_INFINITY;
    close.addEventListener('click', onClose);

    doc.body.append(root);
    return {
      root,
      timeline,
      show() {
        root.hidden = false;
        root.dataset.debugOverlay = 'open';
        perf.setActive(true);
        inspector.setActive(true);
        views.setShown(true);
        if (feelPanel === null) {
          try {
            feelPanel = createFeelPanel({ host, container: feelBody });
          } catch (cause) {
            log.warn('debug', 'overlay: the feel panel could not be built', cause);
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
      },
      dispose() {
        skip.cancel();
        offStartedViews();
        offFrame();
        perf.dispose();
        timeline.dispose();
        inspector.dispose();
        views.dispose();
        feelPanel?.dispose();
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
    setVisible(!isVisible);
  };
  // Three touch pointers down at the same time. The first finger already sent whatever it sent to
  // the game: opening a debug tool may cost one stray tap (story 2.1, D10).
  const touches = new Set<number>();
  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') return;
    touches.add(event.pointerId);
    if (touches.size === DEBUG_THREE_FINGER_COUNT) setVisible(!isVisible);
  };
  const onPointerEnd = (event: PointerEvent): void => {
    touches.delete(event.pointerId);
  };
  win.addEventListener('keydown', onKeyDown, true);
  win.addEventListener('pointerdown', onPointerDown, true);
  win.addEventListener('pointerup', onPointerEnd, true);
  win.addEventListener('pointercancel', onPointerEnd, true);

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
