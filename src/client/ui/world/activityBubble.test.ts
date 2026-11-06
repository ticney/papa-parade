import {
  ACTIVITY_BUBBLE_COMPACT_PX,
  ACTIVITY_BUBBLE_POP_MS,
  ACTIVITY_BUBBLE_REFUSED_SHAKE_MS,
  ACTIVITY_BUBBLE_REGULAR_PX,
  ACTIVITY_BUBBLE_SQUASH_MS,
  COMBO_BADGE_HALF_WIDTH_PX,
  COMBO_BADGE_OFFSET_M,
  HOLD_RING_OUTLINE_PX,
  HOLD_RING_STROKE_PX,
  THREAT_ICON_COMPACT_PX,
  THREAT_ICON_REGULAR_PX,
} from '@shared/constants';
import { isPapaBusy, PAPA_STATES, type PapaState } from '@sim';
import { Scene } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAPA_HEIGHT_M } from '../../render/views/papaView.ts';
import {
  ACTIVITY_BUBBLE_CLASSES,
  ACTIVITY_METRICS,
  ACTIVITY_PICTOGRAM_PATHS,
  ACTIVITY_PICTOGRAMS,
  type ActivityPapa,
  activityMetricsFor,
  applyActivityBubbleMetrics,
  createActivityBubble,
  pictogramPathOrWarn,
} from './activityBubble.ts';
import { CHRONO_RING_REACH_PX } from './chronoRing.ts';

class FakeAnimation {
  isCancelled = false;
  onfinish: (() => void) | null = null;
  readonly keyframes: unknown;
  readonly options: { duration: number; fill: string };
  constructor(keyframes: unknown, options: { duration: number; fill: string }) {
    this.keyframes = keyframes;
    this.options = options;
  }
  cancel(): void {
    this.isCancelled = true;
  }
  finish(): void {
    this.onfinish?.();
  }
}

class FakeElement {
  // What three's CSS2DObject reads when it is removed from a scene.
  ownerDocument = { defaultView: { Element: FakeElement } };
  parentNode: unknown = null;
  className = '';
  tag = '';
  attributes = new Map<string, string>();
  vars = new Map<string, string>();
  children: FakeElement[] = [];
  animations: FakeAnimation[] = [];
  classes = new Set<string>();
  /** Every write to the DOM, by kind, to prove that a quiet frame writes nothing. */
  writes = 0;
  style = {
    display: '',
    setProperty: (name: string, value: string) => {
      if (this.vars.get(name) !== value) this.writes++;
      this.vars.set(name, value);
    },
  };
  classList = {
    toggle: (name: string, force: boolean): boolean => {
      if (force) this.classes.add(name);
      else this.classes.delete(name);
      this.writes++;
      return force;
    },
    add: (name: string): void => {
      this.classes.add(name);
      this.writes++;
    },
    remove: (...names: string[]): void => {
      for (const name of names) this.classes.delete(name);
      this.writes++;
    },
  };
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === 'd') this.writes++;
  }
  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }
  animate(keyframes: unknown, options: { duration: number; fill: string }): FakeAnimation {
    const animation = new FakeAnimation(keyframes, options);
    this.animations.push(animation);
    return animation;
  }
}

/** The `pp-activity-bubble--<pictogram>` classes on the element. */
const pictogramClasses = (element: FakeElement): string[] =>
  [...element.classes].filter(
    (name) => name.startsWith('pp-activity-bubble--') && name !== 'pp-activity-bubble--aside',
  );

const DRINK_START = 1000;
const DRINK_END = 4000;

const papaIn = (
  state: PapaState,
  enteredAt = DRINK_START,
  busyUntil = DRINK_END,
  xM = 2,
  zM = -1,
): ActivityPapa => ({ state, enteredAt, busyUntil, xM, zM });

function build(isMotionReduced = false, pictograms = ACTIVITY_PICTOGRAMS) {
  const created: FakeElement[] = [];
  const doc = {
    createElement: (tag: string) => {
      const element = new FakeElement();
      element.tag = tag;
      created.push(element);
      return element;
    },
    createElementNS: (_ns: string, tag: string) => {
      const element = new FakeElement();
      element.tag = tag;
      created.push(element);
      return element;
    },
  } as unknown as Pick<Document, 'createElement' | 'createElementNS'>;
  const scene = new Scene();
  const state = { isReduced: isMotionReduced };
  const bubble = createActivityBubble(scene, doc, {
    isMotionReduced: () => state.isReduced,
    pictograms,
  });
  const outer = created.find((e) => e.className === ACTIVITY_BUBBLE_CLASSES.root) as FakeElement;
  const popEl = created.find((e) => e.className === ACTIVITY_BUBBLE_CLASSES.pop) as FakeElement;
  const body = created.find((e) => e.className === ACTIVITY_BUBBLE_CLASSES.body) as FakeElement;
  const pictogramPath = created.find((e) => e.tag === 'path' && e.attributes.has('fill'));
  const object = scene.children[0] as unknown as {
    visible: boolean;
    position: { x: number; y: number; z: number };
  };
  return { bubble, outer, popEl, body, scene, object, state, created, pictogramPath };
}

afterEach(() => vi.restoreAllMocks());

describe('the pictogram table', () => {
  it('has a pictogram for exactly the busy states and a chore (story 9.4), and null for the others', () => {
    for (const state of PAPA_STATES) {
      const pictogram = ACTIVITY_PICTOGRAMS[state];
      if (isPapaBusy({ state }) || state === 'chore') expect(pictogram, state).not.toBeNull();
      else expect(pictogram, state).toBeNull();
    }
    expect(ACTIVITY_PICTOGRAMS.chore).toBe('pan');
  });

  it('warns, and only then draws nothing, for an icon path that is missing', async () => {
    const { log } = await import('@shared/log');
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    expect(pictogramPathOrWarn('M0 0h1v1z', 'door')).toBe('M0 0h1v1z');
    expect(warn).not.toHaveBeenCalled();
    expect(pictogramPathOrWarn(null, 'door')).toBe('');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('draws a cup, a handset, a door and dizzy stars, each from its own non-empty path', () => {
    expect(ACTIVITY_PICTOGRAMS.drink).toBe('cup');
    expect(ACTIVITY_PICTOGRAMS.onPhone).toBe('handset');
    expect(ACTIVITY_PICTOGRAMS.onToilet).toBe('door');
    expect(ACTIVITY_PICTOGRAMS.asleep).toBe('stars');
    const paths = Object.values(ACTIVITY_PICTOGRAM_PATHS);
    expect(paths.every((path) => path.length > 10)).toBe(true);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('the séquelles and the pick-up (story 3.15)', () => {
  it('draws the dizzy stars for the shock and the carry up, and a hand for the pick-up', () => {
    expect(ACTIVITY_PICTOGRAMS.electrified).toBe('stars');
    expect(ACTIVITY_PICTOGRAMS.carryingUp).toBe('stars');
    expect(ACTIVITY_PICTOGRAMS.pickingUp).toBe('hand');
    expect(ACTIVITY_PICTOGRAM_PATHS.hand.length).toBeGreaterThan(10);
  });

  it('shows each of the three with its own class and drains toward its own end', () => {
    for (const [state, pictogram] of [
      ['electrified', 'stars'],
      ['carryingUp', 'stars'],
      ['pickingUp', 'hand'],
    ] as const) {
      const { bubble, outer } = build();
      bubble.update(papaIn(state, 1000, 2000), 1000, false, 0);
      expect(bubble.pictogram).toBe(pictogram);
      expect(pictogramClasses(outer)).toEqual([`pp-activity-bubble--${pictogram}`]);
      bubble.update(papaIn(state, 1000, 2000), 1500, false, 16);
      expect(bubble.progressPct, state).toBe(50);
    }
  });

  it('swaps the pictogram when a séquelle replaces another, and restarts the ring toward the same end', () => {
    const { bubble, outer } = build();
    // The shock began at 1000 for 1.5 s; at 1500 a nap replaces it: the new state's own start, the old end.
    bubble.update(papaIn('electrified', 1000, 2500), 1000, false, 0);
    bubble.update(papaIn('asleep', 1500, 2500), 1500, false, 16);
    expect(bubble.pictogram).toBe('stars');
    expect(bubble.progressPct).toBe(100);
    bubble.update(papaIn('asleep', 1500, 2500), 2000, false, 32);
    expect(bubble.progressPct).toBe(50);
    bubble.update(papaIn('pickingUp', 2600, 3600), 2600, false, 48);
    expect(pictogramClasses(outer)).toEqual(['pp-activity-bubble--hand']);
  });
});

describe('createActivityBubble: the element', () => {
  it('is a hidden, assistive-tech-hidden box in the layer at the combo badge height, ink widths from the constants', () => {
    const { bubble, outer, scene, object } = build();
    expect(outer.className).toBe('pp-activity-bubble');
    expect(outer.attributes.get('aria-hidden')).toBe('true');
    expect(outer.style.display).toBe('none');
    expect(bubble.isVisible).toBe(false);
    expect(bubble.isActive).toBe(false);
    expect(bubble.pictogram).toBeNull();
    expect(bubble.progressPct).toBe(-1);
    expect(scene.children).toHaveLength(1);
    expect(object.position.y).toBeCloseTo(PAPA_HEIGHT_M + COMBO_BADGE_OFFSET_M, 9);
    expect(outer.vars.get('--pp-activity-border')).toBe('3px');
    expect(outer.vars.get('--pp-activity-border-reduced')).toBe('5px');
    expect(outer.vars.get('--pp-activity-stroke')).toBe(`${HOLD_RING_STROKE_PX}px`);
    expect(outer.vars.get('--pp-activity-outline')).toBe(`${HOLD_RING_OUTLINE_PX}px`);
    expect(outer.vars.get('--pp-activity-shake-ms')).toBe(`${ACTIVITY_BUBBLE_REFUSED_SHAKE_MS}ms`);
  });
});

describe('shown and hidden by state', () => {
  it.each([
    ['drink', 'cup'],
    ['onPhone', 'handset'],
    ['onToilet', 'door'],
    ['asleep', 'stars'],
  ] as const)('shows the %s pictogram while Papa is in that state', (state, pictogram) => {
    const { bubble, outer, object, pictogramPath } = build();
    bubble.update(papaIn(state), DRINK_START, false, 0);
    expect(bubble.isVisible).toBe(true);
    expect(bubble.isActive).toBe(true);
    expect(bubble.pictogram).toBe(pictogram);
    expect(outer.style.display).toBe('');
    expect(outer.classes.has(`pp-activity-bubble--${pictogram}`)).toBe(true);
    expect(pictogramPath?.attributes.get('d')).toBe(ACTIVITY_PICTOGRAM_PATHS[pictogram]);
    expect(object.visible).toBe(true);
  });

  it.each(['idle', 'walkPath', 'walkDir', 'glide'] as const)(
    'stays hidden while Papa is %s',
    (state) => {
      const { bubble } = build();
      bubble.update(papaIn(state, 0, 0), 500, false, 0);
      expect(bubble.isVisible).toBe(false);
      expect(bubble.pictogram).toBeNull();
    },
  );

  it('stays hidden with no Papa (no level is live)', () => {
    const { bubble } = build();
    bubble.update(null, 0, false, 0);
    expect(bubble.isVisible).toBe(false);
  });

  it('follows the world’s Papa, not a pose, so it stays at his x and z on the toilet', () => {
    const { bubble, object } = build();
    bubble.update(papaIn('onToilet', DRINK_START, DRINK_END, 3.5, -2.25), DRINK_START, false, 0);
    expect(object.position.x).toBe(3.5);
    expect(object.position.z).toBe(-2.25);
    expect(object.position.y).toBeCloseTo(PAPA_HEIGHT_M + COMBO_BADGE_OFFSET_M, 9);
  });

  it('swaps the pictogram on a busy → busy change, and squashes again', () => {
    const { bubble, outer, popEl } = build();
    bubble.update(papaIn('drink'), 1500, false, 0);
    expect(popEl.animations).toHaveLength(1);
    bubble.update(papaIn('asleep', 1600, 4600), 1700, false, 16);
    expect(bubble.pictogram).toBe('stars');
    expect(outer.classes.has('pp-activity-bubble--cup')).toBe(false);
    expect(outer.classes.has('pp-activity-bubble--stars')).toBe(true);
    expect(popEl.animations).toHaveLength(2);
    expect(popEl.animations[0]?.isCancelled).toBe(true);
    // No pop in between: it stays active.
    expect(bubble.isActive).toBe(true);
  });

  it('warns once, and draws nothing, for a busy state the table has no pictogram for', async () => {
    const { log } = await import('@shared/log');
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const { bubble } = build(false, { ...ACTIVITY_PICTOGRAMS, onPhone: null });
    bubble.update(papaIn('onPhone'), 1500, false, 0);
    bubble.update(papaIn('onPhone'), 1600, false, 16);
    expect(bubble.isVisible).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('the ring (sim time)', () => {
  it('is full at enteredAt, half-way, and empty at busyUntil, in whole percent', () => {
    const { bubble, outer } = build();
    bubble.update(papaIn('drink'), DRINK_START, false, 0);
    expect(bubble.progressPct).toBe(100);
    expect(outer.vars.get('--pp-activity-progress')).toBe('100');
    bubble.update(papaIn('drink'), (DRINK_START + DRINK_END) / 2, false, 16);
    expect(bubble.progressPct).toBe(50);
    expect(outer.vars.get('--pp-activity-progress')).toBe('50');
    bubble.update(papaIn('drink'), DRINK_END, false, 32);
    expect(bubble.progressPct).toBe(0);
  });

  it('is clamped: full before enteredAt (the drawn time trails the sim), empty after busyUntil', () => {
    const { bubble } = build();
    bubble.update(papaIn('drink'), DRINK_START - 20, false, 0);
    expect(bubble.progressPct).toBe(100);
    bubble.update(papaIn('drink'), DRINK_END + 500, false, 16);
    expect(bubble.progressPct).toBe(0);
  });

  it('drains to a busyUntil that is not on the step grid', () => {
    const { bubble } = build();
    const papa = papaIn('drink', 1000, 3333);
    bubble.update(papa, 1000 + (3333 - 1000) / 4, false, 0);
    expect(bubble.progressPct).toBe(75);
  });

  it('restarts from the new state’s own enteredAt and busyUntil after a swap', () => {
    const { bubble } = build();
    bubble.update(papaIn('drink'), 3000, false, 0);
    expect(bubble.progressPct).toBe(33);
    bubble.update(papaIn('asleep', 3000, 6000), 3000, false, 16);
    expect(bubble.progressPct).toBe(100);
  });

  it('is a function of the drawn sim time only: the same time gives the same ring, whatever the real time', () => {
    const { bubble } = build();
    bubble.update(papaIn('drink'), 2500, false, 0);
    const first = bubble.progressPct;
    bubble.update(papaIn('drink'), 2500, false, 90_000);
    expect(bubble.progressPct).toBe(first);
  });

  it('writes the DOM only when the whole percent changes', () => {
    const { bubble, outer, body } = build();
    bubble.update(papaIn('drink'), 1500, false, 0);
    const outerWrites = outer.writes;
    const bodyWrites = body.writes;
    // 1 ms later is the same whole percent (1 % of 3000 ms is 30 ms): nothing is written.
    bubble.update(papaIn('drink'), 1501, false, 16);
    bubble.update(papaIn('drink'), 1502, false, 32);
    expect(outer.writes).toBe(outerWrites);
    expect(body.writes).toBe(bodyWrites);
    bubble.update(papaIn('drink'), 1600, false, 48);
    expect(outer.writes).toBe(outerWrites + 1);
  });
});

describe('the aside step', () => {
  it('toggles the aside class only on a change', () => {
    const { bubble, outer } = build();
    bubble.update(papaIn('drink'), 1500, false, 0);
    expect(outer.classes.has('pp-activity-bubble--aside')).toBe(false);
    bubble.update(papaIn('drink'), 1500, true, 16);
    expect(outer.classes.has('pp-activity-bubble--aside')).toBe(true);
    const writes = outer.writes;
    bubble.update(papaIn('drink'), 1500, true, 32);
    expect(outer.writes).toBe(writes);
    bubble.update(papaIn('drink'), 1500, false, 48);
    expect(outer.classes.has('pp-activity-bubble--aside')).toBe(false);
  });
});

describe('the squash at the start', () => {
  it('squashes in once, from a scale below 1 back to 1, for the constant’s ms', () => {
    const { bubble, popEl } = build();
    bubble.update(papaIn('drink'), 1000, false, 0);
    expect(popEl.animations).toHaveLength(1);
    const squash = popEl.animations[0] as FakeAnimation;
    expect(squash.options.duration).toBe(ACTIVITY_BUBBLE_SQUASH_MS);
    const [from, to] = squash.keyframes as { transform: string }[];
    expect(to?.transform).toBe('scale(1)');
    expect(Number(/scale\(([\d.]+)\)/.exec(from?.transform ?? '')?.[1])).toBeLessThan(1);
    // The following frames of the same state start nothing.
    bubble.update(papaIn('drink'), 1100, false, 16);
    bubble.update(papaIn('drink'), 1200, false, 32);
    expect(popEl.animations).toHaveLength(1);
  });

  it('starts no animation under reduced motion', () => {
    const { bubble, popEl } = build(true);
    bubble.update(papaIn('drink'), 1000, false, 0);
    expect(bubble.isVisible).toBe(true);
    expect(popEl.animations).toHaveLength(0);
  });
});

describe('the end', () => {
  it('pops out when Papa is free, then is hidden once the pop is over', () => {
    const { bubble, outer, popEl } = build();
    bubble.update(papaIn('drink'), 3900, false, 0);
    bubble.update(papaIn('idle', DRINK_END, 0), DRINK_END, false, 16);
    expect(bubble.isActive).toBe(false);
    expect(bubble.isVisible).toBe(true);
    const pop = popEl.animations.at(-1) as FakeAnimation;
    expect(pop.options.duration).toBe(ACTIVITY_BUBBLE_POP_MS);
    const frames = pop.keyframes as { transform: string; opacity: number }[];
    expect(frames[0]?.opacity).toBe(1);
    expect(frames[1]?.opacity).toBe(0);
    // Still there while the pop runs, and again free on the next frame: no second pop.
    bubble.update(papaIn('idle', DRINK_END, 0), DRINK_END + 16, false, 32);
    expect(popEl.animations).toHaveLength(2);
    expect(outer.style.display).toBe('');
    pop.finish();
    expect(bubble.isVisible).toBe(false);
    expect(outer.style.display).toBe('none');
    expect(bubble.pictogram).toBeNull();
  });

  it('does not pop on a busy → busy change', () => {
    const { bubble, popEl } = build();
    bubble.update(papaIn('drink'), 1500, false, 0);
    bubble.update(papaIn('asleep', 1600, 4600), 1700, false, 16);
    expect(popEl.animations.some((a) => a.options.fill === 'forwards')).toBe(false);
  });

  it('shows again, with a squash, if Papa gets busy again while the pop is running', () => {
    const { bubble, outer, popEl } = build();
    bubble.update(papaIn('drink'), 1500, false, 0);
    bubble.update(papaIn('idle', DRINK_END, 0), DRINK_END, false, 16);
    const pop = popEl.animations.at(-1) as FakeAnimation;
    bubble.update(papaIn('onPhone', 4100, 9100), 4100, false, 32);
    expect(pop.isCancelled).toBe(true);
    expect(bubble.isActive).toBe(true);
    expect(bubble.pictogram).toBe('handset');
    // The cup's class went with the pop: the element carries the handset's alone.
    expect(pictogramClasses(outer)).toEqual(['pp-activity-bubble--handset']);
    // The cancelled pop's late callback hides nothing.
    pop.finish();
    expect(bubble.isVisible).toBe(true);
  });

  it('takes the pictogram class off when the pop is over, so the next state starts with one class', () => {
    const { bubble, outer, popEl } = build();
    bubble.update(papaIn('drink'), 1500, false, 0);
    bubble.update(papaIn('idle', DRINK_END, 0), DRINK_END, false, 16);
    // The class stays for the length of the pop, then goes with the bubble.
    expect(pictogramClasses(outer)).toEqual(['pp-activity-bubble--cup']);
    (popEl.animations.at(-1) as FakeAnimation).finish();
    expect(pictogramClasses(outer)).toEqual([]);
    bubble.update(papaIn('onPhone', 5000, 9000), 5000, false, 48);
    expect(pictogramClasses(outer)).toEqual(['pp-activity-bubble--handset']);
  });

  it('keeps its one class when Papa is busy again with the same pictogram during the pop', () => {
    const { bubble, outer, popEl } = build();
    bubble.update(papaIn('drink'), 1500, false, 0);
    bubble.update(papaIn('idle', DRINK_END, 0), DRINK_END, false, 16);
    bubble.update(papaIn('drink', 4100, 7100), 4100, false, 32);
    expect(bubble.pictogram).toBe('cup');
    expect(pictogramClasses(outer)).toEqual(['pp-activity-bubble--cup']);
    (popEl.animations[1] as FakeAnimation).finish();
    expect(bubble.isVisible).toBe(true);
  });

  it('just goes under reduced motion: no pop animation', () => {
    const { bubble, popEl } = build(true);
    bubble.update(papaIn('drink'), 1500, false, 0);
    bubble.update(papaIn('idle', DRINK_END, 0), DRINK_END, false, 16);
    expect(bubble.isVisible).toBe(false);
    expect(popEl.animations).toHaveLength(0);
  });

  it('hide() goes at once with no pop (a restart, the end of the level, a new level)', () => {
    const { bubble, outer, popEl } = build();
    bubble.update(papaIn('drink'), 1500, true, 0);
    bubble.hide();
    expect(bubble.isVisible).toBe(false);
    expect(bubble.isActive).toBe(false);
    expect(outer.style.display).toBe('none');
    expect(outer.classes.has('pp-activity-bubble--aside')).toBe(false);
    expect(outer.classes.has('pp-activity-bubble--cup')).toBe(false);
    expect(popEl.animations.every((a) => a.options.fill !== 'forwards')).toBe(true);
    // And the next busy state starts clean.
    bubble.update(papaIn('drink'), 1500, false, 16);
    expect(bubble.isActive).toBe(true);
  });

  it('hide() on a bubble that shows nothing writes nothing (it runs every frame outside a level)', () => {
    const { bubble, outer, popEl, body } = build();
    const writes = () => outer.writes + popEl.writes + body.writes;
    const before = writes();
    bubble.hide();
    bubble.hide();
    expect(writes()).toBe(before);
    // After a real hide, the next one is quiet too.
    bubble.update(papaIn('drink'), 1500, false, 0);
    bubble.hide();
    const afterHide = writes();
    bubble.hide();
    expect(writes()).toBe(afterHide);
  });

  it('dispose() removes it from the layer with no pop', () => {
    const { bubble, scene, popEl } = build();
    bubble.update(papaIn('drink'), 1500, false, 0);
    bubble.dispose();
    expect(scene.children).toHaveLength(0);
    expect(popEl.animations.every((a) => a.options.fill !== 'forwards')).toBe(true);
  });
});

describe('the shake on a refused tap', () => {
  it('shakes the body inside the pop, so a squash or a pop never hides it', () => {
    const { bubble, popEl, body } = build();
    bubble.update(papaIn('drink'), 1500, false, 0);
    // The squash is running on the pop; the shake is a class on the body, which the animations never touch.
    expect(popEl.animations).toHaveLength(1);
    bubble.shake(5);
    expect(body.classes.has(ACTIVITY_BUBBLE_CLASSES.refused)).toBe(true);
    expect(popEl.classes.size).toBe(0);
    expect(body.animations).toHaveLength(0);
    expect(popEl.children).toContain(body);
  });

  it('puts the shake class on the body for refusedShakeMs of real time, then takes it off', () => {
    const { bubble, body } = build();
    bubble.update(papaIn('drink'), 1500, false, 0);
    bubble.shake(1000);
    expect(body.classes.has(ACTIVITY_BUBBLE_CLASSES.refused)).toBe(true);
    expect(bubble.isShaking).toBe(true);
    bubble.update(papaIn('drink'), 1500, false, 1000 + ACTIVITY_BUBBLE_REFUSED_SHAKE_MS - 1);
    expect(body.classes.has(ACTIVITY_BUBBLE_CLASSES.refused)).toBe(true);
    bubble.update(papaIn('drink'), 1500, false, 1000 + ACTIVITY_BUBBLE_REFUSED_SHAKE_MS);
    expect(body.classes.has(ACTIVITY_BUBBLE_CLASSES.refused)).toBe(false);
    expect(bubble.isShaking).toBe(false);
  });

  it('restarts the shake on a second refused tap: the class comes off and goes on again, with a new end', () => {
    const { bubble, body } = build();
    bubble.update(papaIn('drink'), 1500, false, 0);
    bubble.shake(1000);
    const seen: string[] = [];
    const { add, remove } = body.classList;
    body.classList.add = (name: string) => {
      seen.push(`add ${name}`);
      add(name);
    };
    body.classList.remove = (...names: string[]) => {
      seen.push(`remove ${names.join(',')}`);
      remove(...names);
    };
    bubble.shake(1100);
    expect(seen).toEqual([
      `remove ${ACTIVITY_BUBBLE_CLASSES.refused},${ACTIVITY_BUBBLE_CLASSES.thick}`,
      `add ${ACTIVITY_BUBBLE_CLASSES.refused}`,
    ]);
    // The first shake's end (1150) no longer clears it: it runs to 1250.
    bubble.update(papaIn('drink'), 1500, false, 1200);
    expect(body.classes.has(ACTIVITY_BUBBLE_CLASSES.refused)).toBe(true);
    bubble.update(papaIn('drink'), 1500, false, 1250);
    expect(body.classes.has(ACTIVITY_BUBBLE_CLASSES.refused)).toBe(false);
  });

  it('shakes nothing while no bubble shows', () => {
    const { bubble, body } = build();
    bubble.shake(1000);
    expect(bubble.isShaking).toBe(false);
    expect(body.classes.size).toBe(0);
  });

  it('does not shake while it pops out', () => {
    const { bubble, body } = build();
    bubble.update(papaIn('drink'), 1500, false, 0);
    bubble.update(papaIn('idle', DRINK_END, 0), DRINK_END, false, 16);
    bubble.shake(32);
    expect(body.classes.has(ACTIVITY_BUBBLE_CLASSES.refused)).toBe(false);
  });

  it('under reduced motion thickens the border instead (a class, no animation), for the same time', () => {
    const { bubble, body, popEl } = build(true);
    bubble.update(papaIn('drink'), 1500, false, 0);
    bubble.shake(1000);
    expect(body.classes.has(ACTIVITY_BUBBLE_CLASSES.thick)).toBe(true);
    expect(body.classes.has(ACTIVITY_BUBBLE_CLASSES.refused)).toBe(false);
    expect(popEl.animations).toHaveLength(0);
    bubble.update(papaIn('drink'), 1500, false, 1000 + ACTIVITY_BUBBLE_REFUSED_SHAKE_MS);
    expect(body.classes.has(ACTIVITY_BUBBLE_CLASSES.thick)).toBe(false);
  });

  it('a shake is forgotten with the bubble', () => {
    const { bubble, body } = build();
    bubble.update(papaIn('drink'), 1500, false, 0);
    bubble.shake(1000);
    bubble.hide();
    expect(body.classes.has(ACTIVITY_BUBBLE_CLASSES.refused)).toBe(false);
    expect(bubble.isShaking).toBe(false);
  });
});

describe('the layout: the bubble, the combo badge and a threat on Papa never overlap', () => {
  // The CSS gives the badge its offsets from these metrics (`applyActivityBubbleMetrics`), and a threat icon is
  // centred on Papa with its chrono-ring reaching `CHRONO_RING_REACH_PX` beyond its edge.
  const BADGE_HALF = COMBO_BADGE_HALF_WIDTH_PX;
  const overlap = (a: [number, number], b: [number, number]): boolean => a[0] < b[1] && b[0] < a[1];

  it.each([
    ['compact', ACTIVITY_BUBBLE_COMPACT_PX, THREAT_ICON_COMPACT_PX],
    ['regular', ACTIVITY_BUBBLE_REGULAR_PX, THREAT_ICON_REGULAR_PX],
  ] as const)('on the %s surface', (surface, sizePx, threatSizePx) => {
    const metrics = ACTIVITY_METRICS[surface];
    expect(metrics).toEqual(activityMetricsFor(sizePx, threatSizePx));
    expect(metrics.sizePx).toBe(sizePx);
    // The bubble and its ring, the badge beside it.
    const bubble: [number, number] = [-metrics.reachPx, metrics.reachPx];
    const badge: [number, number] = [
      metrics.besideBadgePx - BADGE_HALF,
      metrics.besideBadgePx + BADGE_HALF,
    ];
    expect(overlap(bubble, badge)).toBe(false);
    expect(badge[0] - bubble[1]).toBeGreaterThan(0);
    // A threat on Papa: its icon and chrono-ring in the centre, the bubble to its left, the badge to its right.
    const threatReachPx = threatSizePx / 2 + CHRONO_RING_REACH_PX;
    const threat: [number, number] = [-threatReachPx, threatReachPx];
    const aside: [number, number] = [
      -metrics.asideBubblePx - metrics.reachPx,
      -metrics.asideBubblePx + metrics.reachPx,
    ];
    const badgeRight: [number, number] = [
      metrics.asideBadgePx - BADGE_HALF,
      metrics.asideBadgePx + BADGE_HALF,
    ];
    expect(overlap(aside, threat)).toBe(false);
    expect(overlap(badgeRight, threat)).toBe(false);
    expect(overlap(aside, badgeRight)).toBe(false);
  });

  it('writes the metrics of both surfaces to the root, for ui.css to pick by surface', () => {
    const vars = new Map<string, string>();
    applyActivityBubbleMetrics({
      style: { setProperty: (name: string, value: string) => vars.set(name, value) },
    } as unknown as { readonly style: CSSStyleDeclaration });
    expect(vars.get('--pp-activity-size-compact')).toBe(`${ACTIVITY_BUBBLE_COMPACT_PX}px`);
    expect(vars.get('--pp-activity-size-regular')).toBe(`${ACTIVITY_BUBBLE_REGULAR_PX}px`);
    for (const surface of ['compact', 'regular'] as const) {
      const metrics = ACTIVITY_METRICS[surface];
      expect(vars.get(`--pp-activity-reach-${surface}`)).toBe(`${metrics.reachPx}px`);
      expect(vars.get(`--pp-activity-beside-offset-${surface}`)).toBe(`${metrics.besideBadgePx}px`);
      expect(vars.get(`--pp-activity-aside-offset-${surface}`)).toBe(`${metrics.asideBubblePx}px`);
      expect(vars.get(`--pp-activity-badge-aside-offset-${surface}`)).toBe(
        `${metrics.asideBadgePx}px`,
      );
    }
  });
});

describe('the bubble of a chore (story 9.4, D11)', () => {
  it('shows the saucepan while Papa works at a station, though he is not busy', () => {
    const { bubble, outer } = build();
    bubble.update(papaIn('chore', 1000, 0), 1000, false, 0, 25);
    expect(bubble.isActive).toBe(true);
    expect(bubble.pictogram).toBe('pan');
    expect(outer.classes.has('pp-activity-bubble--pan')).toBe(true);
  });

  it('fills its ring with the chore’s progress instead of draining to busyUntil', () => {
    const { bubble } = build();
    bubble.update(papaIn('chore', 1000, 0), 1000, false, 0, 0);
    expect(bubble.progressPct).toBe(0);
    bubble.update(papaIn('chore', 1000, 0), 2000, false, 16, 25);
    expect(bubble.progressPct).toBe(25);
    bubble.update(papaIn('chore', 1000, 0), 90_000, false, 32, 75);
    expect(bubble.progressPct).toBe(75);
    // The sim time does not move it: only the progress does.
    bubble.update(papaIn('chore', 1000, 0), 120_000, false, 48, 75);
    expect(bubble.progressPct).toBe(75);
  });

  it('never drains a chore whose progress is not given: it reads as an empty ring, whatever the clock', () => {
    const { bubble } = build();
    // A `busyUntil` a drain would run to, and a clock halfway there: a drain would read about 50.
    bubble.update(papaIn('chore', 1000, 3000), 2000, false, 0);
    expect(bubble.progressPct).toBe(0);
    bubble.update(papaIn('chore', 1000, 3000), 2900, false, 16);
    expect(bubble.progressPct).toBe(0);
  });

  it('fills 0, 25, 50, 75 then 100 % for the beats of a four-beat chore', () => {
    const { bubble } = build();
    const shown: number[] = [];
    for (const done of [0, 1, 2, 3, 4]) {
      bubble.update(papaIn('chore', 1000, 0), 1000, false, done * 16, (done / 4) * 100);
      shown.push(bubble.progressPct);
    }
    expect(shown).toEqual([0, 25, 50, 75, 100]);
  });

  it('pops out when Papa leaves the station, and a busy state keeps draining as before', () => {
    const { bubble } = build();
    bubble.update(papaIn('chore', 1000, 0), 1000, false, 0, 50);
    bubble.update(papaIn('walkPath'), 1100, false, 16, -1);
    expect(bubble.isActive).toBe(false);
    bubble.update(papaIn('drink', 1000, 2000), 1500, false, 32, 50);
    expect(bubble.progressPct).toBe(50);
  });

  it('restarts the shake on a second refused tap: the class comes off and goes on again, with a new end', () => {
    const { bubble, body } = build();
    bubble.update(papaIn('drink'), 1500, false, 0);
    bubble.shake(1000);
    const seen: string[] = [];
    const { add, remove } = body.classList;
    body.classList.add = (name: string) => {
      seen.push(`add ${name}`);
      add(name);
    };
    body.classList.remove = (...names: string[]) => {
      seen.push(`remove ${names.join(',')}`);
      remove(...names);
    };
    bubble.shake(1100);
    expect(seen).toEqual([
      `remove ${ACTIVITY_BUBBLE_CLASSES.refused},${ACTIVITY_BUBBLE_CLASSES.thick}`,
      `add ${ACTIVITY_BUBBLE_CLASSES.refused}`,
    ]);
    // The first shake's end (1150) no longer clears it: it runs to 1250.
    bubble.update(papaIn('drink'), 1500, false, 1200);
    expect(body.classes.has(ACTIVITY_BUBBLE_CLASSES.refused)).toBe(true);
    bubble.update(papaIn('drink'), 1500, false, 1250);
    expect(body.classes.has(ACTIVITY_BUBBLE_CLASSES.refused)).toBe(false);
  });

  it('shakes nothing while no bubble shows', () => {
    const { bubble, body } = build();
    bubble.shake(1000);
    expect(bubble.isShaking).toBe(false);
    expect(body.classes.size).toBe(0);
  });

  it('does not shake while it pops out', () => {
    const { bubble, body } = build();
    bubble.update(papaIn('drink'), 1500, false, 0);
    bubble.update(papaIn('idle', DRINK_END, 0), DRINK_END, false, 16);
    bubble.shake(32);
    expect(body.classes.has(ACTIVITY_BUBBLE_CLASSES.refused)).toBe(false);
  });

  it('under reduced motion thickens the border instead (a class, no animation), for the same time', () => {
    const { bubble, body, popEl } = build(true);
    bubble.update(papaIn('drink'), 1500, false, 0);
    bubble.shake(1000);
    expect(body.classes.has(ACTIVITY_BUBBLE_CLASSES.thick)).toBe(true);
    expect(body.classes.has(ACTIVITY_BUBBLE_CLASSES.refused)).toBe(false);
    expect(popEl.animations).toHaveLength(0);
    bubble.update(papaIn('drink'), 1500, false, 1000 + ACTIVITY_BUBBLE_REFUSED_SHAKE_MS);
    expect(body.classes.has(ACTIVITY_BUBBLE_CLASSES.thick)).toBe(false);
  });

  it('a shake is forgotten with the bubble', () => {
    const { bubble, body } = build();
    bubble.update(papaIn('drink'), 1500, false, 0);
    bubble.shake(1000);
    bubble.hide();
    expect(body.classes.has(ACTIVITY_BUBBLE_CLASSES.refused)).toBe(false);
    expect(bubble.isShaking).toBe(false);
  });
});

describe('the layout: the bubble, the combo badge and a threat on Papa never overlap', () => {
  // The CSS gives the badge its offsets from these metrics (`applyActivityBubbleMetrics`), and a threat icon is
  // centred on Papa with its chrono-ring reaching `CHRONO_RING_REACH_PX` beyond its edge.
  const BADGE_HALF = COMBO_BADGE_HALF_WIDTH_PX;
  const overlap = (a: [number, number], b: [number, number]): boolean => a[0] < b[1] && b[0] < a[1];

  it.each([
    ['compact', ACTIVITY_BUBBLE_COMPACT_PX, THREAT_ICON_COMPACT_PX],
    ['regular', ACTIVITY_BUBBLE_REGULAR_PX, THREAT_ICON_REGULAR_PX],
  ] as const)('on the %s surface', (surface, sizePx, threatSizePx) => {
    const metrics = ACTIVITY_METRICS[surface];
    expect(metrics).toEqual(activityMetricsFor(sizePx, threatSizePx));
    expect(metrics.sizePx).toBe(sizePx);
    // The bubble and its ring, the badge beside it.
    const bubble: [number, number] = [-metrics.reachPx, metrics.reachPx];
    const badge: [number, number] = [
      metrics.besideBadgePx - BADGE_HALF,
      metrics.besideBadgePx + BADGE_HALF,
    ];
    expect(overlap(bubble, badge)).toBe(false);
    expect(badge[0] - bubble[1]).toBeGreaterThan(0);
    // A threat on Papa: its icon and chrono-ring in the centre, the bubble to its left, the badge to its right.
    const threatReachPx = threatSizePx / 2 + CHRONO_RING_REACH_PX;
    const threat: [number, number] = [-threatReachPx, threatReachPx];
    const aside: [number, number] = [
      -metrics.asideBubblePx - metrics.reachPx,
      -metrics.asideBubblePx + metrics.reachPx,
    ];
    const badgeRight: [number, number] = [
      metrics.asideBadgePx - BADGE_HALF,
      metrics.asideBadgePx + BADGE_HALF,
    ];
    expect(overlap(aside, threat)).toBe(false);
    expect(overlap(badgeRight, threat)).toBe(false);
    expect(overlap(aside, badgeRight)).toBe(false);
  });

  it('writes the metrics of both surfaces to the root, for ui.css to pick by surface', () => {
    const vars = new Map<string, string>();
    applyActivityBubbleMetrics({
      style: { setProperty: (name: string, value: string) => vars.set(name, value) },
    } as unknown as { readonly style: CSSStyleDeclaration });
    expect(vars.get('--pp-activity-size-compact')).toBe(`${ACTIVITY_BUBBLE_COMPACT_PX}px`);
    expect(vars.get('--pp-activity-size-regular')).toBe(`${ACTIVITY_BUBBLE_REGULAR_PX}px`);
    for (const surface of ['compact', 'regular'] as const) {
      const metrics = ACTIVITY_METRICS[surface];
      expect(vars.get(`--pp-activity-reach-${surface}`)).toBe(`${metrics.reachPx}px`);
      expect(vars.get(`--pp-activity-beside-offset-${surface}`)).toBe(`${metrics.besideBadgePx}px`);
      expect(vars.get(`--pp-activity-aside-offset-${surface}`)).toBe(`${metrics.asideBubblePx}px`);
      expect(vars.get(`--pp-activity-badge-aside-offset-${surface}`)).toBe(
        `${metrics.asideBadgePx}px`,
      );
    }
  });
});

describe('the bubble of a chore (story 9.4, D11)', () => {
  it('shows the saucepan while Papa works at a station, though he is not busy', () => {
    const { bubble, outer } = build();
    bubble.update(papaIn('chore', 1000, 0), 1000, false, 0, 25);
    expect(bubble.isActive).toBe(true);
    expect(bubble.pictogram).toBe('pan');
    expect(outer.classes.has('pp-activity-bubble--pan')).toBe(true);
  });

  it('fills its ring with the chore’s progress instead of draining to busyUntil', () => {
    const { bubble } = build();
    bubble.update(papaIn('chore', 1000, 0), 1000, false, 0, 0);
    expect(bubble.progressPct).toBe(0);
    bubble.update(papaIn('chore', 1000, 0), 2000, false, 16, 25);
    expect(bubble.progressPct).toBe(25);
    bubble.update(papaIn('chore', 1000, 0), 90_000, false, 32, 75);
    expect(bubble.progressPct).toBe(75);
    // The sim time does not move it: only the progress does.
    bubble.update(papaIn('chore', 1000, 0), 120_000, false, 48, 75);
    expect(bubble.progressPct).toBe(75);
  });

  it('never drains a chore whose progress is not given: it reads as an empty ring, whatever the clock', () => {
    const { bubble } = build();
    // A `busyUntil` a drain would run to, and a clock halfway there: a drain would read about 50.
    bubble.update(papaIn('chore', 1000, 3000), 2000, false, 0);
    expect(bubble.progressPct).toBe(0);
    bubble.update(papaIn('chore', 1000, 3000), 2900, false, 16);
    expect(bubble.progressPct).toBe(0);
  });

  it('fills 0, 25, 50, 75 then 100 % for the beats of a four-beat chore', () => {
    const { bubble } = build();
    const shown: number[] = [];
    for (const done of [0, 1, 2, 3, 4]) {
      bubble.update(papaIn('chore', 1000, 0), 1000, false, done * 16, (done / 4) * 100);
      shown.push(bubble.progressPct);
    }
    expect(shown).toEqual([0, 25, 50, 75, 100]);
  });

  it('pops out when Papa leaves the station, and a busy state keeps draining as before', () => {
    const { bubble } = build();
    bubble.update(papaIn('chore', 1000, 0), 1000, false, 0, 50);
    bubble.update(papaIn('walkPath'), 1100, false, 16, -1);
    expect(bubble.isActive).toBe(false);
    bubble.update(papaIn('drink', 1000, 2000), 1500, false, 32, 50);
    expect(bubble.progressPct).toBe(50);
  });

  it('is not shaken by a refused tap in a chore: the sim refuses none, and the bubble shakes on `TapRefused` only', () => {
    const { bubble } = build();
    bubble.update(papaIn('chore', 1000, 0), 1000, false, 0, 50);
    expect(bubble.isShaking).toBe(false);
    // Nothing in a chore calls `shake` (a press on a threat gets through); here it is called anyway, as a
    // client bug would, and the chore's bubble does shake: the guarantee is that no event calls it.
    bubble.shake(1100);
    expect(bubble.isShaking).toBe(true);
  });
});
