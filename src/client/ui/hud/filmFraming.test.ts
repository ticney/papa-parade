import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TEST_FRAMING_STYLE } from '../../../../tests/support/testContent.ts';
import {
  createSequenceFraming,
  type SequenceFraming,
  sequenceFramingBlendAt,
} from '../../render/cameraFx.ts';
import {
  createFilmFraming,
  createFilmLook,
  FILM_FRAMING_CLASSES,
  type FilmSequence,
  filmLookInto,
  LETTERBOX_HEIGHT_PROPERTY,
} from './filmFraming.ts';

/** The few things of the DOM the framing touches. */
class FakeElement {
  className = '';
  textContent = '';
  readonly attributes = new Map<string, string>();
  readonly properties = new Map<string, string>();
  readonly style = {
    opacity: '',
    setProperty: (name: string, value: string) => {
      this.properties.set(name, value);
      this.writes++;
    },
  };
  writes = 0;
  readonly animations: {
    keyframes: Keyframe[];
    options: KeyframeAnimationOptions;
    cancelled: boolean;
    paused: boolean;
    currentTime: number | null;
  }[] = [];
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  animate(keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation {
    const record = { keyframes, options, cancelled: false, paused: false, currentTime: null };
    this.animations.push(record);
    return {
      cancel: () => {
        record.cancelled = true;
      },
      pause: () => {
        record.paused = true;
      },
      set currentTime(value: number) {
        (record as { currentTime: number | null }).currentTime = value;
      },
    } as unknown as Animation;
  }
}

function setup() {
  const doc = { createElement: () => new FakeElement() } as unknown as Document;
  const framing = createFilmFraming(doc, (key) => `«${key}»`);
  const [vignette, letterbox, title] = framing.elements as unknown as FakeElement[];
  return {
    framing,
    vignette: vignette as FakeElement,
    letterbox: letterbox as FakeElement,
    title: title as FakeElement,
  };
}

const STYLE = { ...TEST_FRAMING_STYLE, letterboxPct: 10, vignetteOpacityPct: 40, titleHoldMs: 800 };
const IN_MS = 1000;
const OUT_MS = 700;
const sequenceOf = (endedAt: number | null = null): FilmSequence => ({
  style: 'duel',
  titleKey: 'framing.title_duel',
  startedAt: 1000,
  endedAt,
});
const framingAt = (clockMs: number, endedAt: number | null = null): SequenceFraming => ({
  ...createSequenceFraming(),
  blend: sequenceFramingBlendAt(1000, endedAt, clockMs, IN_MS, OUT_MS),
  letterboxPct: STYLE.letterboxPct,
  vignetteOpacityPct: STYLE.vignetteOpacityPct,
  rollDeg: STYLE.rollDeg,
});
const lookAt = (clockMs: number, endedAt: number | null = null) => {
  const look = createFilmLook();
  filmLookInto(look, framingAt(clockMs, endedAt), sequenceOf(endedAt), STYLE, clockMs);
  return look;
};

describe('filmLookInto (story 7.4)', () => {
  it('draws nothing with no sequence, no style, or a framing gone out', () => {
    const look = createFilmLook();
    filmLookInto(look, framingAt(5000), null, STYLE, 5000);
    expect(look.styleId).toBeNull();
    filmLookInto(look, framingAt(5000), { ...sequenceOf(), style: undefined }, STYLE, 5000);
    expect(look.styleId).toBeNull();
    expect(lookAt(1000 + 5000 + OUT_MS, 6000).styleId).toBeNull();
  });

  it('rises with the blend over inMs: half the bars and the vignette halfway, all of them at 1', () => {
    const half = lookAt(1500);
    expect(half.styleId).toBe('duel');
    expect(half.letterboxPct).toBeCloseTo(5, 9);
    expect(half.letterboxFullPct).toBe(10);
    expect(half.vignettePct).toBeCloseTo(20, 9);
    const full = lookAt(1000 + IN_MS);
    expect(full.letterboxPct).toBe(10);
    expect(full.vignettePct).toBe(40);
  });

  it('times the title on the sim clock from the start, only while the sequence runs', () => {
    expect(lookAt(1400)).toMatchObject({ titleKey: 'framing.title_duel', titleAgeMs: 400 });
    expect(lookAt(1400, 1200).titleKey).toBeNull();
  });
});

describe('createFilmFraming (story 7.4)', () => {
  it('makes three layers that take no tap: the vignette, the bars, the Epic title', () => {
    const { vignette, letterbox, title } = setup();
    expect(vignette.className).toBe(FILM_FRAMING_CLASSES.vignette);
    expect(letterbox.className).toBe(FILM_FRAMING_CLASSES.letterbox);
    expect(title.className).toContain(FILM_FRAMING_CLASSES.title);
    expect(title.className).toContain('pp-type-epic');
    for (const element of [vignette, letterbox, title]) {
      expect(element.attributes.get('aria-hidden')).toBe('true');
    }
  });

  it('slides the bars in with the blend, and writes nothing when it does not change', () => {
    const { framing, letterbox, vignette } = setup();
    framing.update(lookAt(1500), false);
    expect(letterbox.properties.get(LETTERBOX_HEIGHT_PROPERTY)).toBe('5');
    expect(letterbox.style.opacity).toBe('1');
    expect(vignette.style.opacity).toBe('0.2');
    const writes = letterbox.writes;
    framing.update(lookAt(1500), false);
    expect(letterbox.writes).toBe(writes);
  });

  it('fades the bars at full height under reduced motion', () => {
    const { framing, letterbox } = setup();
    framing.update(lookAt(1500), true);
    expect(letterbox.properties.get(LETTERBOX_HEIGHT_PROPERTY)).toBe('10');
    expect(Number(letterbox.style.opacity)).toBeCloseTo(0.5, 9);
  });

  it('shows the title for titleHoldMs from the start, its animation driven by the sim clock', () => {
    const { framing, title } = setup();
    // At the very start the blend is 0 and nothing is drawn; one step later the card is up.
    framing.update(lookAt(1000), false);
    expect(title.animations).toHaveLength(0);
    framing.update(lookAt(1010), false);
    expect(title.textContent).toBe('«framing.title_duel»');
    expect(title.animations).toHaveLength(1);
    const [run] = title.animations;
    expect(run?.paused).toBe(true);
    expect(run?.options.duration).toBe(800);
    expect(run?.currentTime).toBe(10);
    framing.update(lookAt(1400), false);
    expect(run?.currentTime).toBe(400);
    // A pause: the same clock, the same picture, no new animation.
    framing.update(lookAt(1400), false);
    expect(run?.currentTime).toBe(400);
    expect(title.animations).toHaveLength(1);
    framing.update(lookAt(1800), false);
    expect(run?.cancelled).toBe(true);
  });

  it('a slow-mo stretches the title: it follows the sim clock, not real time', () => {
    const { framing, title } = setup();
    // Ten frames at ×0.2: 16 real ms each, 3.2 sim ms each.
    for (let frame = 1; frame <= 10; frame++) framing.update(lookAt(1000 + frame * 3.2), false);
    expect(title.animations[0]?.currentTime).toBeCloseTo(32, 9);
  });

  it('scales the title in, but under reduced motion it only fades', () => {
    const a = setup();
    a.framing.update(lookAt(1010), false);
    expect(JSON.stringify(a.title.animations[0]?.keyframes)).toContain('scale');
    const b = setup();
    b.framing.update(lookAt(1010), true);
    expect(JSON.stringify(b.title.animations[0]?.keyframes)).not.toContain('transform');
  });

  it('reset hides everything', () => {
    const { framing, letterbox, vignette, title } = setup();
    framing.update(lookAt(1200), false);
    framing.reset();
    expect(letterbox.properties.get(LETTERBOX_HEIGHT_PROPERTY)).toBe('0');
    expect(letterbox.style.opacity).toBe('0');
    expect(vignette.style.opacity).toBe('0');
    expect(title.animations[0]?.cancelled).toBe(true);
  });

  it('uses no CSS keyframes and reads no threat timing', () => {
    const source = readFileSync(new URL('./filmFraming.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/windowOpenAt|feintAt/);
    const css = readFileSync(new URL('../styles/ui.css', import.meta.url), 'utf8');
    const from = css.indexOf('.pp-film-vignette {');
    const to = css.indexOf('#pp-world {');
    expect(from, 'the vignette rule').toBeGreaterThan(-1);
    expect(to, 'the #pp-world rule').toBeGreaterThan(from);
    const block = css.slice(from, to);
    expect(block).toMatch(/pp-film-vignette/);
    expect(block).not.toMatch(/animation|@keyframes|transition/);
  });
});
