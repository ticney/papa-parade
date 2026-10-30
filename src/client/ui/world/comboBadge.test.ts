import {
  COMBO_BADGE_OFFSET_M,
  COMBO_BADGE_POP_MS,
  COMBO_BADGE_POP_SCALE_FROM,
} from '@shared/constants';
import { Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { PAPA_HEIGHT_M } from '../../render/views/papaView.ts';
import { comboBadgePopKeyframes, createComboBadge } from './comboBadge.ts';

class FakeAnimation {
  isCancelled = false;
  readonly keyframes: unknown;
  readonly options: unknown;
  constructor(keyframes: unknown, options: unknown) {
    this.keyframes = keyframes;
    this.options = options;
  }
  cancel(): void {
    this.isCancelled = true;
  }
}

class FakeElement {
  // What three's CSS2DObject reads when it is removed from a scene.
  ownerDocument = { defaultView: { Element: FakeElement } };
  parentNode: unknown = null;
  className = '';
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  animations: FakeAnimation[] = [];
  classes = new Set<string>();
  textWrites: string[] = [];
  classToggles = 0;
  classList = {
    toggle: (name: string, force: boolean): boolean => {
      this.classToggles++;
      if (force) this.classes.add(name);
      else this.classes.delete(name);
      return force;
    },
  };
  private text = '';
  get textContent(): string {
    return this.text;
  }
  set textContent(value: string) {
    this.text = value;
    this.textWrites.push(value);
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  append(child: FakeElement): void {
    this.children.push(child);
  }
  animate(keyframes: unknown, options: unknown): FakeAnimation {
    const animation = new FakeAnimation(keyframes, options);
    this.animations.push(animation);
    return animation;
  }
}

const STRINGS: Record<string, string> = {
  'combo.multiplier': 'x{count}',
  'combo.cash_in': '+{points}',
};
const MIN = 1;
const PAPA = { xM: 2, zM: -1 };

function build(isMotionReduced = false) {
  const created: FakeElement[] = [];
  const doc = {
    createElement: () => {
      const element = new FakeElement();
      created.push(element);
      return element;
    },
  } as unknown as Pick<Document, 'createElement'>;
  const scene = new Scene();
  const badge = createComboBadge(scene, doc, {
    translate: (key) => STRINGS[key] ?? key,
    isMotionReduced: () => isMotionReduced,
  });
  const [outer, text] = created as [FakeElement, FakeElement];
  return { badge, outer, text, scene };
}

describe('comboBadgePopKeyframes', () => {
  it('shrinks from the pop scale back to its size, from the constants', () => {
    expect(comboBadgePopKeyframes()).toEqual([
      { transform: `scale(${COMBO_BADGE_POP_SCALE_FROM})` },
      { transform: 'scale(1)' },
    ]);
    expect(COMBO_BADGE_POP_SCALE_FROM).toBeGreaterThan(1);
  });
});

describe('createComboBadge', () => {
  it('is an outer box with a typographic child, hidden from assistive tech, and not shown at first', () => {
    const { badge, outer, text, scene } = build();
    expect(outer.className).toBe('pp-combo-badge');
    expect(outer.attributes.get('aria-hidden')).toBe('true');
    expect(outer.children).toEqual([text]);
    expect(text.className).toBe('pp-combo-badge-text pp-type-combo');
    expect(badge.isVisible).toBe(false);
    expect(outer.style.display).toBe('none');
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]?.position.y).toBeCloseTo(PAPA_HEIGHT_M + COMBO_BADGE_OFFSET_M, 9);
  });

  it('stays hidden at the minimum multiplier', () => {
    const { badge, text } = build();
    badge.update(MIN, MIN, PAPA, false, 0);
    expect(badge.isVisible).toBe(false);
    expect(text.textWrites).toEqual([]);
  });

  it.each([2, 3, 4, 5, 6, 7, 8])('shows x%i above Papa', (multiplier) => {
    const { badge, text, scene } = build();
    badge.update(multiplier, MIN, PAPA, false, 0);
    expect(badge.isVisible).toBe(true);
    expect(text.textContent).toBe(`x${multiplier}`);
    expect(scene.children[0]?.position.x).toBe(PAPA.xM);
    expect(scene.children[0]?.position.z).toBe(PAPA.zM);
  });

  it('follows Papa without touching the text, and hides when the multiplier falls back', () => {
    const { badge, text, scene, outer } = build();
    badge.update(3, MIN, PAPA, false, 0);
    badge.update(3, MIN, { xM: 5, zM: 5 }, false, 16);
    expect(scene.children[0]?.position.x).toBe(5);
    expect(text.textWrites).toEqual(['x3']);
    badge.update(MIN, MIN, PAPA, false, 32);
    expect(badge.isVisible).toBe(false);
    expect(outer.style.display).toBe('none');
  });

  it('hides while Papa has no pose (he is out of the room), and comes back with him (story 4.3)', () => {
    const { badge, outer, text } = build();
    badge.update(3, MIN, PAPA, false, 0);
    expect(badge.isVisible).toBe(true);
    badge.update(3, MIN, null, false, 16);
    expect(badge.isVisible).toBe(false);
    expect(outer.style.display).toBe('none');
    badge.update(3, MIN, null, false, 32);
    expect(badge.isVisible).toBe(false);
    badge.update(3, MIN, PAPA, false, 48);
    expect(badge.isVisible).toBe(true);
    expect(outer.style.display).toBe('');
    expect(text.textContent).toBe('x3');
  });

  it('hides a cash-in too while Papa has no pose', () => {
    const { badge } = build();
    badge.showCashIn(12, 900, 0);
    badge.update(MIN, MIN, null, false, 16);
    expect(badge.isVisible).toBe(false);
    badge.update(MIN, MIN, PAPA, false, 32);
    expect(badge.isVisible).toBe(true);
  });

  it('writes the text and the classes only when they change, frame after frame', () => {
    const { badge, text, outer } = build();
    for (let frame = 0; frame < 50; frame++) badge.update(4, MIN, PAPA, true, frame * 16);
    expect(text.textWrites).toEqual(['x4']);
    expect(outer.classToggles).toBe(1);
    expect(text.animations).toHaveLength(0);
  });

  it('moves aside while a threat stands on Papa, and comes back', () => {
    const { badge, outer } = build();
    badge.update(2, MIN, PAPA, true, 0);
    expect(outer.classes.has('pp-combo-badge--aside')).toBe(true);
    badge.update(2, MIN, PAPA, false, 16);
    expect(outer.classes.has('pp-combo-badge--aside')).toBe(false);
    expect(badge.isVisible).toBe(true);
  });

  describe('the pop on a rise', () => {
    it('pops once per rise, with the constant duration', () => {
      const { badge, text } = build();
      badge.update(MIN, MIN, PAPA, false, 0);
      badge.update(2, MIN, PAPA, false, 16);
      expect(text.animations).toHaveLength(1);
      expect(text.animations[0]?.options).toEqual({
        duration: COMBO_BADGE_POP_MS,
        easing: 'ease-out',
      });
      expect(text.animations[0]?.keyframes).toEqual(comboBadgePopKeyframes());
      badge.update(2, MIN, PAPA, false, 32);
      expect(text.animations).toHaveLength(1);
      badge.update(3, MIN, PAPA, false, 48);
      expect(text.animations).toHaveLength(2);
      expect(text.animations[0]?.isCancelled).toBe(true);
    });

    it('does not pop when it first shows a multiplier it did not see rise (a restored world)', () => {
      const { badge, text } = build();
      badge.update(5, MIN, PAPA, false, 0);
      expect(text.animations).toHaveLength(0);
    });

    it('does not pop under reduced motion, but still shows the new text', () => {
      const { badge, text } = build(true);
      badge.update(MIN, MIN, PAPA, false, 0);
      badge.update(2, MIN, PAPA, false, 16);
      expect(text.animations).toHaveLength(0);
      expect(text.textContent).toBe('x2');
    });
  });

  describe('the cash-in', () => {
    it('shows the rounded points for the hold, though the multiplier is back to its minimum', () => {
      const { badge, text, outer } = build();
      badge.update(4, MIN, PAPA, false, 0);
      badge.update(MIN, MIN, PAPA, false, 16);
      expect(badge.isVisible).toBe(false);
      badge.showCashIn(6.4, 900, 100);
      expect(badge.isVisible).toBe(true);
      expect(text.textContent).toBe('+6');
      expect(outer.classes.has('pp-combo-badge--cash-in')).toBe(true);
      badge.update(MIN, MIN, PAPA, false, 999);
      expect(badge.isVisible).toBe(true);
      expect(text.textContent).toBe('+6');
    });

    it('rounds half up, like the note', () => {
      const { badge, text } = build();
      badge.showCashIn(2.5, 900, 0);
      expect(text.textContent).toBe('+3');
    });

    it('hides when the hold is over, in real time', () => {
      const { badge, outer } = build();
      badge.showCashIn(6, 900, 100);
      badge.update(MIN, MIN, PAPA, false, 999);
      expect(badge.isVisible).toBe(true);
      badge.update(MIN, MIN, PAPA, false, 1000);
      expect(badge.isVisible).toBe(false);
      expect(outer.classes.has('pp-combo-badge--cash-in')).toBe(false);
    });

    it('is replaced by a new rise during the hold', () => {
      const { badge, text, outer } = build();
      badge.update(MIN, MIN, PAPA, false, 0);
      badge.showCashIn(6, 900, 100);
      badge.update(2, MIN, PAPA, false, 200);
      expect(text.textContent).toBe('x2');
      expect(outer.classes.has('pp-combo-badge--cash-in')).toBe(false);
      // And the hold does not come back once the multiplier falls again.
      badge.update(MIN, MIN, PAPA, false, 300);
      expect(badge.isVisible).toBe(false);
    });

    it('is replaced by a second cash-in, with its own hold', () => {
      const { badge, text } = build();
      badge.showCashIn(6, 900, 0);
      badge.showCashIn(12, 900, 500);
      expect(text.textContent).toBe('+12');
      badge.update(MIN, MIN, PAPA, false, 1000);
      expect(badge.isVisible).toBe(true);
      badge.update(MIN, MIN, PAPA, false, 1400);
      expect(badge.isVisible).toBe(false);
    });

    it('cancels a rise pop still running, so the « +N » does not pop', () => {
      const { badge, text } = build();
      badge.update(MIN, MIN, PAPA, false, 0);
      badge.update(2, MIN, PAPA, false, 16);
      expect(text.animations).toHaveLength(1);
      badge.showCashIn(4, 900, 100);
      expect(text.animations[0]?.isCancelled).toBe(true);
      expect(text.animations).toHaveLength(1);
    });

    it('shows with no animation, whatever the motion setting', () => {
      for (const isMotionReduced of [false, true]) {
        const { badge, text } = build(isMotionReduced);
        badge.showCashIn(6, 900, 0);
        expect(text.animations).toHaveLength(0);
        expect(badge.isVisible).toBe(true);
      }
    });
  });

  it('forgets everything on hide (a restart)', () => {
    const { badge, text } = build();
    badge.update(MIN, MIN, PAPA, true, 0);
    badge.update(3, MIN, PAPA, true, 16);
    badge.showCashIn(6, 900, 32);
    const pops = text.animations.length;
    badge.hide();
    expect(badge.isVisible).toBe(false);
    // The old multiplier is not remembered: a first sight of x2 after the restart does not pop.
    badge.update(2, MIN, PAPA, false, 48);
    expect(text.animations).toHaveLength(pops);
    expect(text.textContent).toBe('x2');
  });

  it('leaves the scene on dispose', () => {
    const { badge, scene } = build();
    badge.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
