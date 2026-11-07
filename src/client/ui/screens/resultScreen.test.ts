import {
  COUNT_UP_FRAME_MS,
  JOURNAL_COPY_TIMEOUT_MS,
  type MamaReactionId,
  STAR_COUNT_MAX,
} from '@shared/constants';
import type { MamaReactionLine, MamaScore } from '@sim';
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
  type = '';
  tabIndex = 0;
  children: FakeElement[] = [];
  private ownText = '';
  // As in the DOM: the text of an element is its own, or its children's put together, and setting it drops the children.
  get textContent(): string {
    return this.children.length > 0
      ? this.children.map((child) => child.textContent).join('')
      : this.ownText;
  }
  set textContent(value: string) {
    this.children = [];
    this.ownText = value;
  }
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
  prepend(...children: FakeElement[]): void {
    this.children.unshift(...children);
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
  createTextNode: (text: string) => {
    const node = new FakeElement('#text');
    node.textContent = text;
    return node;
  },
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
  laughMaxPoints: 35,
  calmMaxPoints: 20,
  homeMaxPoints: 15,
  sighMaxPoints: 15,
  screamMaxPoints: 15,
};
/** 28 + 14 + 5 + 9 + 12 = 68: a game with a chore done (E9 fills the Maison row; it is 0 before). */
const SCORE: MamaScore = {
  laughPoints: 28,
  calmPoints: 14,
  homePoints: 5,
  sighPoints: 6,
  screamPoints: 3,
  scorePoints: 68,
  stars: 3,
  lostStars: 0,
};
const ROW_TOTALS = [28, 14, 5, 9, 12];
/** When the last row lands, from the build. */
const ROWS_END_MS = 4 * timings.rowStaggerMs + timings.rowCountUpMs;

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
    // No photo by default: the sequence starts at `rows`, as it did before story 3.6.
    photo: null,
    // No reaction by default: the `mama` phase has its own describe below (story 3.7).
    reactions: [],
    scheduler: clock.scheduler,
    now: clock.now,
    keyTarget: keys as never,
    onPhoto: () => calls.push('photo'),
    onMamaReaction: (reaction) => calls.push(`mama ${reaction}`),
    onStar: (isLast) => calls.push(isLast ? 'last star' : 'star'),
    onMamaWoke: () => calls.push('mama woke'),
    onMamaHome: () => calls.push('mama home'),
    onStarLost: () => calls.push('star lost'),
    onPhase: (phase) => phases.push(phase),
    onReplay: () => calls.push('replay'),
    doc: doc as never,
    ...overrides,
  });
  const root = screen.element as unknown as FakeElement;
  // With a photo the polaroid comes first in the screen: the panel is found by its class.
  const panel = root.find('pp-result-panel')[0] as FakeElement;
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

  it('builds the dialog, the five rows with their labels and maxima, the total out of the summed maxima, and five star slots', () => {
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
    expect(rows).toHaveLength(5);
    expect(root.find('pp-score-label').map((node) => node.textContent)).toEqual([
      'result.score_laughs',
      'result.score_calm',
      'result.score_home',
      'result.score_no_sigh',
      'result.score_no_scream',
    ]);
    expect(root.find('pp-score-max').map((node) => node.textContent)).toEqual([
      '/35',
      '/20',
      '/15',
      '/15',
      '/15',
    ]);
    expect(
      ['laugh', 'calm', 'home', 'sigh', 'scream'].map(
        (kind) => root.find(`pp-score-chip-${kind}`).length,
      ),
    ).toEqual([1, 1, 1, 1, 1]);
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
        calmMaxPoints: 10,
        homeMaxPoints: 10,
        sighMaxPoints: 20,
        screamMaxPoints: 10,
      },
    });
    expect(root.find('pp-score-max').map((node) => node.textContent)).toEqual([
      '/50',
      '/10',
      '/10',
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
    expect(values()).toEqual([0, 0, 0, 0, 0]);
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
    // Five rows at 0: laugh 0, calm 0, home 0, and the sigh and scream rows have lost their whole maximum.
    const { clock, values } = build({
      score: {
        laughPoints: 0,
        calmPoints: 0,
        homePoints: 0,
        sighPoints: maxima.sighMaxPoints,
        screamPoints: maxima.screamMaxPoints,
        scorePoints: 30,
        stars: 1,
        lostStars: 0,
      },
    });
    expect(values()).toEqual([0, 0, 0, 0, 0]);
    // Left: the four rows still to start and the stars. A count-up frame would make it six.
    clock.advance(1);
    expect(clock.pending).toBe(5);
    clock.advance(COUNT_UP_FRAME_MS);
    expect(values()).toEqual([0, 0, 0, 0, 0]);
  });

  it('always shows the five rows, in order, and their values add up to the total (AC 10)', () => {
    const { clock, root, values, total } = build();
    clock.advance(ROWS_END_MS);
    expect(root.find('pp-score-row').map((row) => row.className)).toEqual([
      'pp-score-row pp-score-row-laugh',
      'pp-score-row pp-score-row-calm',
      'pp-score-row pp-score-row-home',
      'pp-score-row pp-score-row-sigh',
      'pp-score-row pp-score-row-scream',
    ]);
    expect(values().reduce((sum, value) => sum + value, 0)).toBe(total());
    expect(total()).toBe(SCORE.scorePoints);
  });

  it('shows the Maison row as 0 over 15 in a level without a chore: the row is never hidden (AC 9)', () => {
    const { clock, root, values, total } = build({
      score: { ...SCORE, homePoints: 0, scorePoints: SCORE.scorePoints - SCORE.homePoints },
    });
    clock.advance(ROWS_END_MS);
    expect(root.find('pp-score-row')).toHaveLength(5);
    expect(values()).toEqual([28, 14, 0, 9, 12]);
    expect(root.find('pp-score-max')[2]?.textContent).toBe(`/${maxima.homeMaxPoints}`);
    expect(values().reduce((sum, value) => sum + value, 0)).toBe(total());
  });

  it('writes a half point of the Maison row with a decimal comma: 7,5 over 15 with the cooking done (story 9.4)', () => {
    const { clock, root } = build({
      score: { ...SCORE, homePoints: 7.5, scorePoints: SCORE.scorePoints - SCORE.homePoints + 7.5 },
    });
    clock.advance(ROWS_END_MS);
    const texts = root.find('pp-score-value').map((node) => node.textContent);
    expect(texts).toEqual(['28', '14', '7,5', '9', '12']);
    expect(root.find('pp-score-max')[2]?.textContent).toBe(`/${maxima.homeMaxPoints}`);
    // The total adds the rows, a half included.
    expect(root.find('pp-score-total-value')[0]?.textContent).toBe('70,5');
  });

  it('counts the Maison row up in halves and the other rows in whole points', () => {
    const { clock, root } = build({
      score: { ...SCORE, homePoints: 7.5, scorePoints: SCORE.scorePoints - SCORE.homePoints + 7.5 },
    });
    const maison = new Set<string>();
    const others = new Set<string>();
    for (let step = 0; step <= ROWS_END_MS; step += 16) {
      clock.advance(16);
      root.find('pp-score-value').forEach((node, row) => {
        (row === 2 ? maison : others).add(node.textContent ?? '');
      });
    }
    // The other rows were whole points before the story and stay so.
    for (const text of others) expect(text, text).toMatch(/^\d+$/);
    // The Maison row passes through halves (a decimal comma) on its way to 7,5, and ends on it.
    expect([...maison].some((text) => text.includes(','))).toBe(true);
    for (const text of maison) expect(text, text).toMatch(/^\d+(,5)?$/);
    expect(root.find('pp-score-value')[2]?.textContent).toBe('7,5');
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
    // The end of the bedtime cycle (story 4.10): a header in the same place, none of the woken flow.
    const done = build({ endReason: 'cycleDone' });
    const [doneHeader] = done.root.find('pp-result-reason');
    expect(doneHeader?.textContent).toBe('result.cycle_done');
    expect(doneHeader?.classList.contains('pp-result-reason-slam')).toBe(false);
    expect(done.root.find('pp-result-panel-woken')).toHaveLength(0);
    expect(timer.root.all().some((node) => node.tag === 'h2')).toBe(false);
  });

  describe('Mama come home early (story 3.16)', () => {
    /** The note of the room as it is, and 0 stars whatever the score: no star lost, none to take off. */
    const HOME: MamaScore = { ...SCORE, scorePoints: 80, stars: 0, lostStars: 0 };
    const home = (overrides: Partial<ResultScreenOptions> = {}) =>
      build({ endReason: 'mamaHome', score: HOME, ...overrides });

    it('puts the header « result.mama_home » over the card, with the slam, in the place of the woken one', () => {
      const { root, panel } = home();
      const header = root.find('pp-result-reason')[0] as FakeElement;
      expect(header.tag).toBe('h2');
      expect(header.textContent).toBe('result.mama_home');
      expect(header.classList.contains('pp-type-heading')).toBe(true);
      expect(header.classList.contains('pp-result-reason-slam')).toBe(true);
      expect(panel.children[0]).toBe(header);
      expect(panel.children[1]?.classList.contains('pp-score-card')).toBe(true);
      expect(panel.classList.contains('pp-result-panel-home')).toBe(true);
      expect(panel.classList.contains('pp-result-panel-woken')).toBe(false);
      expect(build().panel.classList.contains('pp-result-panel-home')).toBe(false);
    });

    it('calls onMamaHome once, when the sequence starts, never onMamaWoke, and never for another end', () => {
      const { clock, calls } = home();
      expect(calls).toEqual(['mama home']);
      clock.advance(20_000);
      expect(calls.filter((call) => call === 'mama home')).toHaveLength(1);
      expect(calls).not.toContain('mama woke');
      expect(build().calls).toEqual([]);
      expect(woken().calls).toEqual(['mama woke']);
    });

    it('counts the rows up to the room’s note, but earns no star and loses none: five empty slots, no chip', () => {
      const { root, clock, values, earned, lost, phases } = home();
      clock.advance(ROWS_END_MS);
      expect(values()).toEqual(ROW_TOTALS);
      clock.advance(20_000);
      expect(earned()).toBe(0);
      expect(lost()).toBe(0);
      expect(root.find('pp-star-lost-chip')).toHaveLength(0);
      const slots = root.find('pp-stars')[0]?.children.filter((node) => node.tag === 'svg') ?? [];
      expect(slots).toHaveLength(STAR_COUNT_MAX);
      expect(slots.every((slot) => slot.classList.contains('pp-star-empty'))).toBe(true);
      expect(phases.at(-1)).toBe('actions');
    });

    it('puts « Rejouer » up, primary, after the rows', () => {
      const { clock, replay, actions } = home();
      expect(actions.hidden).toBe(true);
      clock.advance(20_000);
      expect(actions.hidden).toBe(false);
      expect(replay.classList.contains('pp-button-primary')).toBe(true);
    });

    it('shows the header at rest on a done build: no slam class, no onMamaHome', () => {
      const { root, calls } = home({ isDone: true });
      const header = root.find('pp-result-reason')[0] as FakeElement;
      expect(header.textContent).toBe('result.mama_home');
      expect(header.classList.contains('pp-result-reason-slam')).toBe(false);
      expect(calls).toEqual([]);
    });

    it('names no failure in the screen the player reads', () => {
      const { root } = home();
      const text = root
        .all()
        .map((node) => node.textContent)
        .join(' ')
        .toLowerCase();
      for (const word of ['perdu', 'échec', 'game over', 'mort']) expect(text).not.toContain(word);
    });
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

describe('createResultScreen: the end photo (story 3.6)', () => {
  beforeEach(() => {
    focused = null;
  });

  const HOLD_MS = timings.photoHoldMs;
  const TILT_DEG = -2.25;
  /** The canvas boot keeps: a stand-in, since only the screen's handling of it is under test. */
  const makeCanvas = () => new FakeElement('canvas');
  const withPhoto = (overrides: Partial<ResultScreenOptions> = {}) => {
    const canvas = makeCanvas();
    const built = build({ photo: { canvas: canvas as never, tiltDeg: TILT_DEG }, ...overrides });
    const polaroid = built.root.find('pp-polaroid')[0];
    return { ...built, canvas, polaroid };
  };
  const woken = (overrides: Partial<ResultScreenOptions> = {}) =>
    withPhoto({ endReason: 'mamaWoke', score: { ...SCORE, stars: 1, lostStars: 1 }, ...overrides });
  const press = (root: FakeElement) => {
    root.dispatch('pointerdown', { pointerId: 3, isPrimary: true });
    root.dispatch('pointerup', { pointerId: 3 });
  };

  it('starts at `photo`, first, and fires onPhoto once at build', () => {
    const { phases, calls } = withPhoto();
    expect(phases).toEqual(['photo']);
    expect(calls).toEqual(['photo']);
  });

  it('puts the canvas in a polaroid left of the panel, labelled and tilted', () => {
    const { root, panel, canvas, polaroid } = withPhoto();
    expect(polaroid).toBeDefined();
    // The polaroid stands in the left column (story 3.7), which comes first in the screen.
    const left = root.find('pp-result-left')[0];
    expect(root.children).toEqual([left, panel]);
    expect(left?.children).toEqual([polaroid]);
    expect(polaroid?.children).toEqual([canvas]);
    expect(canvas.attributes.get('role')).toBe('img');
    expect(canvas.attributes.get('aria-label')).toBe('result.photo_label');
    expect(polaroid?.styles.get('--pp-polaroid-tilt')).toBe(`${TILT_DEG}deg`);
    expect(root.classList.contains('pp-result-screen-photo')).toBe(true);
  });

  it('drops the polaroid in once, and holds the panel transparent meanwhile', () => {
    const { polaroid, panel } = withPhoto();
    expect(polaroid?.classList.contains('pp-polaroid-drop')).toBe(true);
    expect(panel.classList.contains('pp-result-panel-waiting')).toBe(true);
  });

  it('counts nothing during the hold, then starts the rows after photoHoldMs', () => {
    const { clock, phases, values, panel } = withPhoto();
    clock.advance(HOLD_MS - 1);
    expect(phases).toEqual(['photo']);
    expect(values()).toEqual([0, 0, 0, 0, 0]);
    expect(panel.classList.contains('pp-result-panel-waiting')).toBe(true);
    clock.advance(1);
    expect(phases).toEqual(['photo', 'rows']);
    expect(panel.classList.contains('pp-result-panel-waiting')).toBe(false);
    clock.advance(ROWS_END_MS);
    expect(values()).toEqual(ROW_TOTALS);
  });

  it('follows the hold in feedback.json, not a literal', () => {
    const { clock, phases } = withPhoto({ timings: { ...timings, photoHoldMs: 5000 } });
    clock.advance(4999);
    expect(phases).toEqual(['photo']);
    clock.advance(1);
    expect(phases).toEqual(['photo', 'rows']);
  });

  it('goes straight to the rows, in the same call, with a hold of 0 (no task of a transparent panel)', () => {
    const { phases, calls, panel } = withPhoto({ timings: { ...timings, photoHoldMs: 0 } });
    expect(phases).toEqual(['photo', 'rows']);
    expect(calls).toEqual(['photo']);
    expect(panel.classList.contains('pp-result-panel-waiting')).toBe(false);
  });

  it('runs the rest of the sequence as before, shifted by the hold', () => {
    const { clock, calls, phases, actions } = withPhoto();
    clock.advance(HOLD_MS + 20_000);
    expect(phases).toEqual(['photo', 'rows', 'stars', 'actions']);
    expect(calls).toEqual(['photo', 'star', 'star', 'last star']);
    expect(actions.hidden).toBe(false);
  });

  it('has no polaroid and starts at `rows` exactly as before with no photo', () => {
    const { root, phases, calls, panel } = build();
    expect(root.find('pp-polaroid')).toHaveLength(0);
    expect(root.classList.contains('pp-result-screen-photo')).toBe(false);
    expect(phases).toEqual(['rows']);
    expect(calls).toEqual([]);
    expect(panel.classList.contains('pp-result-panel-waiting')).toBe(false);
  });

  it('keeps the panel the first child of a screen with no photo (the specs select it)', () => {
    const { root, panel } = build();
    expect(root.children).toEqual([panel]);
  });

  describe("a woken Mama's header (EXPERIENCE: nothing between the photo and her reaction)", () => {
    it('waits for the rows: no header and no onMamaWoke at build', () => {
      const { root, calls, clock } = woken();
      expect(root.find('pp-result-reason')).toHaveLength(0);
      expect(calls).toEqual(['photo']);
      clock.advance(HOLD_MS - 1);
      expect(root.find('pp-result-reason')).toHaveLength(0);
      expect(calls).toEqual(['photo']);
    });

    it('comes with the rows, slammed, and tells the host once, after the photo', () => {
      const { root, calls, clock, panel } = woken();
      clock.advance(HOLD_MS);
      const header = root.find('pp-result-reason')[0] as FakeElement;
      expect(header.textContent).toBe('result.mama_woke');
      expect(header.classList.contains('pp-result-reason-slam')).toBe(true);
      expect(panel.children[0]).toBe(header);
      expect(calls).toEqual(['photo', 'mama woke']);
      clock.advance(20_000);
      expect(calls.filter((call) => call === 'mama woke')).toHaveLength(1);
    });

    it('is not delayed with no photo: the header and the cue are there at build, as before', () => {
      const none = build({ endReason: 'mamaWoke', score: { ...SCORE, stars: 1, lostStars: 1 } });
      expect(none.root.find('pp-result-reason')).toHaveLength(1);
      expect(none.calls).toEqual(['mama woke']);
    });

    it("brings a cycle's « Il dort enfin ! » header up with the rows too, with no slam and no cue", () => {
      const { root, calls, clock } = withPhoto({ endReason: 'cycleDone' });
      expect(root.find('pp-result-reason')).toHaveLength(0);
      clock.advance(HOLD_MS);
      const header = root.find('pp-result-reason')[0] as FakeElement;
      expect(header.textContent).toBe('result.cycle_done');
      expect(header.classList.contains('pp-result-reason-slam')).toBe(false);
      expect(calls).toEqual(['photo']);
    });
  });

  describe('a press during the photo', () => {
    it('skips: panel shown, rows at their totals, buttons up, the polaroid kept', () => {
      const { root, polaroid, panel, canvas, values, actions, phases, replay } = withPhoto();
      press(root);
      expect(phases).toEqual(['photo', 'actions']);
      expect(panel.classList.contains('pp-result-panel-waiting')).toBe(false);
      expect(values()).toEqual(ROW_TOTALS);
      expect(actions.hidden).toBe(false);
      expect(focused).toBe(replay);
      expect(root.find('pp-result-left')[0]?.children[0]).toBe(polaroid);
      expect(polaroid?.children).toEqual([canvas]);
    });

    it('places the stars silently and fires no cue but the photo’s', () => {
      const { root, calls, earned, stamped } = withPhoto();
      press(root);
      expect(earned()).toBe(SCORE.stars);
      expect(stamped()).toBe(0);
      expect(calls).toEqual(['photo']);
    });

    it('brings a woken header up at rest: no slam, no onMamaWoke', () => {
      const { root, calls, lost, panel } = woken();
      press(root);
      const header = root.find('pp-result-reason')[0] as FakeElement;
      expect(header.classList.contains('pp-result-reason-slam')).toBe(false);
      expect(panel.children[0]).toBe(header);
      expect(calls).toEqual(['photo']);
      expect(lost()).toBe(1);
    });

    it('is a skip for Enter, Space and the pad’s A too, and cancels the hold', () => {
      for (const skip of ['Enter', 'Space']) {
        const { keys, phases, clock } = withPhoto();
        keys.dispatch('keydown', { code: skip, repeat: false, preventDefault: () => undefined });
        expect(phases).toEqual(['photo', 'actions']);
        clock.advance(HOLD_MS * 10);
        expect(phases).toEqual(['photo', 'actions']);
      }
      const pad = withPhoto();
      pad.screen.activate?.();
      expect(pad.phases).toEqual(['photo', 'actions']);
    });

    it('is ignored within inputGraceMs: a tap still meant for the game skips nothing', () => {
      const { root, phases, clock } = withPhoto({ timings: { ...timings, inputGraceMs: 350 } });
      press(root);
      expect(phases).toEqual(['photo']);
      clock.advance(350);
      press(root);
      expect(phases).toEqual(['photo', 'actions']);
    });
  });

  describe('a screen rebuilt after the portrait overlay', () => {
    it('shows the same picture at rest: same tilt, no drop, no cue, buttons up', () => {
      const { root, polaroid, canvas, calls, phases, panel, values, actions } = withPhoto({
        isDone: true,
      });
      expect(polaroid?.children).toEqual([canvas]);
      expect(polaroid?.styles.get('--pp-polaroid-tilt')).toBe(`${TILT_DEG}deg`);
      expect(polaroid?.classList.contains('pp-polaroid-drop')).toBe(false);
      expect(panel.classList.contains('pp-result-panel-waiting')).toBe(false);
      expect(phases).toEqual(['actions']);
      expect(calls).toEqual([]);
      expect(values()).toEqual(ROW_TOTALS);
      expect(actions.hidden).toBe(false);
      expect(root.find('pp-result-left')[0]?.children[0]).toBe(polaroid);
    });

    it('shows a woken header at rest, with no slam and no cue', () => {
      const { root, calls } = woken({ isDone: true });
      const header = root.find('pp-result-reason')[0] as FakeElement;
      expect(header.classList.contains('pp-result-reason-slam')).toBe(false);
      expect(calls).toEqual([]);
    });

    it('re-parents the same canvas into the new polaroid', () => {
      const canvas = makeCanvas();
      const photo = { canvas: canvas as never, tiltDeg: TILT_DEG };
      const first = build({ photo });
      const second = build({ photo, isDone: true });
      expect(first.root.find('pp-polaroid')[0]?.children).toEqual([canvas]);
      expect(second.root.find('pp-polaroid')[0]?.children).toEqual([canvas]);
    });
  });

  it('cancels the hold when the screen is disposed', () => {
    const { clock, screen, phases } = withPhoto();
    screen.dispose();
    clock.advance(HOLD_MS * 10);
    expect(phases).toEqual(['photo']);
    expect(clock.pending).toBe(0);
  });

  it('takes the panel as its initial focus, transparent or not', () => {
    const { screen, panel } = withPhoto();
    expect(screen.initialFocus).toBe(panel as never);
  });
});

describe("createResultScreen: Mama's reactions (story 3.7)", () => {
  beforeEach(() => {
    focused = null;
  });

  const HOLD_MS = timings.reactionHoldMs;
  const PHOTO_HOLD_MS = timings.photoHoldMs;
  // The lines `chooseMamaLines` picked (story 3.8): the screen shows what it is given; the Scream's is emphasized.
  const LAUGH_LINE = 'Ha ha ! Tous les deux, alors…';
  const SIGH_LINE = 'Bon… qui range ?';
  const SCREAM_LINE = "*Encore* l'escalier ?!";
  const SCREAM_TEXT = "Encore l'escalier ?!";
  const ALL: readonly MamaReactionLine[] = [
    { reaction: 'laugh', points: 7, lineId: 'laugh_any', text: LAUGH_LINE },
    { reaction: 'sigh', points: 3, lineId: 'sigh_any', text: SIGH_LINE },
    { reaction: 'scream', points: 2.5, lineId: 'stairs_again', text: SCREAM_LINE },
  ];
  const lineWith = (reaction: MamaReactionId, points: number, text = 'Une ligne.') => ({
    reaction,
    points,
    lineId: `${reaction}_test`,
    text,
  });
  // The strings the chip needs; every other key stays its own name.
  const t = (key: string): string =>
    key === 'result.mama_value_gain'
      ? '+{points}'
      : key === 'result.mama_value_loss'
        ? '−{points}'
        : key;
  const make = (overrides: Partial<ResultScreenOptions> = {}) =>
    build({ t, reactions: ALL, ...overrides });
  const withPhoto = (overrides: Partial<ResultScreenOptions> = {}) =>
    make({ photo: { canvas: new FakeElement('canvas') as never, tiltDeg: 1 }, ...overrides });
  const press = (root: FakeElement) => {
    root.dispatch('pointerdown', { pointerId: 3, isPrimary: true });
    root.dispatch('pointerup', { pointerId: 3 });
  };
  const bubbleOf = (root: FakeElement) => root.find('pp-mum-bubble')[0] as FakeElement;
  const lineOf = (root: FakeElement) =>
    (root.find('pp-mum-bubble-text')[0] as FakeElement).textContent;
  const chipOf = (root: FakeElement) => root.find('pp-mum-chip')[0] as FakeElement;
  const spokenValueOf = (root: FakeElement) => root.find('pp-mum-bubble-value')[0] as FakeElement;
  const shownOf = (root: FakeElement) => root.find('pp-mama--shown');
  const mamaOf = (root: FakeElement) => root.find('pp-result-mama')[0] as FakeElement;

  it('plays them in order, each held for reactionHoldMs, and only then starts the rows (no photo)', () => {
    const { clock, phases, calls } = make();
    expect(phases).toEqual(['mama']);
    expect(calls).toEqual(['mama laugh']);
    clock.advance(HOLD_MS - 1);
    expect(calls).toEqual(['mama laugh']);
    clock.advance(1);
    expect(calls).toEqual(['mama laugh', 'mama sigh']);
    clock.advance(HOLD_MS);
    expect(calls).toEqual(['mama laugh', 'mama sigh', 'mama scream']);
    // The last one is held too, so that it is read before the rows.
    expect(phases).toEqual(['mama']);
    clock.advance(HOLD_MS);
    expect(phases).toEqual(['mama', 'rows']);
    clock.advance(20_000);
    expect(phases).toEqual(['mama', 'rows', 'stars', 'actions']);
    expect(calls.filter((call) => call.startsWith('mama '))).toEqual([
      'mama laugh',
      'mama sigh',
      'mama scream',
    ]);
  });

  it('puts the photo first when there is one: photo, then the reactions after its hold', () => {
    const { clock, phases, calls, root } = withPhoto();
    expect(phases).toEqual(['photo']);
    expect(calls).toEqual(['photo']);
    // Hers is invisible while the photo stands alone, but in the page (her live region is heard from the start).
    expect(mamaOf(root).className).toContain('pp-result-mama-waiting');
    expect(mamaOf(root).hidden).toBe(false);
    clock.advance(PHOTO_HOLD_MS);
    expect(phases).toEqual(['photo', 'mama']);
    expect(calls).toEqual(['photo', 'mama laugh']);
    expect(mamaOf(root).className).not.toContain('pp-result-mama-waiting');
    clock.advance(HOLD_MS * ALL.length);
    expect(phases).toEqual(['photo', 'mama', 'rows']);
  });

  it('shows the line of the reaction in the bubble, with its accent class, and the next one after the hold', () => {
    const { clock, root } = make();
    expect(lineOf(root)).toBe(LAUGH_LINE);
    expect(bubbleOf(root).className).toContain('pp-mum-bubble--laugh');
    clock.advance(HOLD_MS);
    expect(lineOf(root)).toBe(SIGH_LINE);
    expect(bubbleOf(root).className).toContain('pp-mum-bubble--sigh');
    expect(bubbleOf(root).className).not.toContain('pp-mum-bubble--laugh');
    clock.advance(HOLD_MS);
    expect(lineOf(root)).toBe(SCREAM_TEXT);
    expect(bubbleOf(root).className).toContain('pp-mum-bubble--scream');
  });

  describe('the emphasis of a line (story 3.8, AC 9)', () => {
    const textOf = (root: FakeElement) => root.find('pp-mum-bubble-text')[0] as FakeElement;
    const emsOf = (root: FakeElement) => textOf(root).children.filter((node) => node.tag === 'em');

    it('puts the *word* in an em and shows no asterisk, so a reader hears the words alone', () => {
      const { clock, root } = make();
      clock.advance(HOLD_MS * 2);
      expect(emsOf(root).map((node) => node.textContent)).toEqual(['Encore']);
      expect(textOf(root).textContent).toBe(SCREAM_TEXT);
      expect(textOf(root).textContent).not.toContain('*');
    });

    it('makes no em for a line without emphasis, and drops the previous one', () => {
      const { clock, root } = make({
        reactions: [lineWith('scream', 1, SCREAM_LINE), lineWith('laugh', 0, 'Joli brushing !')],
      });
      expect(emsOf(root)).toHaveLength(1);
      clock.advance(HOLD_MS);
      expect(emsOf(root)).toHaveLength(0);
      expect(lineOf(root)).toBe('Joli brushing !');
    });

    it('keeps the live region: the same bubble and the same text node, filled again', () => {
      const { clock, root } = make();
      const bubble = bubbleOf(root);
      const text = textOf(root);
      clock.advance(HOLD_MS * 2);
      expect(bubbleOf(root)).toBe(bubble);
      expect(textOf(root)).toBe(text);
      expect(bubble.attributes.get('aria-live')).toBe('polite');
    });

    it('keeps markup inside a line as text: no element comes of it', () => {
      const { root } = make({ reactions: [lineWith('laugh', 1, '<b>gras</b> *fort*')] });
      expect(textOf(root).children.map((node) => node.tag)).toEqual(['#text', 'em']);
      expect(lineOf(root)).toBe('<b>gras</b> fort');
    });
  });

  it('is the caption of her voice: a polite status that always shows, with her figures hidden from readers', () => {
    const { root } = make();
    const bubble = bubbleOf(root);
    expect(bubble.attributes.get('role')).toBe('status');
    expect(bubble.attributes.get('aria-live')).toBe('polite');
    expect(bubble.className).toContain('pp-type-body');
    expect(root.find('pp-mama').length).toBeGreaterThan(0);
    for (const figure of root.find('pp-mama')) {
      expect(figure.attributes.get('aria-hidden')).toBe('true');
    }
  });

  it('shows one figure at a time, the one of the reaction, each with an animation class of its own', () => {
    const { clock, root } = make();
    const classOfShown = () => (shownOf(root)[0] as FakeElement).attributes.get('class') ?? '';
    expect(shownOf(root)).toHaveLength(1);
    expect(classOfShown()).toContain('pp-mama--laugh');
    expect(classOfShown()).not.toContain('pp-mama--rest');
    clock.advance(HOLD_MS);
    expect(shownOf(root)).toHaveLength(1);
    expect(classOfShown()).toContain('pp-mama--sigh');
    clock.advance(HOLD_MS);
    expect(classOfShown()).toContain('pp-mama--scream');
  });

  it('writes the value with its sign: + for the Laugh, − for the Sigh and the Scream, a decimal comma', () => {
    const { clock, root } = make();
    expect(chipOf(root).hidden).toBe(false);
    expect(chipOf(root).textContent).toBe('+7');
    // The same value in the live region, for a reader (the chip is a picture of it).
    expect(spokenValueOf(root).textContent).toBe('+7');
    expect(chipOf(root).attributes.get('aria-hidden')).toBe('true');
    expect(chipOf(root).className).toContain('pp-mum-chip--laugh');
    clock.advance(HOLD_MS);
    expect(chipOf(root).textContent).toBe('−3');
    expect(spokenValueOf(root).textContent).toBe('−3');
    expect(chipOf(root).className).toContain('pp-mum-chip--sigh');
    clock.advance(HOLD_MS);
    expect(chipOf(root).textContent).toBe('−2,5');
    expect(chipOf(root).className).toContain('pp-mum-chip--scream');
  });

  it('shows no chip for a reaction worth 0, and brings it back for the next one', () => {
    const { clock, root } = make({ reactions: [lineWith('laugh', 0), lineWith('scream', 4)] });
    expect(chipOf(root).hidden).toBe(true);
    expect(chipOf(root).textContent).toBe('');
    clock.advance(HOLD_MS);
    expect(chipOf(root).hidden).toBe(false);
    expect(chipOf(root).textContent).toBe('−4');
  });

  it('shows the line it is given whatever the end: choosing it is not the screen’s business any more', () => {
    for (const endReason of ['mamaWoke', 'mamaHome', 'timer', 'cycleDone'] as const) {
      const scream = [lineWith('scream', 0, `Ligne pour ${endReason}`)];
      expect(lineOf(make({ reactions: scream, endReason }).root), endReason).toBe(
        `Ligne pour ${endReason}`,
      );
    }
  });

  it('keeps the woken and home-early headers and their cues for the rows, after the reactions', () => {
    const woken = make({ endReason: 'mamaWoke', score: { ...SCORE, stars: 1, lostStars: 1 } });
    expect(woken.root.find('pp-result-reason')).toHaveLength(0);
    expect(woken.calls).not.toContain('mama woke');
    woken.clock.advance(HOLD_MS * ALL.length);
    expect(woken.phases).toEqual(['mama', 'rows']);
    expect(woken.calls).toEqual(['mama laugh', 'mama sigh', 'mama scream', 'mama woke']);
    expect(woken.root.find('pp-result-reason')).toHaveLength(1);
    const home = make({ endReason: 'mamaHome' });
    home.clock.advance(HOLD_MS * ALL.length);
    expect(home.calls).toEqual(['mama laugh', 'mama sigh', 'mama scream', 'mama home']);
  });

  it('keeps the panel transparent while she reacts and lets it show with the rows', () => {
    const { clock, panel } = make();
    expect(panel.classList.contains('pp-result-panel-waiting')).toBe(true);
    clock.advance(HOLD_MS * ALL.length);
    expect(panel.classList.contains('pp-result-panel-waiting')).toBe(false);
  });

  it('goes straight on with reactionHoldMs 0: every reaction fires in the same call, then the rows', () => {
    const { phases, calls, root } = make({ timings: { ...timings, reactionHoldMs: 0 } });
    expect(phases).toEqual(['mama', 'rows']);
    expect(calls).toEqual(['mama laugh', 'mama sigh', 'mama scream']);
    // She stays on the last one.
    expect(lineOf(root)).toBe(SCREAM_TEXT);
  });

  it('goes straight from the photo to the reactions with photoHoldMs 0 as well', () => {
    const { phases, calls } = withPhoto({
      timings: { ...timings, photoHoldMs: 0, reactionHoldMs: 0 },
    });
    expect(phases).toEqual(['photo', 'mama', 'rows']);
    expect(calls).toEqual(['photo', 'mama laugh', 'mama sigh', 'mama scream']);
  });

  it('stays, at rest, on the last reaction once the sequence is over', () => {
    const { clock, root } = make();
    clock.advance(20_000);
    const [figure] = shownOf(root);
    expect(figure?.attributes.get('class')).toContain('pp-mama--scream');
    expect(figure?.attributes.get('class')).toContain('pp-mama--rest');
    expect(lineOf(root)).toBe(SCREAM_TEXT);
    expect(mamaOf(root).className).not.toContain('pp-result-mama-waiting');
  });

  it('is not at rest while her last reaction is held, and is as soon as the rows start', () => {
    const { clock, root } = make();
    clock.advance(HOLD_MS * (ALL.length - 1));
    const [during] = shownOf(root);
    expect(during?.attributes.get('class')).toContain('pp-mama--scream');
    expect(during?.attributes.get('class')).not.toContain('pp-mama--rest');
    clock.advance(HOLD_MS);
    const [after] = shownOf(root);
    expect(after?.attributes.get('class')).toContain('pp-mama--rest');
  });

  describe('a press', () => {
    it('during the photo skips the reactions: none plays, Mama stands at rest on the last one', () => {
      const { root, phases, calls, values, actions } = withPhoto();
      press(root);
      expect(phases).toEqual(['photo', 'actions']);
      expect(calls).toEqual(['photo']);
      expect(values()).toEqual(ROW_TOTALS);
      expect(actions.hidden).toBe(false);
      expect(mamaOf(root).className).not.toContain('pp-result-mama-waiting');
      expect(lineOf(root)).toBe(SCREAM_TEXT);
      const [figure] = shownOf(root);
      expect(figure?.attributes.get('class')).toContain('pp-mama--rest');
    });

    it('during the reactions skips the rest, with no cue, no header slam and Mama at rest on the last', () => {
      const { clock, root, phases, calls, actions } = make({
        endReason: 'mamaWoke',
        score: { ...SCORE, stars: 1, lostStars: 1 },
      });
      clock.advance(HOLD_MS);
      press(root);
      expect(phases).toEqual(['mama', 'actions']);
      expect(calls).toEqual(['mama laugh', 'mama sigh']);
      expect(actions.hidden).toBe(false);
      expect(lineOf(root)).toBe(SCREAM_TEXT);
      expect(chipOf(root).textContent).toBe('−2,5');
      const [figure] = shownOf(root);
      expect(figure?.attributes.get('class')).toContain('pp-mama--scream');
      expect(figure?.attributes.get('class')).toContain('pp-mama--rest');
      // The header is there at rest: no slam class, no cue.
      expect(root.find('pp-result-reason-slam')).toHaveLength(0);
      expect(calls).not.toContain('mama woke');
      // And nothing is left to run.
      clock.advance(20_000);
      expect(calls).toEqual(['mama laugh', 'mama sigh']);
    });

    it('is ignored within inputGraceMs: the reactions go on', () => {
      const { root, phases, calls } = make({ timings: { ...timings, inputGraceMs: 350 } });
      press(root);
      expect(phases).toEqual(['mama']);
      expect(calls).toEqual(['mama laugh']);
    });
  });

  it('shows a rebuilt, finished screen the same Mama at rest, silently', () => {
    const { phases, calls, root } = make({ isDone: true });
    expect(phases).toEqual(['actions']);
    expect(calls).toEqual([]);
    expect(lineOf(root)).toBe(SCREAM_TEXT);
    expect(chipOf(root).textContent).toBe('−2,5');
    const [figure] = shownOf(root);
    expect(figure?.attributes.get('class')).toContain('pp-mama--rest');
  });

  it('lays out the left column: the polaroid and Mama together, or Mama alone', () => {
    const photo = withPhoto();
    const left = photo.root.find('pp-result-left')[0] as FakeElement;
    expect(left.className).not.toContain('pp-result-left-alone');
    expect(left.children).toHaveLength(2);
    expect(left.children[1]).toBe(mamaOf(photo.root));
    const alone = make();
    const aloneLeft = alone.root.find('pp-result-left')[0] as FakeElement;
    expect(aloneLeft.className).toContain('pp-result-left-alone');
    expect(aloneLeft.children).toEqual([mamaOf(alone.root)]);
    expect(alone.root.children).toEqual([aloneLeft, alone.panel]);
  });

  it('plays no `mama` phase and builds no left column when it is given no reaction and no photo', () => {
    const { phases, root } = build({ reactions: [] });
    expect(phases).toEqual(['rows']);
    expect(root.find('pp-result-left')).toHaveLength(0);
  });

  it('builds one figure per kind of reaction, whatever the list', () => {
    const { root } = make({ reactions: [lineWith('laugh', 1), lineWith('laugh', 2)] });
    expect(root.find('pp-mama')).toHaveLength(1);
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
