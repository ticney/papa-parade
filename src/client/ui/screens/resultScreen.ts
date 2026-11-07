import type { ResultScreenTimings } from '@content/schemas/feedback';
import {
  COUNT_UP_FRAME_MS,
  JOURNAL_COPY_TIMEOUT_MS,
  type MamaReactionId,
  STAR_COUNT_MAX,
} from '@shared/constants';
import { log } from '@shared/log';
import type { LevelEndReason, MamaReaction, MamaScore } from '@sim';
import type { OverlayScreen } from '../overlayScreen.ts';
import { bindPressButton } from '../pressButton.ts';
import { formatString, type Translator } from '../strings.ts';
import { svgElement } from '../svg.ts';

/**
 * Where the sequence is: the end photo drops in and holds (story 3.6, only with a photo), Mama
 * reacts (story 3.7), the rows count up, then the stars stamp (the lost ones last), then the buttons
 * are up.
 */
export type ResultPhase = 'photo' | 'mama' | 'rows' | 'stars' | 'actions';

/**
 * The end photo as the screen gets it (story 3.6): the 2D canvas boot took at `LevelScored`, which
 * boot keeps and every build of the screen re-parents, and the tilt of its polaroid, in degrees,
 * drawn once with the photo so that a rebuilt screen shows the same tilt.
 */
export interface ResultPhoto {
  readonly canvas: HTMLCanvasElement;
  readonly tiltDeg: number;
}

/**
 * What the copy action did (story 3.3): `copied` to the clipboard, `downloaded` as a file (the
 * clipboard refused), or `failed` (nothing left the page).
 */
export type CopyLogOutcome = 'copied' | 'downloaded' | 'failed';

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

/** The maxima of the five rows, from `feel.mama`: never written in code. */
export interface ResultMaxima {
  laughMaxPoints: number;
  calmMaxPoints: number;
  homeMaxPoints: number;
  sighMaxPoints: number;
  screamMaxPoints: number;
}

export interface ResultScreenOptions {
  t: Translator;
  score: MamaScore;
  /** Why the level ended: `mamaWoke` adds the header « Maman s'est réveillée ! » (story 3.2), `mamaHome` « Maman est rentrée plus tôt ! » (story 3.16), `cycleDone` « Il dort enfin ! » (story 4.10). */
  endReason: LevelEndReason;
  maxima: ResultMaxima;
  timings: ResultScreenTimings;
  /** The sequence already ran (a screen rebuilt after the portrait overlay): show its end, silently. */
  isDone: boolean;
  /**
   * The end photo (story 3.6), or null when the level took none: the screen then has no polaroid and
   * its sequence starts at `rows`, exactly as before the photo existed.
   */
  photo: ResultPhoto | null;
  /**
   * Mama's reactions to the game, in the order they play (`mamaReactionsOf`, story 3.7): each shows its
   * line in the bubble, its value, her face and her animation for `reactionHoldMs`. Boot always passes
   * at least one; an empty list simply plays no `mama` phase.
   */
  reactions: readonly MamaReaction[];
  scheduler: ResultScheduler;
  /** Real ms, for the count-up. */
  now(): number;
  keyTarget: ResultKeyTarget;
  /** The photo dropped in, once, when the `photo` phase starts (never on a rebuild, nor with no photo). */
  onPhoto(): void;
  /** One of Mama's reactions comes up, once each, in order (never on a rebuild, nor after a skip; story 3.7). */
  onMamaReaction(reaction: MamaReactionId): void;
  /** A star is stamped; `isLast` for the last earned one. Never called for a skipped or done star. */
  onStar(isLast: boolean): void;
  /** The header of a woken Mama comes up, once, when the rows start (never on a rebuild or a skip). */
  onMamaWoke(): void;
  /** The header of a Mama come home early comes up, once, when the rows start (never on a rebuild or a skip): the door slams (story 3.16). */
  onMamaHome(): void;
  /** A lost star is stamped (after the earned ones). Never called for a skipped or done one. */
  onStarLost(): void;
  /** The phase changed (also once at build). `actions` means the sequence is done. */
  onPhase(phase: ResultPhase): void;
  /** « Rejouer ». */
  onReplay(): void;
  /**
   * « Copier le journal » (story 3.3, playtest builds only): no button without it. It runs inside the
   * press (iOS only grants the clipboard to a gesture) and says what it did; it should not reject,
   * and a rejection counts as `'failed'`.
   */
  copyLog?: () => Promise<CopyLogOutcome>;
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
  // Calme du bébé: a sleeping face, two closed-eye arcs and a small smile.
  calm: [
    ['path', { d: 'M3.5 7q1.5 -2 3 0M9.5 7q1.5 -2 3 0', class: 'pp-score-chip-line' }],
    ['path', { d: 'M6 11q2 1.5 4 0', class: 'pp-score-chip-line' }],
  ],
  // Maison: a little house, a roof over a door.
  home: [
    ['path', { d: 'M2.5 8L8 3l5.5 5z' }],
    ['path', { d: 'M4.5 8v5h7V8z', class: 'pp-score-chip-line' }],
    ['path', { d: 'M7 13v-3h2v3', class: 'pp-score-chip-line' }],
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

type SvgPart = readonly [string, Record<string, string>];

/**
 * The provisional 2D Mama of the reactions (story 3.7, D5), after the mockup's `#mama-sigh` and `#mama-woke`:
 * a head, hair and a dress in a 60 x 100 box, drawn in tokens only (the classes colour them), with one
 * face and one pose per reaction. E7 replaces her with a model.
 */
const MAMA_VIEW_BOX = '0 0 60 100';
const MAMA_DRAWINGS: Readonly<Record<MamaReactionId, readonly SvgPart[]>> = {
  // Eyes shut in two arches, an open smile, hands up at her sides.
  laugh: [
    ['path', { d: 'M17 28q0 -18 13 -18q13 0 13 18z', class: 'pp-mama-hair' }],
    ['path', { d: 'M20 46h20l4 48h-28z', class: 'pp-mama-dress' }],
    ['path', { d: 'M20 50l-9 -7M40 50l9 -7', class: 'pp-mama-line' }],
    ['circle', { cx: '30', cy: '30', r: '12', class: 'pp-mama-skin' }],
    [
      'path',
      { d: 'M18 28q2 -16 12 -16q10 0 12 16q-6 -6 -12 -6q-6 0 -12 6z', class: 'pp-mama-hair' },
    ],
    ['path', { d: 'M22 30q3 -4 6 0M32 30q3 -4 6 0', class: 'pp-mama-line' }],
    ['path', { d: 'M23 36q7 9 14 0z', class: 'pp-mama-ink' }],
  ],
  // Flat eyes and mouth, a head that hangs a little, arms down: the mockup's `#mama-sigh`.
  sigh: [
    ['path', { d: 'M17 32q0 -18 13 -18q13 0 13 18z', class: 'pp-mama-hair' }],
    ['path', { d: 'M20 48h20l4 46h-28z', class: 'pp-mama-dress' }],
    ['path', { d: 'M20 52l-8 22M40 52l8 22', class: 'pp-mama-line' }],
    ['circle', { cx: '30', cy: '34', r: '12', class: 'pp-mama-skin' }],
    [
      'path',
      { d: 'M18 32q2 -16 12 -16q10 0 12 16q-6 -6 -12 -6q-6 0 -12 6z', class: 'pp-mama-hair' },
    ],
    ['path', { d: 'M22 34h6M32 34h6M26 41h8', class: 'pp-mama-line' }],
  ],
  // Hair up, round eyes and mouth, the three marks of the mockup's `#mama-woke`.
  scream: [
    ['path', { d: 'M17 30l-5 -12l9 6l3 -14l6 12l6 -12l3 14l9 -6l-5 12z', class: 'pp-mama-ink' }],
    ['path', { d: 'M20 46h20l4 48h-28z', class: 'pp-mama-dress' }],
    ['path', { d: 'M20 50l-10 -10M40 50l10 -10', class: 'pp-mama-line' }],
    ['circle', { cx: '30', cy: '32', r: '12', class: 'pp-mama-skin' }],
    [
      'path',
      { d: 'M18 30q2 -14 12 -14q10 0 12 14q-6 -6 -12 -6q-6 0 -12 6z', class: 'pp-mama-ink' },
    ],
    ['circle', { cx: '25', cy: '31', r: '2', class: 'pp-mama-ink' }],
    ['circle', { cx: '35', cy: '31', r: '2', class: 'pp-mama-ink' }],
    ['ellipse', { cx: '30', cy: '38', rx: '3.6', ry: '4.4', class: 'pp-mama-ink' }],
    ['path', { d: 'M8 14l-5 -5M30 5v-5M52 14l5 -5', class: 'pp-mama-line' }],
  ],
};

type RowKind = 'laugh' | 'calm' | 'home' | 'sigh' | 'scream';

/** Points as the screen writes them: whole, or with a half and a decimal comma (`7,5`: a chore is worth half points, story 9.4). */
function formatPoints(points: number): string {
  return String(points).replace('.', ',');
}

interface Row {
  kind: RowKind;
  labelKey: string;
  totalPoints: number;
  maxPoints: number;
}

/**
 * The Result screen (story 1.22, UX-DR13): the end photo drops in as a polaroid left of the panel
 * and holds alone (`photoHoldMs`, story 3.6; the panel is transparent meanwhile, and a level that took
 * no photo skips this), then Mama's five rows count up one after the other, the total
 * follows them, the earned stars stamp one by one, then the stars a woken Mama took off (dashed,
 * with a « −1 », story 3.2), then « Rejouer » comes up and takes focus. Between the photo and the
 * rows Mama reacts (story 3.7): her laugh, sigh or scream, each with its line in a bubble, its value,
 * her face and a cue, held for `reactionHoldMs`; she stays, at rest, on the last one. A woken Mama also
 * puts a header over the card, with its own cue, when the rows start (after her reactions). The
 * timings are `feedback.json › resultScreen`, in real ms. A press on the screen (the polaroid
 * included), Enter, Space or a pad's A skips to the end (panel shown, Mama at rest on her last reaction, rows at their totals, stars
 * placed silently, the header at rest, buttons up) without
 * pressing « Rejouer ». A press that starts within `inputGraceMs` of the screen coming up, or of the
 * buttons coming up, does neither: it is a tap still meant for the game. Mama's fixed lines are placeholders for story 3.8, and the 3.11 buttons come later.
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
      kind: 'calm',
      labelKey: 'result.score_calm',
      totalPoints: score.calmPoints,
      maxPoints: maxima.calmMaxPoints,
    },
    {
      kind: 'home',
      labelKey: 'result.score_home',
      totalPoints: score.homePoints,
      maxPoints: maxima.homeMaxPoints,
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

  const { photo } = options;
  const element = make(
    'div',
    `pp-overlay pp-result-screen${photo === null ? '' : ' pp-result-screen-photo'}`,
  );
  const panel = make(
    'section',
    `pp-panel pp-result-panel${options.endReason === 'mamaWoke' ? ' pp-result-panel-woken' : ''}${
      options.endReason === 'mamaHome' ? ' pp-result-panel-home' : ''
    }${options.endReason === 'cycleDone' ? ' pp-result-panel-cycle-done' : ''}`,
  );
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', t('result.title'));
  // Focusable while the sequence runs: Enter and Space are heard on the panel, not on a button.
  panel.tabIndex = -1;

  // The polaroid of the end photo (story 3.6, UX `polaroid`), left of the panel. The canvas belongs to
  // boot, which keeps it for as long as the result lasts: a rebuilt screen re-parents it, and the tilt
  // comes with it, so the same picture stands at the same angle.
  let polaroid: HTMLElement | null = null;
  if (photo !== null) {
    polaroid = make('div', 'pp-polaroid');
    polaroid.style.setProperty('--pp-polaroid-tilt', `${photo.tiltDeg}deg`);
    photo.canvas.classList.add('pp-polaroid-photo');
    photo.canvas.setAttribute('role', 'img');
    photo.canvas.setAttribute('aria-label', t('result.photo_label'));
    polaroid.append(photo.canvas);
  }

  // Mama and her bubble (story 3.7, UX `mum-bubble`): in the left column, on the polaroid's top-right corner
  // when there is a photo and alone in the column when there is none. Invisible until her first reaction, but
  // not `hidden`: her live region is in the page from the start, so that the first line is announced.
  const { reactions } = options;
  const lineKeyOf = (reaction: MamaReactionId): string => {
    if (reaction === 'laugh') return 'result.mama_line_laugh';
    if (reaction === 'sigh') return 'result.mama_line_sigh';
    if (options.endReason === 'mamaWoke') return 'result.mama_line_scream_woke';
    if (options.endReason === 'mamaHome') return 'result.mama_line_scream_home';
    return 'result.mama_line_scream';
  };
  const mama = make('div', 'pp-result-mama pp-result-mama-waiting');
  const bubble = make('div', 'pp-mum-bubble pp-type-body');
  bubble.setAttribute('role', 'status');
  bubble.setAttribute('aria-live', 'polite');
  const bubbleText = make('span', 'pp-mum-bubble-text');
  // The value the chip shows, for a reader (the chip itself is a picture of it).
  const bubbleValue = make('span', 'pp-mum-bubble-value');
  bubble.append(bubbleText, bubbleValue);
  const reactionChip = make('span', 'pp-mum-chip pp-type-numeric');
  reactionChip.setAttribute('aria-hidden', 'true');
  reactionChip.hidden = true;
  const speech = make('div', 'pp-mum-speech');
  speech.append(reactionChip, bubble);
  // One figure per reaction, built once; the shown one is a class away.
  const figures = new Map<MamaReactionId, SVGElement>();
  for (const { reaction } of reactions) {
    if (figures.has(reaction)) continue;
    figures.set(
      reaction,
      svgElement(
        'svg',
        { viewBox: MAMA_VIEW_BOX, class: `pp-mama pp-mama--${reaction}`, 'aria-hidden': 'true' },
        MAMA_DRAWINGS[reaction].map(([tag, attributes]) => svgElement(tag, attributes, [], doc)),
        doc,
      ),
    );
  }
  mama.append(speech, ...figures.values());
  /** Shows the face of `reaction`; `isAtRest` leaves it without animation. */
  const shapeFigures = (reaction: MamaReactionId, isAtRest: boolean): void => {
    for (const [id, figure] of figures) {
      figure.setAttribute(
        'class',
        `pp-mama pp-mama--${id}${id === reaction ? ' pp-mama--shown' : ''}${isAtRest ? ' pp-mama--rest' : ''}`,
      );
    }
  };
  /** Shows reaction number `index`: her line, her value, her face; `isAtRest` leaves her without animation. */
  const showReaction = (index: number, isAtRest: boolean): void => {
    const { reaction, points } = reactions[index] as MamaReaction;
    bubble.className = `pp-mum-bubble pp-type-body pp-mum-bubble--${reaction}`;
    bubbleText.textContent = t(lineKeyOf(reaction));
    // What she takes off or gives, with the sign: nothing for a reaction worth 0 (the Laugh of a game with nothing in it).
    reactionChip.hidden = points <= 0;
    reactionChip.className = `pp-mum-chip pp-type-numeric pp-mum-chip--${reaction}`;
    const value =
      points > 0
        ? formatString(
            t(reaction === 'laugh' ? 'result.mama_value_gain' : 'result.mama_value_loss'),
            {
              points: formatPoints(points),
            },
          )
        : '';
    reactionChip.textContent = value;
    bubbleValue.textContent = value;
    mama.className = 'pp-result-mama';
    shapeFigures(reaction, isAtRest);
  };

  const isMamaWoke = options.endReason === 'mamaWoke';
  const isMamaHome = options.endReason === 'mamaHome';
  // The slam is one run of an animation: a rebuilt, finished screen shows the header at rest. The end
  // of the bedtime cycle (story 4.10) shows its header in the same place, with no slam and no event.
  // With a photo the header waits for the rows (`mountHeader`, story 3.6); without one it is there at once.
  let header: HTMLElement | null = null;
  if (isMamaWoke) {
    header = make('h2', 'pp-result-reason pp-type-heading', t('result.mama_woke'));
  } else if (isMamaHome) {
    // The same place and style as « Maman s'est réveillée ! » (UX early-end banner): Domestic, no red, no stamp.
    header = make('h2', 'pp-result-reason pp-type-heading', t('result.mama_home'));
  } else if (options.endReason === 'cycleDone') {
    header = make(
      'h2',
      'pp-result-reason pp-result-reason-done pp-type-heading',
      t('result.cycle_done'),
    );
  }
  let isHeaderMounted = false;
  /** Puts the header over the card, once: with the slam when it comes up for the first time, at rest otherwise. */
  const mountHeader = (isSlammed: boolean): void => {
    if (header === null || isHeaderMounted) return;
    isHeaderMounted = true;
    if (isSlammed && (isMamaWoke || isMamaHome)) header.classList.add('pp-result-reason-slam');
    panel.prepend(header);
  };
  /** The panel is transparent while the photo stands alone; this lets it show (its pop-in plays then). */
  const showPanel = (): void => {
    panel.classList.remove('pp-result-panel-waiting');
  };

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
  // Never more lost slots than there are slots after the earned ones (the snapshot checks it too).
  const lostCount = Math.max(0, Math.min(score.lostStars, STAR_COUNT_MAX - score.stars));
  stars.setAttribute(
    'aria-label',
    lostCount > 0
      ? formatString(t('result.stars_lost_label'), {
          count: score.stars,
          max: STAR_COUNT_MAX,
          lost: lostCount,
        })
      : formatString(t('result.stars_label'), { count: score.stars, max: STAR_COUNT_MAX }),
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
  let isDisposed = false;
  // Debug builds only, by the literal comparison so that Vite folds it and the store bundle holds
  // no `copyLog` (story 1.24). The playtest journal (story 3.3) passes `copyLog` from the debug
  // block of `boot.ts`; this gate keeps the store build clean whatever it passes.
  if (import.meta.env.VITE_DEBUG_ALLOWED === 'true' && options.copyLog !== undefined) {
    const copyLog = options.copyLog;
    const copy = make('button', 'pp-button pp-button-secondary', t('result.copy_log'));
    copy.type = 'button';
    copy.setAttribute('aria-label', t('result.copy_log'));
    const setCopyLabel = (key: 'result.log_copied' | 'result.download_log'): void => {
      copy.textContent = t(key);
      copy.setAttribute('aria-label', t(key));
    };
    // A press while the action is pending is ignored: one gesture, one copy.
    let isCopyPending = false;
    unbindCopy = bindPressButton(copy, () => {
      // The same rules as « Rejouer »: a skip, or a finger that is still mashing, never presses it.
      if (heldSkipKey !== null || !isGraceOver() || isCopyPending) return;
      isCopyPending = true;
      let isSettled = false;
      let timeoutHandle: number | null = null;
      const settle = (outcome: CopyLogOutcome): void => {
        // A press settles once: the timeout and a late answer of the clipboard do not both count.
        if (isSettled) return;
        isSettled = true;
        if (timeoutHandle !== null) options.scheduler.cancel(timeoutHandle);
        isCopyPending = false;
        // A screen rebuilt after the portrait overlay starts again at « Copier le journal ».
        if (isDisposed) return;
        if (outcome === 'copied') setCopyLabel('result.log_copied');
        else if (outcome === 'downloaded') setCopyLabel('result.download_log');
      };
      // A clipboard that never answers (iOS Safari behind its paste bubble) must not kill the button.
      timeoutHandle = options.scheduler.schedule(() => {
        timeoutHandle = null;
        log.warn('debug', 'the copy action did not settle in time');
        settle('failed');
      }, JOURNAL_COPY_TIMEOUT_MS);
      // Called here, synchronously: the clipboard is only granted inside the gesture.
      let pending: Promise<CopyLogOutcome>;
      try {
        pending = copyLog();
      } catch (cause) {
        log.warn('debug', 'the copy action threw', cause);
        settle('failed');
        return;
      }
      pending.then(settle, (cause: unknown) => {
        log.warn('debug', 'the copy action rejected', cause);
        settle('failed');
      });
    });
    actions.append(copy);
  }

  panel.append(card, total, actions);
  // The left column: the polaroid, Mama on its corner. Without either (no photo, no reaction) there is none.
  if (polaroid !== null || reactions.length > 0) {
    const left = make('div', `pp-result-left${polaroid === null ? ' pp-result-left-alone' : ''}`);
    if (polaroid !== null) left.append(polaroid);
    if (reactions.length > 0) left.append(mama);
    element.append(left);
  }
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

  // The first phase of a screen that runs its sequence is set at the end of the build; `enter` calls the host.
  let phase: ResultPhase = 'rows';
  const enter = (next: ResultPhase): void => {
    phase = next;
    options.onPhase(next);
  };
  const showRow = (index: number, points: number): void => {
    if (shown[index] === points) return;
    shown[index] = points;
    (values[index] as HTMLElement).textContent = formatPoints(points);
    totalValue.textContent = formatPoints(shown.reduce((sum, value) => sum + value, 0));
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
  let lost = 0;
  /** The next slot after the earned ones becomes a lost one: dashed, with its « −1 » chip. */
  const lose = (isStamped: boolean): void => {
    const index = score.stars + lost;
    const slot = slots[index] as SVGElement;
    slot.classList.remove('pp-star-empty');
    slot.classList.add('pp-star-lost');
    if (isStamped) slot.classList.add('pp-star-stamped');
    // After the five slots, so that they stay the only `svg` children and keep their tilt rules.
    const chip = make('span', 'pp-star-lost-chip pp-type-label', t('result.star_lost'));
    chip.style.setProperty('--pp-lost-from-end', String(STAR_COUNT_MAX - 1 - index));
    chip.setAttribute('aria-hidden', 'true');
    stars.append(chip);
    lost++;
  };
  const showActions = (): void => {
    cancelAll();
    actions.hidden = false;
    // The finger that skipped, or that was mashing, must not land on « Rejouer » as it appears.
    pressesOpenAtReal = options.now() + timings.inputGraceMs;
    enter('actions');
    replay.focus({ preventScroll: true });
  };
  /**
   * The panel shown, the header of a woken Mama at rest (no slam, no cue), the rows at their totals,
   * the stars placed without a sound, the buttons up. The polaroid stays as it is.
   */
  const complete = (): void => {
    if (phase === 'actions') return;
    cancelAll();
    showPanel();
    mountHeader(false);
    // Mama stays on her last reaction, at rest: a skip plays none of them (story 3.7).
    if (reactions.length > 0) showReaction(reactions.length - 1, true);
    showTotals();
    while (earned < score.stars) earn(false);
    while (lost < lostCount) lose(false);
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
      // The Maison row counts in halves, as it can end on one (7,5); the others never do.
      const perPoint = (rows[index] as Row).kind === 'home' ? 2 : 1;
      showRow(index, Math.round(totalPoints * share * perPoint) / perPoint);
      if (share < 1) later(tick, COUNT_UP_FRAME_MS);
    };
    tick();
  };
  /** The stars a woken Mama took off stamp last, after the earned ones (EXPERIENCE: « stamps last »). */
  const stampLost = (): void => {
    lose(true);
    options.onStarLost();
    if (lost < lostCount) later(stampLost, timings.starIntervalMs);
    else later(showActions, timings.actionsDelayMs);
  };
  const stamp = (index: number): void => {
    earn(true);
    const isLast = index === score.stars - 1;
    options.onStar(isLast);
    if (!isLast) later(() => stamp(index + 1), timings.starIntervalMs);
    else if (lostCount > 0) later(stampLost, timings.starIntervalMs);
    else later(showActions, timings.actionsDelayMs);
  };
  const startStars = (): void => {
    // The last row has landed whatever the frames did: its total is on screen.
    showTotals();
    if (score.stars <= 0 && lostCount <= 0) {
      later(showActions, timings.actionsDelayMs);
      return;
    }
    later(() => {
      enter('stars');
      if (score.stars > 0) stamp(0);
      else stampLost();
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

  /** The rows count up, then the stars: after Mama's last reaction (story 3.7). */
  const startRows = (): void => {
    // Her last reaction is over: she stays on it, at rest, as after a skip.
    if (reactions.length > 0)
      shapeFigures((reactions[reactions.length - 1] as MamaReaction).reaction, true);
    showPanel();
    mountHeader(true);
    enter('rows');
    if (isMamaWoke) options.onMamaWoke();
    if (isMamaHome) options.onMamaHome();
    for (let index = 0; index < rows.length; index++) {
      later(() => countUp(index), index * timings.rowStaggerMs);
    }
    later(startStars, (rows.length - 1) * timings.rowStaggerMs + timings.rowCountUpMs);
  };

  /**
   * Mama's reactions, one after the other, each held for `reactionHoldMs` (the last one too, so that it is
   * read before the rows come): with a photo this follows its hold, otherwise it is the whole start. The
   * panel stays transparent meanwhile and the header of a woken Mama waits for the rows. A hold of 0 goes
   * straight on in the same call.
   */
  const startReactions = (): void => {
    if (reactions.length === 0) {
      startRows();
      return;
    }
    enter('mama');
    const play = (index: number): void => {
      showReaction(index, false);
      options.onMamaReaction((reactions[index] as MamaReaction).reaction);
      const next = index + 1 < reactions.length ? () => play(index + 1) : startRows;
      if (timings.reactionHoldMs === 0) next();
      else later(next, timings.reactionHoldMs);
    };
    play(0);
  };

  if (options.isDone) {
    mountHeader(false);
    if (reactions.length > 0) showReaction(reactions.length - 1, true);
    showTotals();
    while (earned < score.stars) earn(false);
    while (lost < lostCount) lose(false);
    actions.hidden = false;
    enter('actions');
  } else if (polaroid !== null) {
    // The photo stands alone first: the panel is transparent (not `hidden`, which cannot take the
    // focus the host gives it), the polaroid drops in, the cue plays once, and after the hold the rows
    // start. The header of a woken Mama waits for them (EXPERIENCE: the reactions come first, then the rows).
    panel.classList.add('pp-result-panel-waiting');
    polaroid.classList.add('pp-polaroid-drop');
    enter('photo');
    options.onPhoto();
    // A hold of 0 goes straight on: not one task of a transparent panel in between.
    if (timings.photoHoldMs === 0) startReactions();
    else later(startReactions, timings.photoHoldMs);
  } else {
    // No photo: the panel is transparent while Mama reacts, as it is behind the polaroid's hold.
    if (reactions.length > 0) panel.classList.add('pp-result-panel-waiting');
    startReactions();
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
      isDisposed = true;
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
