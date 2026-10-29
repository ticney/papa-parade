import { COUNT_UP_FRAME_MS, JOURNAL_COPY_TIMEOUT_MS, STAR_COUNT_MAX } from '@shared/constants';
import type { MamaScore } from '@sim';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestFeedback } from '../../../../tests/support/testContent.ts';
import {
  type CopyLogOutcome,
  createResultScreen,
  type ResultPhase,
  type ResultScreenOptions,
} from './resultScreen.ts';

type Listener = (event: unknown) => void;

// The little of the DOM the screen and its press button use; the node environment has none.
class FakeElement {
  className = '';
  hidden = false;
  textContent = '';
  type = '';
  tabIndex = 0;
  children: FakeElement[] = [];
  readonly style = { setProperty: (name: string, value: string) => this.styles.set(name, value) };
  styles = new Map<string, string>();
  attributes = new Map<string, string>();
  listeners = new Map<string, Set<Listener>>();
  readonly tag: string;
  constructor(tag: string) {
    this.tag = tag;
  }
  readonly classList = {
    add: (...names: string[]) => this.setClasses([...this.classes(), ...names]),
    remove: (...names: string[]) =>
      this.setClasses(this.classes().filter((name) => !names.includes(name))),
    contains: (name: string) => this.classes().includes(name),
    toggle: () => undefined,
  };
  private classes(): string[] {
    const fromAttribute = this.attributes.get('class') ?? this.className;
    return fromAttribute.split(/\s+/).filter((name) => name !== '');
  }
  private setClasses(names: string[]): void {
    const unique = [...new Set(names)].join(' ');
    if (this.attributes.has('class')) this.attributes.set('class', unique);
    else this.className = unique;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }
  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }
  dispatch(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  focus(): void {
    focused = this;
  }
  click(): void {
    // A keyboard, assistive-technology or pad activation: `click` with `detail` 0.
    this.dispatch('click', { detail: 0 });
  }
  /** Every node under this one, depth first. */
  all(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.all()]);
  }
  find(className: string): FakeElement[] {
    return this.all().filter((node) => node.classList.contains(className));
  }
}

let focused: FakeElement | null = null;
const doc = {
  createElement: (tag: string) => new FakeElement(tag),
  createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
};

/** A fake real-time scheduler: the test moves the clock and the due timers run in order. */
function createClock() {
  let nowMs = 0;
  let nextHandle = 1;
  const timers = new Map<number, { atMs: number; run: () => void }>();
  return {
    scheduler: {
      schedule(run: () => void, delayMs: number) {
        const handle = nextHandle++;
        timers.set(handle, { atMs: nowMs + delayMs, run });
        return handle;
      },
      cancel(handle: number) {
        timers.delete(handle);
      },
    },
    now: () => nowMs,
    get pending() {
      return timers.size;
    },
    /** Runs every timer due by `nowMs + ms`, in time order, moving the clock to each. */
    advance(ms: number) {
      const until = nowMs + ms;
      for (;;) {
        let next: [number, { atMs: number; run: () => void }] | null = null;
        for (const entry of timers) {
          if (entry[1].atMs <= until && (next === null || entry[1].atMs < next[1].atMs)) {
            next = entry;
          }
        }
        if (next === null) break;
        timers.delete(next[0]);
        nowMs = next[1].atMs;
        next[1].run();
      }
      nowMs = until;
    },
  };
}

const timings = createTestFeedback().resultScreen;
const maxima = {
  laughMaxPoints: 40,
  babyStateMaxPoints: 30,
  sighMaxPoints: 15,
  screamMaxPoints: 15,
};
/** 32 + 20 + 9 + 12 = 73: the mockup's game. */
const SCORE: MamaScore = {
  laughPoints: 32,
  babyStatePoints: 20,
  sighPoints: 6,
  screamPoints: 3,
  scorePoints: 73,
  stars: 3,
  lostStars: 0,
};
const ROW_TOTALS = [32, 20, 9, 12];
/** When the last row lands, from the build. */
const ROWS_END_MS = 3 * timings.rowStaggerMs + timings.rowCountUpMs;

function build(overrides: Partial<ResultScreenOptions> = {}) {
  const clock = createClock();
  const calls: string[] = [];
  const phases: ResultPhase[] = [];
  const keys = new FakeElement('window');
  const screen = createResultScreen({
    t: (key) => key,
    score: SCORE,
    endReason: 'timer',
    maxima,
    timings,
    isDone: false,
    scheduler: clock.scheduler,
    now: clock.now,
    keyTarget: keys as never,
    onStar: (isLast) => calls.push(isLast ? 'last star' : 'star'),
    onMamaWoke: () => calls.push('mama woke'),
    onStarLost: () => calls.push('star lost'),
    onPhase: (phase) => phases.push(phase),
    onReplay: () => calls.push('replay'),
    doc: doc as never,
    ...overrides,
  });
  const root = screen.element as unknown as FakeElement;
  const panel = root.children[0] as FakeElement;
  const values = () => root.find('pp-score-value').map((node) => Number(node.textContent));
  const earned = () => root.find('pp-star-earned').length;
  const lost = () => root.find('pp-star-lost').length;
  const stamped = () => root.find('pp-star-stamped').length;
  const actions = root.find('pp-result-actions')[0] as FakeElement;
  const replay = actions.children[0] as FakeElement;
  const total = () => Number(root.find('pp-score-total-value')[0]?.textContent);
  return {
    screen,
    root,
    panel,
    clock,
    calls,
    phases,
    keys,
    values,
    earned,
    lost,
    stamped,
    actions,
    replay,
    total,
  };
}

describe('createResultScreen', () => {
  beforeEach(() => {
    focused = null;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds the dialog, the four rows with their labels and maxima, the total out of the summed maxima, and five star slots', () => {
    const { root, panel } = build();
    expect(root.className).toBe('pp-overlay pp-result-screen');
    expect(panel.tag).toBe('section');
    expect(panel.className).toContain('pp-panel');
    expect(panel.className).toContain('pp-result-panel');
    expect(panel.attributes.get('role')).toBe('dialog');
    expect(panel.attributes.get('aria-modal')).toBe('true');
    expect(panel.attributes.get('aria-label')).toBe('result.title');
    const card = root.find('pp-score-card')[0] as FakeElement;
    expect(card.attributes.get('role')).toBe('table');
    expect(card.attributes.get('aria-label')).toBe('result.score_label');
    const rows = root.find('pp-score-row');
    expect(rows).toHaveLength(4);
    expect(root.find('pp-score-label').map((node) => node.textContent)).toEqual([
      'result.score_laughs',
      'result.score_baby_state',
      'result.score_no_sigh',
      'result.score_no_scream',
    ]);
    expect(root.find('pp-score-max').map((node) => node.textContent)).toEqual([
      '/40',
      '/30',
      '/15',
      '/15',
    ]);
    expect(
      ['laugh', 'baby', 'sigh', 'scream'].map((kind) => root.find(`pp-score-chip-${kind}`).length),
    ).toEqual([1, 1, 1, 1]);
    expect(root.find('pp-score-total-max')[0]?.textContent).toBe('/100');
    const stars = root.find('pp-stars')[0] as FakeElement;
    expect(stars.attributes.get('role')).toBe('img');
    expect(stars.attributes.get('aria-label')).toBe('result.stars_label');
    expect(root.find('pp-star')).toHaveLength(STAR_COUNT_MAX);
    expect(root.find('pp-star-empty')).toHaveLength(STAR_COUNT_MAX);
  });

  it('reads every maximum from what it is given, never from code', () => {
    const { root } = build({
      maxima: {
        laughMaxPoints: 50,
        babyStateMaxPoints: 20,
        sighMaxPoints: 20,
        screamMaxPoints: 10,
      },
    });
    expect(root.find('pp-score-max').map((node) => node.textContent)).toEqual([
      '/50',
      '/20',
      '/20',
      '/10',
    ]);
    expect(root.find('pp-score-total-max')[0]?.textContent).toBe('/100');
  });

  it('formats the stars label with the count and the five slots', () => {
    const { root } = build({
      t: (key) => (key === 'result.stars_label' ? '{count} sur {max}' : key),
    });
    expect(root.find('pp-stars')[0]?.attributes.get('aria-label')).toBe(`3 sur ${STAR_COUNT_MAX}`);
  });

  it('counts each row up to its total in rowCountUpMs, each starting rowStaggerMs after the last, the total following', () => {
    const { clock, values, total, phases } = build();
    expect(phases).toEqual(['rows']);
    expect(values()).toEqual([0, 0, 0, 0]);
    clock.advance(timings.rowCountUpMs / 2);
    const half = values();
    expect(half[0]).toBeGreaterThan(0);
    expect(half[0]).toBeLessThan(ROW_TOTALS[0] as number);
    clock.advance(timings.rowCountUpMs / 2);
    expect(values()[0]).toBe(ROW_TOTALS[0]);
    // The second row started rowStaggerMs after the first: it lands as long after it.
    expect(values()[1]).toBeLessThan(ROW_TOTALS[1] as number);
    clock.advance(timings.rowStaggerMs);
    expect(values()[1]).toBe(ROW_TOTALS[1]);
    clock.advance(ROWS_END_MS - timings.rowCountUpMs - timings.rowStaggerMs);
    expect(values()).toEqual(ROW_TOTALS);
    expect(total()).toBe(SCORE.scorePoints);
  });

  it('shows 0 at once for a row whose total is 0, and schedules no count-up frame for it', () => {
    // Four rows at 0: laugh 0, baby 0, and the sigh and scream rows have lost their whole maximum.
    const { clock, values } = build({
      score: {
        laughPoints: 0,
        babyStatePoints: 0,
        sighPoints: maxima.sighMaxPoints,
        screamPoints: maxima.screamMaxPoints,
        scorePoints: 30,
        stars: 1,
        lostStars: 0,
      },
    });
    expect(values()).toEqual([0, 0, 0, 0]);
    // Left: the three rows still to start and the stars. A count-up frame would make it five.
    clock.advance(1);
    expect(clock.pending).toBe(4);
    clock.advance(COUNT_UP_FRAME_MS);
    expect(values()).toEqual([0, 0, 0, 0]);
  });

  it('stamps the earned stars starsDelayMs after the rows, starIntervalMs apart, the last one marked', () => {
    const { clock, calls, earned, stamped, phases } = build();
    clock.advance(ROWS_END_MS);
    expect(earned()).toBe(0);
    clock.advance(timings.starsDelayMs);
    expect(phases).toEqual(['rows', 'stars']);
    expect(calls).toEqual(['star']);
    expect(earned()).toBe(1);
    clock.advance(timings.starIntervalMs);
    expect(calls).toEqual(['star', 'star']);
    clock.advance(timings.starIntervalMs);
    expect(calls).toEqual(['star', 'star', 'last star']);
    expect(earned()).toBe(SCORE.stars);
    expect(stamped()).toBe(SCORE.stars);
    clock.advance(10 * timings.starIntervalMs);
    expect(calls).toEqual(['star', 'star', 'last star']);
  });

  it('with one star, that star is the last', () => {
    const { clock, calls } = build({ score: { ...SCORE, scorePoints: 25, stars: 1 } });
    clock.advance(ROWS_END_MS + timings.starsDelayMs);
    expect(calls).toEqual(['last star']);
  });

  it('brings the buttons up actionsDelayMs after the last stamp, and focuses « Rejouer »', () => {
    const { clock, actions, replay, phases } = build();
    const lastStampMs = ROWS_END_MS + timings.starsDelayMs + 2 * timings.starIntervalMs;
    clock.advance(lastStampMs + timings.actionsDelayMs - 1);
    expect(actions.hidden).toBe(true);
    clock.advance(1);
    expect(actions.hidden).toBe(false);
    expect(phases).toEqual(['rows', 'stars', 'actions']);
    expect(focused).toBe(replay);
    expect(replay.textContent).toBe('result.replay_button');
    expect(replay.attributes.get('aria-label')).toBe('result.replay_button');
    expect(clock.pending).toBe(0);
  });

  it('with 0 stars, calls no star and brings the buttons up actionsDelayMs after the rows', () => {
    const { clock, calls, actions, phases } = build({
      score: { ...SCORE, scorePoints: 10, stars: 0 },
    });
    clock.advance(ROWS_END_MS + timings.actionsDelayMs - 1);
    expect(actions.hidden).toBe(true);
    clock.advance(1);
    expect(actions.hidden).toBe(false);
    expect(calls).toEqual([]);
    expect(phases).toEqual(['rows', 'actions']);
  });

  it('focuses the panel while the sequence runs, and « Rejouer » on a done build', () => {
    const running = build();
    expect(running.screen.initialFocus).toBe(running.panel as never);
    const done = build({ isDone: true });
    expect(done.screen.initialFocus).toBe(done.replay as never);
  });

  it('skips on a press of the screen: everything at its end, the stars placed silently, and the press does not replay', () => {
    const { root, clock, calls, values, earned, stamped, actions, replay, phases } = build();
    clock.advance(timings.rowCountUpMs / 3);
    root.dispatch('pointerdown', { pointerId: 7, isPrimary: true });
    root.dispatch('pointerup', { pointerId: 7 });
    expect(values()).toEqual(ROW_TOTALS);
    expect(earned()).toBe(SCORE.stars);
    expect(stamped()).toBe(0);
    expect(actions.hidden).toBe(false);
    expect(focused).toBe(replay);
    expect(phases.at(-1)).toBe('actions');
    expect(clock.pending).toBe(0);
    clock.advance(10_000);
    expect(calls).toEqual([]);
  });

  it('does not skip on a release that began elsewhere', () => {
    const { root, actions } = build();
    root.dispatch('pointerup', { pointerId: 3 });
    expect(actions.hidden).toBe(true);
  });

  it.each(['Enter', 'Space', 'NumpadEnter'])(
    'skips on %s, and the held key does not press « Rejouer » until it is let go',
    (code) => {
      const { keys, replay, calls, actions } = build();
      let isPrevented = false;
      keys.dispatch('keydown', { code, repeat: false, preventDefault: () => (isPrevented = true) });
      expect(isPrevented).toBe(true);
      expect(actions.hidden).toBe(false);
      expect(focused).toBe(replay);
      // Space activates the focused button on keyup: still held, ignored.
      replay.click();
      expect(calls).toEqual([]);
      keys.dispatch('keyup', { code });
      replay.click();
      expect(calls).toEqual(['replay']);
    },
  );

  it('ignores other keys, and a repeat', () => {
    const { keys, actions } = build();
    keys.dispatch('keydown', { code: 'KeyA', repeat: false, preventDefault: () => undefined });
    keys.dispatch('keydown', { code: 'Enter', repeat: true, preventDefault: () => undefined });
    keys.dispatch('keydown', { code: 'Escape', repeat: false, preventDefault: () => undefined });
    expect(actions.hidden).toBe(true);
  });

  it('activate() skips while the sequence runs, then presses « Rejouer »', () => {
    const { screen, calls, actions } = build();
    screen.activate?.();
    expect(actions.hidden).toBe(false);
    expect(calls).toEqual([]);
    screen.activate?.();
    expect(calls).toEqual(['replay']);
  });

  describe('with an input grace', () => {
    const GRACE_MS = 300;
    const graced = { ...timings, inputGraceMs: GRACE_MS };
    const press = (root: FakeElement, pointerId: number) => {
      root.dispatch('pointerdown', { pointerId, isPrimary: true });
      root.dispatch('pointerup', { pointerId });
    };

    it('ignores a press that starts within the grace, and skips one that starts after it', () => {
      const { root, clock, actions } = build({ timings: graced });
      clock.advance(GRACE_MS - 1);
      press(root, 1);
      expect(actions.hidden).toBe(true);
      // Down within the grace, up after it: still a press that began too early.
      root.dispatch('pointerdown', { pointerId: 2, isPrimary: true });
      clock.advance(2);
      root.dispatch('pointerup', { pointerId: 2 });
      expect(actions.hidden).toBe(true);
      press(root, 3);
      expect(actions.hidden).toBe(false);
    });

    it('ignores Enter and the pad A within the grace (Enter is still kept from its default), then skips', () => {
      const { screen, keys, clock, actions } = build({ timings: graced });
      let isPrevented = false;
      keys.dispatch('keydown', {
        code: 'Enter',
        repeat: false,
        preventDefault: () => (isPrevented = true),
      });
      screen.activate?.();
      expect(isPrevented).toBe(true);
      expect(actions.hidden).toBe(true);
      clock.advance(GRACE_MS);
      screen.activate?.();
      expect(actions.hidden).toBe(false);
    });

    it('keeps « Rejouer » shut for the grace after the buttons come up, whoever skipped', () => {
      const { root, screen, replay, clock, calls } = build({ timings: graced });
      clock.advance(GRACE_MS);
      press(root, 1);
      // The third stray tap lands on the button that just came up.
      replay.click();
      screen.activate?.();
      expect(calls).toEqual([]);
      clock.advance(GRACE_MS);
      replay.click();
      expect(calls).toEqual(['replay']);
    });

    it('keeps « Rejouer » shut for the grace after the buttons come up on their own', () => {
      const { replay, clock, calls, actions } = build({ timings: graced });
      clock.advance(ROWS_END_MS + timings.starsDelayMs + 2 * timings.starIntervalMs);
      clock.advance(timings.actionsDelayMs);
      expect(actions.hidden).toBe(false);
      const stamps = [...calls];
      replay.click();
      expect(calls).toEqual(stamps);
      clock.advance(GRACE_MS);
      replay.click();
      expect(calls).toEqual([...stamps, 'replay']);
    });

    it('takes presses at once on a rebuilt, finished screen', () => {
      const { replay, calls } = build({ timings: graced, isDone: true });
      replay.click();
      expect(calls).toEqual(['replay']);
    });
  });

  it('forgets a held skip key when the window loses focus: « Rejouer » answers again', () => {
    const { keys, replay, calls } = build();
    keys.dispatch('keydown', { code: 'Space', repeat: false, preventDefault: () => undefined });
    replay.click();
    expect(calls).toEqual([]);
    // Alt-Tab: the keyup never reaches the window.
    keys.dispatch('blur', {});
    replay.click();
    expect(calls).toEqual(['replay']);
  });

  it('shows the end at once on a done build: no star call, no timer, the buttons up', () => {
    const { clock, calls, values, earned, stamped, actions, phases } = build({ isDone: true });
    expect(values()).toEqual(ROW_TOTALS);
    expect(earned()).toBe(SCORE.stars);
    expect(stamped()).toBe(0);
    expect(actions.hidden).toBe(false);
    expect(phases).toEqual(['actions']);
    expect(clock.pending).toBe(0);
    clock.advance(10_000);
    expect(calls).toEqual([]);
  });

  it('renders no « Copier le journal » without a copyLog action, and one with it', () => {
    vi.stubEnv('VITE_DEBUG_ALLOWED', 'true');
    try {
      expect(build().actions.children).toHaveLength(1);
      const withCopy = build({ copyLog: () => Promise.resolve('copied') });
      expect(withCopy.actions.children.map((node) => node.textContent)).toEqual([
        'result.replay_button',
        'result.copy_log',
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('renders no « Copier le journal » in a build where debug is not allowed, copyLog or not', () => {
    vi.stubEnv('VITE_DEBUG_ALLOWED', 'false');
    try {
      const { actions } = build({ copyLog: () => Promise.resolve('copied') });
      expect(actions.children.map((node) => node.textContent)).toEqual(['result.replay_button']);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('dispose() cancels every timer and unbinds the keys', () => {
    const { screen, clock, calls, keys, actions } = build();
    clock.advance(timings.rowCountUpMs);
    screen.dispose();
    expect(clock.pending).toBe(0);
    clock.advance(10_000);
    expect(calls).toEqual([]);
    keys.dispatch('keydown', { code: 'Enter', repeat: false, preventDefault: () => undefined });
    expect(actions.hidden).toBe(true);
  });
});

describe('createResultScreen: a woken Mama (story 3.2)', () => {
  beforeEach(() => {
    focused = null;
  });

  /** The mockup's state B, with its numbers: 2 base stars, 1 lost, 1 left. */
  const WOKEN: MamaScore = { ...SCORE, scorePoints: 44, stars: 1, lostStars: 1 };
  const woken = (overrides: Partial<ResultScreenOptions> = {}) =>
    build({ endReason: 'mamaWoke', score: WOKEN, ...overrides });
  /** When the last earned star of `WOKEN` (the only one) stamps. */
  const FIRST_STAMP_MS = ROWS_END_MS + timings.starsDelayMs;

  it('puts the header « result.mama_woke » over the card after a mamaWoke end, and none after a timer end', () => {
    const { root, panel } = woken();
    const header = root.find('pp-result-reason')[0] as FakeElement;
    expect(header.tag).toBe('h2');
    expect(header.textContent).toBe('result.mama_woke');
    expect(header.classList.contains('pp-type-heading')).toBe(true);
    expect(header.classList.contains('pp-result-reason-slam')).toBe(true);
    expect(panel.children[0]).toBe(header);
    expect(panel.classList.contains('pp-result-panel-woken')).toBe(true);
    expect(build().panel.classList.contains('pp-result-panel-woken')).toBe(false);
    expect(panel.children[1]?.classList.contains('pp-score-card')).toBe(true);
    const timer = build();
    expect(timer.root.find('pp-result-reason')).toHaveLength(0);
    expect(timer.root.all().some((node) => node.tag === 'h2')).toBe(false);
  });

  it('calls onMamaWoke once, when the sequence starts, and never for a timer end', () => {
    const { clock, calls } = woken();
    expect(calls).toEqual(['mama woke']);
    clock.advance(20_000);
    expect(calls.filter((call) => call === 'mama woke')).toHaveLength(1);
    expect(build().calls).toEqual([]);
  });

  it('shows the header at rest on a done build: no slam class, no onMamaWoke', () => {
    const { root, calls } = woken({ isDone: true });
    const header = root.find('pp-result-reason')[0] as FakeElement;
    expect(header.textContent).toBe('result.mama_woke');
    expect(header.classList.contains('pp-result-reason-slam')).toBe(false);
    expect(calls).toEqual([]);
  });

  it('makes the slots after the earned ones lost slots, with a « −1 » chip, once the lost star stamps', () => {
    const { root, clock, earned, lost } = woken();
    clock.advance(FIRST_STAMP_MS);
    expect(earned()).toBe(1);
    expect(lost()).toBe(0);
    expect(root.find('pp-star-lost-chip')).toHaveLength(0);
    clock.advance(timings.starIntervalMs);
    expect(lost()).toBe(1);
    const slots = root.find('pp-stars')[0]?.children.filter((node) => node.tag === 'svg') ?? [];
    expect(slots).toHaveLength(STAR_COUNT_MAX);
    expect(slots.map((slot) => slot.classList.contains('pp-star-earned'))).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(slots.map((slot) => slot.classList.contains('pp-star-lost'))).toEqual([
      false,
      true,
      false,
      false,
      false,
    ]);
    // A lost slot is never an earned one, and it stamps (the animation carries the tilt).
    expect(slots[1]?.classList.contains('pp-star-stamped')).toBe(true);
    expect(slots[1]?.classList.contains('pp-star-empty')).toBe(false);
    const chips = root.find('pp-star-lost-chip');
    expect(chips).toHaveLength(1);
    expect(chips[0]?.textContent).toBe('result.star_lost');
    expect(chips[0]?.styles.get('--pp-lost-from-end')).toBe('3');
    // After the five slots: they stay the only `svg` children, the chip comes behind them.
    const stars = root.find('pp-stars')[0] as FakeElement;
    expect(stars.children.slice(0, STAR_COUNT_MAX).every((node) => node.tag === 'svg')).toBe(true);
    expect(stars.children.slice(STAR_COUNT_MAX)).toEqual(chips);
  });

  it('stamps the lost star starIntervalMs after the last earned one, then brings the actions up after actionsDelayMs', () => {
    const { clock, calls, actions, phases } = woken();
    clock.advance(FIRST_STAMP_MS);
    expect(calls).toEqual(['mama woke', 'last star']);
    clock.advance(timings.starIntervalMs - 1);
    expect(calls).toEqual(['mama woke', 'last star']);
    clock.advance(1);
    expect(calls).toEqual(['mama woke', 'last star', 'star lost']);
    // The actions are after the lost star, not after the last earned one.
    clock.advance(timings.actionsDelayMs - 1);
    expect(actions.hidden).toBe(true);
    clock.advance(1);
    expect(actions.hidden).toBe(false);
    expect(phases).toEqual(['rows', 'stars', 'actions']);
    clock.advance(10_000);
    expect(calls).toEqual(['mama woke', 'last star', 'star lost']);
  });

  it('calls onStarLost after the last onStar(true) and before the actions phase', () => {
    const order: string[] = [];
    const { clock } = woken({
      onStar: (isLast) => order.push(isLast ? 'last star' : 'star'),
      onStarLost: () => order.push('star lost'),
      onPhase: (phase) => order.push(`phase ${phase}`),
    });
    clock.advance(20_000);
    expect(order).toEqual(['phase rows', 'phase stars', 'last star', 'star lost', 'phase actions']);
  });

  it('with 0 earned stars and 1 lost, the lost star stamps right after starsDelayMs', () => {
    const { clock, calls, lost, phases, root } = woken({
      score: { ...WOKEN, scorePoints: 10, stars: 0, lostStars: 1 },
    });
    clock.advance(FIRST_STAMP_MS - 1);
    expect(lost()).toBe(0);
    clock.advance(1);
    expect(phases).toEqual(['rows', 'stars']);
    expect(lost()).toBe(1);
    expect(calls).toEqual(['mama woke', 'star lost']);
    expect(root.find('pp-star-lost-chip')[0]?.styles.get('--pp-lost-from-end')).toBe('4');
    clock.advance(timings.actionsDelayMs);
    expect(phases).toEqual(['rows', 'stars', 'actions']);
  });

  it('stamps several lost stars one after the other, starIntervalMs apart', () => {
    const { clock, calls, lost, root } = woken({
      score: { ...WOKEN, stars: 1, lostStars: 2 },
    });
    clock.advance(FIRST_STAMP_MS + timings.starIntervalMs);
    expect(lost()).toBe(1);
    clock.advance(timings.starIntervalMs);
    expect(lost()).toBe(2);
    expect(calls.filter((call) => call === 'star lost')).toHaveLength(2);
    expect(
      root.find('pp-star-lost-chip').map((chip) => chip.styles.get('--pp-lost-from-end')),
    ).toEqual(['3', '2']);
  });

  it('places the lost star silently on a skip: no onStarLost, chip there', () => {
    const { root, clock, calls, lost, earned, stamped, actions } = woken();
    clock.advance(timings.rowCountUpMs / 3);
    root.dispatch('pointerdown', { pointerId: 7, isPrimary: true });
    root.dispatch('pointerup', { pointerId: 7 });
    expect(earned()).toBe(1);
    expect(lost()).toBe(1);
    expect(stamped()).toBe(0);
    expect(root.find('pp-star-lost-chip')).toHaveLength(1);
    expect(actions.hidden).toBe(false);
    clock.advance(10_000);
    expect(calls).toEqual(['mama woke']);
  });

  it('places the lost star silently on a done build', () => {
    const { root, calls, lost, earned, clock } = woken({ isDone: true });
    expect(earned()).toBe(1);
    expect(lost()).toBe(1);
    expect(root.find('pp-star-lost-chip')).toHaveLength(1);
    expect(clock.pending).toBe(0);
    expect(calls).toEqual([]);
  });

  it('labels the stars with the lost one when there is one, and with the plain label otherwise', () => {
    const t = (key: string): string =>
      key === 'result.stars_lost_label'
        ? '{count} sur {max}, {lost} en moins'
        : key === 'result.stars_label'
          ? '{count} sur {max}'
          : key;
    expect(woken({ t }).root.find('pp-stars')[0]?.attributes.get('aria-label')).toBe(
      `1 sur ${STAR_COUNT_MAX}, 1 en moins`,
    );
    expect(build({ t }).root.find('pp-stars')[0]?.attributes.get('aria-label')).toBe(
      `3 sur ${STAR_COUNT_MAX}`,
    );
  });

  it('never makes more lost slots than there are slots after the earned ones', () => {
    const { lost } = woken({ score: { ...WOKEN, stars: 4, lostStars: 3 }, isDone: true });
    expect(lost()).toBe(1);
  });

  it('keeps a timer end exactly as before: no lost slot, no chip, no onStarLost', () => {
    const { clock, root, calls, lost } = build();
    clock.advance(20_000);
    expect(lost()).toBe(0);
    expect(root.find('pp-star-lost-chip')).toHaveLength(0);
    expect(calls).toEqual(['star', 'star', 'last star']);
  });
});

describe('createResultScreen: the copy button (story 3.3)', () => {
  const GRACE_MS = 600;
  beforeEach(() => {
    focused = null;
    vi.stubEnv('VITE_DEBUG_ALLOWED', 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** Lets the promise chains of the screen settle (a few microtask turns). */
  async function settle(): Promise<void> {
    for (let turn = 0; turn < 5; turn++) await Promise.resolve();
  }

  function deferred() {
    let resolve: (outcome: CopyLogOutcome) => void = () => undefined;
    let reject: (cause: unknown) => void = () => undefined;
    const promise = new Promise<CopyLogOutcome>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    return { promise, resolve, reject };
  }

  /** A finished screen (the buttons are up, the grace is over) whose copy action answers `outcome`. */
  function buildCopy(
    outcome: CopyLogOutcome | (() => Promise<CopyLogOutcome>) = 'copied',
    overrides: Partial<ResultScreenOptions> = {},
  ) {
    let pressCount = 0;
    const copyLog = () => {
      pressCount++;
      return typeof outcome === 'function' ? outcome() : Promise.resolve(outcome);
    };
    const made = build({ copyLog, isDone: true, ...overrides });
    const copy = made.actions.children[1] as FakeElement;
    return { ...made, copy, presses: () => pressCount };
  }

  it('starts at « Copier le journal », with the same text as its accessible name', () => {
    const { copy } = buildCopy();
    expect(copy.textContent).toBe('result.copy_log');
    expect(copy.attributes.get('aria-label')).toBe('result.copy_log');
  });

  it('calls the action synchronously inside the press, before any await', () => {
    const { copy, presses } = buildCopy();
    copy.click();
    expect(presses()).toBe(1);
  });

  it('a copy that never settles is given up after the timeout: the button works again', async () => {
    const never = new Promise<CopyLogOutcome>(() => undefined);
    let answers: Promise<CopyLogOutcome> = never;
    const { copy, presses, clock } = buildCopy(() => answers);
    copy.click();
    copy.click();
    expect(presses()).toBe(1);
    clock.advance(JOURNAL_COPY_TIMEOUT_MS);
    await settle();
    expect(copy.textContent).toBe('result.copy_log');
    answers = Promise.resolve('copied');
    copy.click();
    expect(presses()).toBe(2);
    await settle();
    expect(copy.textContent).toBe('result.log_copied');
  });

  it('a late answer after the timeout changes nothing', async () => {
    const answer = deferred();
    const { copy, clock } = buildCopy(() => answer.promise);
    copy.click();
    clock.advance(JOURNAL_COPY_TIMEOUT_MS);
    answer.resolve('copied');
    await settle();
    expect(copy.textContent).toBe('result.copy_log');
  });

  it('says « Journal copié ! » once the text is on the clipboard', async () => {
    const { copy } = buildCopy('copied');
    copy.click();
    expect(copy.textContent).toBe('result.copy_log');
    await settle();
    expect(copy.textContent).toBe('result.log_copied');
    expect(copy.attributes.get('aria-label')).toBe('result.log_copied');
  });

  it('says « Télécharger le journal » once the file was downloaded', async () => {
    const { copy } = buildCopy('downloaded');
    copy.click();
    await settle();
    expect(copy.textContent).toBe('result.download_log');
    expect(copy.attributes.get('aria-label')).toBe('result.download_log');
  });

  it('keeps its label when the action failed', async () => {
    const { copy } = buildCopy('failed');
    copy.click();
    await settle();
    expect(copy.textContent).toBe('result.copy_log');
    expect(copy.attributes.get('aria-label')).toBe('result.copy_log');
  });

  it('keeps the label of an earlier success when a later press fails', async () => {
    const outcomes: CopyLogOutcome[] = ['copied', 'failed'];
    const { copy, presses } = buildCopy(() => Promise.resolve(outcomes.shift() ?? 'failed'));
    copy.click();
    await settle();
    copy.click();
    await settle();
    expect(presses()).toBe(2);
    expect(copy.textContent).toBe('result.log_copied');
  });

  it('stays pressable after a success: a second press runs the action again', async () => {
    const { copy, presses } = buildCopy('copied');
    copy.click();
    await settle();
    copy.click();
    await settle();
    expect(presses()).toBe(2);
    expect(copy.textContent).toBe('result.log_copied');
  });

  it('ignores a press while the action is pending, and answers again once it is settled', async () => {
    const pending = deferred();
    const { copy, presses } = buildCopy(() => pending.promise);
    copy.click();
    copy.click();
    copy.click();
    expect(presses()).toBe(1);
    pending.resolve('copied');
    await settle();
    expect(copy.textContent).toBe('result.log_copied');
    copy.click();
    expect(presses()).toBe(2);
  });

  it('survives an action that rejects: the label stays and a later press works', async () => {
    const pending = deferred();
    let isFirst = true;
    const { copy, presses } = buildCopy(() => {
      if (!isFirst) return Promise.resolve('copied');
      isFirst = false;
      return pending.promise;
    });
    copy.click();
    pending.reject(new Error('boom'));
    await settle();
    expect(copy.textContent).toBe('result.copy_log');
    copy.click();
    await settle();
    expect(presses()).toBe(2);
    expect(copy.textContent).toBe('result.log_copied');
  });

  it('survives an action that throws at once: the label stays and a later press works', async () => {
    let isFirst = true;
    const { copy, presses } = buildCopy(() => {
      if (isFirst) {
        isFirst = false;
        throw new Error('boom');
      }
      return Promise.resolve('downloaded');
    });
    copy.click();
    await settle();
    expect(copy.textContent).toBe('result.copy_log');
    copy.click();
    await settle();
    expect(presses()).toBe(2);
    expect(copy.textContent).toBe('result.download_log');
  });

  it('drops an outcome that arrives after dispose()', async () => {
    const pending = deferred();
    const { copy, screen } = buildCopy(() => pending.promise);
    copy.click();
    screen.dispose();
    pending.resolve('copied');
    await settle();
    expect(copy.textContent).toBe('result.copy_log');
    expect(copy.attributes.get('aria-label')).toBe('result.copy_log');
  });

  it('a screen rebuilt after the portrait overlay starts again at « Copier le journal »', async () => {
    const first = buildCopy('copied');
    first.copy.click();
    await settle();
    first.screen.dispose();
    const rebuilt = buildCopy('copied');
    expect(rebuilt.copy.textContent).toBe('result.copy_log');
  });

  it('does nothing after dispose(): the button is unbound', () => {
    const { copy, screen, presses } = buildCopy();
    screen.dispose();
    copy.click();
    expect(presses()).toBe(0);
  });

  describe('the input grace and the skip rules of « Rejouer » apply to it', () => {
    const graced = { ...timings, inputGraceMs: GRACE_MS };

    it('ignores a press during the grace after the buttons come up', async () => {
      const { copy, presses, clock } = buildCopy('copied', { timings: graced, isDone: false });
      clock.advance(ROWS_END_MS + timings.starsDelayMs + 2 * timings.starIntervalMs);
      clock.advance(timings.actionsDelayMs);
      copy.click();
      expect(presses()).toBe(0);
      clock.advance(GRACE_MS);
      copy.click();
      expect(presses()).toBe(1);
    });

    it('ignores a press while the sequence is still being skipped by a held key', () => {
      const { copy, presses, clock, keys } = buildCopy('copied', {
        timings: graced,
        isDone: false,
      });
      clock.advance(GRACE_MS);
      keys.dispatch('keydown', { code: 'Space', repeat: false, preventDefault: () => undefined });
      copy.click();
      expect(presses()).toBe(0);
      keys.dispatch('keyup', { code: 'Space' });
      clock.advance(GRACE_MS);
      copy.click();
      expect(presses()).toBe(1);
    });

    it('takes a press at once on a rebuilt, finished screen', () => {
      const { copy, presses } = buildCopy('copied', { timings: graced, isDone: true });
      copy.click();
      expect(presses()).toBe(1);
    });
  });

  it('never takes the initial focus: « Rejouer » does on a finished screen, the panel while it runs', () => {
    const done = buildCopy('copied', { isDone: true });
    expect(done.screen.initialFocus).toBe(done.replay as never);
    expect(done.screen.initialFocus).not.toBe(done.copy as never);
    const running = buildCopy('copied', { isDone: false });
    expect(running.screen.initialFocus).toBe(running.panel as never);
  });

  it("a pad's A presses « Rejouer », never the copy button", () => {
    const { screen, calls, presses } = buildCopy('copied', { isDone: true });
    screen.activate?.();
    expect(calls).toEqual(['replay']);
    expect(presses()).toBe(0);
  });
});
