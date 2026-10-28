import type { ResultScreenTimings } from '@content/schemas/feedback';
import { COUNT_UP_FRAME_MS, STAR_COUNT_MAX } from '@shared/constants';
import type { MamaScore } from '@sim';
import type { OverlayScreen } from '../overlayScreen.ts';
import { bindPressButton } from '../pressButton.ts';
import { formatString, type Translator } from '../strings.ts';
import { svgElement } from '../svg.ts';

/** Where the sequence is: the rows count up, then the stars stamp, then the buttons are up. */
export type ResultPhase = 'rows' | 'stars' | 'actions';

/** Real-time timers (`setTimeout` in the app, a fake in tests): the sequence never reads sim time. */
export interface ResultScheduler {
  schedule(run: () => void, delayMs: number): number;
  cancel(handle: number): void;
}

/**
 * Where Enter and Space are heard while the sequence runs (the window in the app). `blur`: a
 * window that loses focus swallows the keyup of a key still down.
 */
export interface ResultKeyTarget {
  addEventListener(type: 'keydown' | 'keyup', listener: (event: KeyboardEvent) => void): void;
  addEventListener(type: 'blur', listener: () => void): void;
  removeEventListener(type: 'keydown' | 'keyup', listener: (event: KeyboardEvent) => void): void;
  removeEventListener(type: 'blur', listener: () => void): void;
}

/** The maxima of the four rows, from `feel.mama`: never written in code. */
export interface ResultMaxima {
  laughMaxPoints: number;
  babyStateMaxPoints: number;
  sighMaxPoints: number;
  screamMaxPoints: number;
}

export interface ResultScreenOptions {
  t: Translator;
  score: MamaScore;
  maxima: ResultMaxima;
  timings: ResultScreenTimings;
  /** The sequence already ran (a screen rebuilt after the portrait overlay): show its end, silently. */
  isDone: boolean;
  scheduler: ResultScheduler;
  /** Real ms, for the count-up. */
  now(): number;
  keyTarget: ResultKeyTarget;
  /** A star is stamped; `isLast` for the last earned one. Never called for a skipped or done star. */
  onStar(isLast: boolean): void;
  /** The phase changed (also once at build). `actions` means the sequence is done. */
  onPhase(phase: ResultPhase): void;
  /** « Rejouer ». */
  onReplay(): void;
  /** « Copier le journal » (story 3.3, debug builds only): no button without it. */
  copyLog?: () => void;
  /** Makes the elements (the browser's `document`; a double in tests). */
  doc?: Pick<Document, 'createElement' | 'createElementNS'>;
}

const SKIP_KEYS = new Set(['Enter', 'NumpadEnter', 'Space']);

/** One star, shaped like the mockup's `star-on`: an ink shadow under the filled, outlined star. */
const STAR_POINTS =
  '12,1.5 14.9,8 21.6,8.7 16.6,13.2 18,19.8 12,16.4 6,19.8 7.4,13.2 2.4,8.7 9.1,8';

/** The chip icons of the mockup, drawn in `currentColor` (the ink, from CSS). */
const CHIP_ICONS: Readonly<Record<RowKind, readonly [string, Record<string, string>][]>> = {
  laugh: [
    ['circle', { cx: '5', cy: '6', r: '1.4' }],
    ['circle', { cx: '11', cy: '6', r: '1.4' }],
    ['path', { d: 'M4 9.5q4 4.5 8 0z' }],
  ],
  baby: [
    ['circle', { cx: '5.5', cy: '7', r: '1.4' }],
    ['circle', { cx: '10.5', cy: '7', r: '1.4' }],
    ['path', { d: 'M6 10.5q2 1.5 4 0', class: 'pp-score-chip-line' }],
  ],
  sigh: [
    ['path', { d: 'M3.5 6.5h3M9.5 6.5h3', class: 'pp-score-chip-line' }],
    ['path', { d: 'M5.5 11h5', class: 'pp-score-chip-line' }],
  ],
  scream: [
    ['circle', { cx: '5', cy: '5.5', r: '1.4' }],
    ['circle', { cx: '11', cy: '5.5', r: '1.4' }],
    ['ellipse', { cx: '8', cy: '11', rx: '2.6', ry: '3' }],
  ],
};

type RowKind = 'laugh' | 'baby' | 'sigh' | 'scream';

interface Row {
  kind: RowKind;
  labelKey: string;
  totalPoints: number;
  maxPoints: number;
}

/**
 * The Result screen (story 1.22, UX-DR13): Mama's four rows count up one after the other, the total
 * follows them, the earned stars stamp one by one, then « Rejouer » comes up and takes focus. The
 * timings are `feedback.json › resultScreen`, in real ms. A press on the screen, Enter, Space or a
 * pad's A skips to the end (rows at their totals, stars placed silently, buttons up) without
 * pressing « Rejouer ». A press that starts within `inputGraceMs` of the screen coming up, or of the
 * buttons coming up, does neither: it is a tap still meant for the game. The photo (3.6), Mama's lines (3.7) and the 3.11 buttons come later.
 */
export function createResultScreen(options: ResultScreenOptions): OverlayScreen {
  const { t, score, maxima, timings, scheduler, doc = document } = options;
  const rows: Row[] = [
    {
      kind: 'laugh',
      labelKey: 'result.score_laughs',
      totalPoints: score.laughPoints,
      maxPoints: maxima.laughMaxPoints,
    },
    {
      kind: 'baby',
      labelKey: 'result.score_baby_state',
      totalPoints: score.babyStatePoints,
      maxPoints: maxima.babyStateMaxPoints,
    },
    {
      kind: 'sigh',
      labelKey: 'result.score_no_sigh',
      totalPoints: maxima.sighMaxPoints - score.sighPoints,
      maxPoints: maxima.sighMaxPoints,
    },
    {
      kind: 'scream',
      labelKey: 'result.score_no_scream',
      totalPoints: maxima.screamMaxPoints - score.screamPoints,
      maxPoints: maxima.screamMaxPoints,
    },
  ];
  const maxTotalPoints = rows.reduce((sum, row) => sum + row.maxPoints, 0);

  const make = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    text?: string,
  ): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const element = make('div', 'pp-overlay pp-result-screen');
  const panel = make('section', 'pp-panel pp-result-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', t('result.title'));
  // Focusable while the sequence runs: Enter and Space are heard on the panel, not on a button.
  panel.tabIndex = -1;

  const card = make('div', 'pp-score-card');
  card.setAttribute('role', 'table');
  card.setAttribute('aria-label', t('result.score_label'));
  const values: HTMLElement[] = [];
  const shown = rows.map(() => 0);
  for (const row of rows) {
    const line = make('div', `pp-score-row pp-score-row-${row.kind}`);
    line.setAttribute('role', 'row');
    const chip = make('span', `pp-score-chip pp-score-chip-${row.kind}`);
    chip.setAttribute('aria-hidden', 'true');
    chip.append(
      svgElement(
        'svg',
        { viewBox: '0 0 16 16', class: 'pp-score-chip-icon' },
        CHIP_ICONS[row.kind].map(([tag, attributes]) => svgElement(tag, attributes, [], doc)),
        doc,
      ),
    );
    const label = make('span', 'pp-score-label pp-type-label', t(row.labelKey));
    label.setAttribute('role', 'rowheader');
    const cell = make('span', 'pp-score-cell');
    cell.setAttribute('role', 'cell');
    const value = make('span', 'pp-score-value pp-type-numeric', '0');
    const max = make('span', 'pp-score-max pp-type-label', `/${row.maxPoints}`);
    cell.append(value, max);
    line.append(chip, label, cell);
    card.append(line);
    values.push(value);
  }

  const total = make('div', 'pp-score-total');
  const totalValue = make('span', 'pp-score-total-value pp-type-display', '0');
  const totalMax = make('span', 'pp-score-total-max pp-type-numeric', `/${maxTotalPoints}`);
  const totalScore = make('div', 'pp-score-total-score');
  totalScore.append(totalValue, totalMax);
  const stars = make('div', 'pp-stars');
  stars.setAttribute('role', 'img');
  stars.setAttribute(
    'aria-label',
    formatString(t('result.stars_label'), { count: score.stars, max: STAR_COUNT_MAX }),
  );
  const slots: SVGElement[] = [];
  for (let i = 0; i < STAR_COUNT_MAX; i++) {
    const slot = svgElement(
      'svg',
      { viewBox: '0 0 24 26', class: 'pp-star pp-star-empty', 'aria-hidden': 'true' },
      [
        svgElement('polygon', { points: STAR_POINTS, class: 'pp-star-shadow' }, [], doc),
        svgElement('polygon', { points: STAR_POINTS, class: 'pp-star-shape' }, [], doc),
      ],
      doc,
    );
    slots.push(slot);
    stars.append(slot);
  }
  total.append(totalScore, stars);

  const actions = make('div', 'pp-result-actions');
  actions.hidden = true;
  const replay = make('button', 'pp-button pp-button-primary', t('result.replay_button'));
  replay.type = 'button';
  replay.setAttribute('aria-label', t('result.replay_button'));
  // A key that skipped the sequence and is still held must not press « Rejouer » once it has
  // focus (Space activates a button on keyup): it is ignored until that key is let go.
  let heldSkipKey: string | null = null;
  // Real ms from which a press counts (D-grace): a rebuilt, finished screen takes presses at once.
  let pressesOpenAtReal = options.isDone ? 0 : options.now() + timings.inputGraceMs;
  const isGraceOver = (): boolean => options.now() >= pressesOpenAtReal;
  const unbindReplay = bindPressButton(replay, () => {
    if (heldSkipKey === null && isGraceOver()) options.onReplay();
  });
  actions.append(replay);
  let unbindCopy: (() => void) | null = null;
  if (options.copyLog !== undefined) {
    const copy = make('button', 'pp-button pp-button-secondary', t('result.copy_log'));
    copy.type = 'button';
    copy.setAttribute('aria-label', t('result.copy_log'));
    unbindCopy = bindPressButton(copy, options.copyLog);
    actions.append(copy);
  }

  panel.append(card, total, actions);
  element.append(panel);

  // The sequence. Every timer goes through `scheduler`, so `dispose` and a skip cancel them all.
  const pending = new Set<number>();
  const later = (run: () => void, delayMs: number): void => {
    const handle = scheduler.schedule(() => {
      pending.delete(handle);
      run();
    }, delayMs);
    pending.add(handle);
  };
  const cancelAll = (): void => {
    for (const handle of pending) scheduler.cancel(handle);
    pending.clear();
  };

  let phase: ResultPhase = 'rows';
  const enter = (next: ResultPhase): void => {
    phase = next;
    options.onPhase(next);
  };
  const showRow = (index: number, points: number): void => {
    if (shown[index] === points) return;
    shown[index] = points;
    (values[index] as HTMLElement).textContent = String(points);
    totalValue.textContent = String(shown.reduce((sum, value) => sum + value, 0));
  };
  const showTotals = (): void => {
    for (let index = 0; index < rows.length; index++) {
      showRow(index, (rows[index] as Row).totalPoints);
    }
  };
  let earned = 0;
  const earn = (isStamped: boolean): void => {
    const slot = slots[earned] as SVGElement;
    slot.classList.remove('pp-star-empty');
    slot.classList.add('pp-star-earned');
    if (isStamped) slot.classList.add('pp-star-stamped');
    earned++;
  };
  const showActions = (): void => {
    cancelAll();
    actions.hidden = false;
    // The finger that skipped, or that was mashing, must not land on « Rejouer » as it appears.
    pressesOpenAtReal = options.now() + timings.inputGraceMs;
    enter('actions');
    replay.focus({ preventScroll: true });
  };
  /** Rows at their totals, the stars placed without a sound, the buttons up. */
  const complete = (): void => {
    if (phase === 'actions') return;
    cancelAll();
    showTotals();
    while (earned < score.stars) earn(false);
    showActions();
  };

  const countUp = (index: number): void => {
    const { totalPoints } = rows[index] as Row;
    if (totalPoints <= 0) {
      showRow(index, 0);
      return;
    }
    const startedAtReal = options.now();
    const tick = (): void => {
      const share = Math.min(1, (options.now() - startedAtReal) / timings.rowCountUpMs);
      showRow(index, Math.round(totalPoints * share));
      if (share < 1) later(tick, COUNT_UP_FRAME_MS);
    };
    tick();
  };
  const stamp = (index: number): void => {
    earn(true);
    const isLast = index === score.stars - 1;
    options.onStar(isLast);
    if (isLast) later(showActions, timings.actionsDelayMs);
    else later(() => stamp(index + 1), timings.starIntervalMs);
  };
  const startStars = (): void => {
    // The last row has landed whatever the frames did: its total is on screen.
    showTotals();
    if (score.stars <= 0) {
      later(showActions, timings.actionsDelayMs);
      return;
    }
    later(() => {
      enter('stars');
      stamp(0);
    }, timings.starsDelayMs);
  };

  // A press on the screen skips: the pointer must go down and up on it (a release that ends a
  // press begun elsewhere is not one). The skipping press never reaches « Rejouer », which is
  // hidden under it and only acts on a press that began on itself.
  let pressedPointer: number | null = null;
  const onPointerDown = (event: PointerEvent): void => {
    if (phase !== 'actions' && event.isPrimary && isGraceOver()) pressedPointer = event.pointerId;
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== pressedPointer) return;
    pressedPointer = null;
    complete();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (phase === 'actions' || event.repeat || !SKIP_KEYS.has(event.code)) return;
    event.preventDefault();
    if (!isGraceOver()) return;
    heldSkipKey = event.code;
    complete();
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === heldSkipKey) heldSkipKey = null;
  };
  // The keyup of a key still down never comes once the window lost focus: do not keep « Rejouer » dead.
  const onBlur = (): void => {
    heldSkipKey = null;
  };
  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointerup', onPointerUp);
  options.keyTarget.addEventListener('keydown', onKeyDown);
  options.keyTarget.addEventListener('keyup', onKeyUp);
  options.keyTarget.addEventListener('blur', onBlur);

  if (options.isDone) {
    showTotals();
    while (earned < score.stars) earn(false);
    actions.hidden = false;
    enter('actions');
  } else {
    enter('rows');
    for (let index = 0; index < rows.length; index++) {
      later(() => countUp(index), index * timings.rowStaggerMs);
    }
    later(startStars, (rows.length - 1) * timings.rowStaggerMs + timings.rowCountUpMs);
  }

  return {
    element,
    initialFocus: options.isDone ? replay : panel,
    // A pad's A: skips while the sequence runs, then presses « Rejouer ».
    activate: () => {
      if (!isGraceOver()) return;
      if (phase === 'actions') replay.click();
      else complete();
    },
    dispose: () => {
      cancelAll();
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointerup', onPointerUp);
      options.keyTarget.removeEventListener('keydown', onKeyDown);
      options.keyTarget.removeEventListener('keyup', onKeyUp);
      options.keyTarget.removeEventListener('blur', onBlur);
      unbindReplay();
      unbindCopy?.();
    },
  };
}
