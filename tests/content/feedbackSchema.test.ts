import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toContentJsonSchema } from '../../src/content/jsonSchema.ts';
import { parseContentFile } from '../../src/content/parseContentFile.ts';
import { FeedbackTableSchema, SQUASH_EVENTS } from '../../src/content/schemas/feedback.ts';
import { SIM_EVENT_TYPES } from '../../src/sim/index.ts';
import { createTestFeedback } from '../support/testContent.ts';

// Tunable values are never pinned here (golden rule: Geo tunes them). Structure, ranges and
// cross-field rules only.

const FEEDBACK_URL = new URL('../../content/feedback.json', import.meta.url);
const real: Json = JSON.parse(readFileSync(FEEDBACK_URL, 'utf8'));

// Every numeric key of the file carries its unit: a percentage, a duration or a length in metres.
// The suffixes are spelled out, as in `feelSchema.test.ts`: a bare `M` would accept `gamM`. A new
// unit gets a deliberate, commented entry here.
// `pulses` is a count of rings, not a quantity: it has no unit. `laidHeightM` is a height in metres (story 4.8).
// The door (story 3.5) adds `openAngleDeg` (degrees) and its size in metres: `widthM`, `heightM`, `thicknessM`.
// The characters (story 7.2) add `speedMps` and `turnRateDegPerSec`. The look (story 7.3) adds `pulseHz`,
// `radiusM`, `sunOffsetM`, and two numbers with no unit: a light's `…Intensity` and the 0-255 `toonTones`.
// The end photo (story 3.6) adds the size of its canvas in pixels, `widthPx` and `heightPx`, spelled out for the same reason.
const UNIT_SUFFIX =
  /(?:Pct|Ms|Mps|DegPerSec|RadiusM|AmplitudeM|HeightM|Deg|Hz|OffsetM|^ambientIntensity|^sunIntensity|^radiusM|^toonTones|^widthM|^heightM|^thicknessM|^widthPx|^heightPx|^pulses)$/;

type Json = Record<string, unknown>;

function parse(value: unknown) {
  return parseContentFile('content/feedback.json', JSON.stringify(value), FeedbackTableSchema);
}

/** A copy of the real file with the values at the given dotted paths replaced (`undefined` deletes). */
function mutated(...changes: [path: string, value: unknown][]) {
  const copy = structuredClone(real) as Json;
  for (const [path, value] of changes) {
    const names = path.split('.');
    const key = names.pop() as string;
    let node = copy;
    for (const name of names) {
      const next = node[name];
      if (typeof next !== 'object' || next === null) throw new Error(`no group ${name} in ${path}`);
      node = next as Json;
    }
    if (value === undefined) delete node[key];
    else node[key] = value;
  }
  return parse(copy);
}

function failedPaths(result: ReturnType<typeof parse>): string[] {
  return result.ok ? [] : result.error.map((problem) => problem.jsonPath);
}

describe('content/feedback.json', () => {
  it('parses against FeedbackTableSchema', () => {
    expect(parse(real)).toMatchObject({ ok: true });
  });

  it('points at its generated JSON Schema', () => {
    expect(real.$schema).toBe('./_schemas/feedback.schema.json');
  });

  it('accepts a sound wave anchored on a threat', () => {
    expect(mutated(['cues.papa_bump.visual.anchor', 'threat'])).toMatchObject({ ok: true });
  });

  it.each<[string, [string, unknown][], string[]]>([
    ['an unknown bus on a loop', [['loops.babble.bus', 'radio']], ['loops.babble.bus']],
    [
      'an unknown bus on a cue',
      [['cues.papa_bump.audio.bus', 'radio']],
      ['cues.papa_bump.audio.bus'],
    ],
    ['a bus gain of 101', [['buses.sfx.gainPct', 101]], ['buses.sfx.gainPct']],
    ['a bus gain of -1', [['buses.sfx.gainPct', -1]], ['buses.sfx.gainPct']],
    [
      'a cue gain of 101',
      [['cues.papa_bump.audio.gainPct', 101]],
      ['cues.papa_bump.audio.gainPct'],
    ],
    ['a bus missing', [['buses.ui', undefined]], ['buses.ui']],
    [
      'an unknown haptic kind on a cue',
      [['cues.papa_bump.haptic', 'strong']],
      ['cues.papa_bump.haptic'],
    ],
    ['an empty vibration pattern', [['haptics.light.patternMs', []]], ['haptics.light.patternMs']],
    [
      'a vibration pattern of nine items',
      [['haptics.light.patternMs', [1, 1, 1, 1, 1, 1, 1, 1, 1]]],
      ['haptics.light.patternMs'],
    ],
    ['a vibration of 0 ms', [['haptics.light.patternMs', [0]]], ['haptics.light.patternMs[0]']],
    ['a negative fade', [['loops.music.fadeMs', -1]], ['loops.music.fadeMs']],
    [
      'two identical music stems',
      [['loops.music.stems.tense', 'music_crawler_calm']],
      ['loops.music.stems'],
    ],
    [
      'a music stem with no category',
      [['loops.music.stems.tense', 'crawler']],
      ['loops.music.stems.tense'],
    ],
    ['a music stem missing', [['loops.music.stems.tense', undefined]], ['loops.music.stems.tense']],
    ['an unknown key in the music loop', [['loops.music.clip', 'music_x']], ['loops.music.clip']],
    ['a cue with no member', [['cues.countdown_tick', {}]], ['cues.countdown_tick']],
    ['an unknown key at the top', [['bogus', 1]], ['bogus']],
    ['an unknown key in a bus', [['buses.sfx.bogusPct', 1]], ['buses.sfx.bogusPct']],
    ['an unknown key in a cue', [['cues.papa_bump.bogus', 1]], ['cues.papa_bump.bogus']],
    [
      'an unknown key in a sound wave',
      [['cues.papa_bump.visual.bogusM', 1]],
      ['cues.papa_bump.visual.bogusM'],
    ],
    ['a clip with no category', [['loops.babble.clip', 'bump']], ['loops.babble.clip']],
    [
      'a clip of an unknown category',
      [['cues.papa_bump.audio.clip', 'noise_bump']],
      ['cues.papa_bump.audio.clip'],
    ],
    ['a clip in camelCase', [['loops.babble.clip', 'baby_babbleLoop']], ['loops.babble.clip']],
    [
      'a sound wave of radius 0',
      [['cues.papa_bump.visual.maxRadiusM', 0]],
      ['cues.papa_bump.visual.maxRadiusM'],
    ],
    [
      'a sound wave wider than 3 m',
      [['cues.papa_bump.visual.maxRadiusM', 3.1]],
      ['cues.papa_bump.visual.maxRadiusM'],
    ],
    [
      'a sound wave of duration 0',
      [['cues.papa_bump.visual.durationMs', 0]],
      ['cues.papa_bump.visual.durationMs'],
    ],
    [
      'an unknown visual kind',
      [['cues.papa_bump.visual.kind', 'confetti']],
      ['cues.papa_bump.visual.kind'],
    ],
    [
      'a sound wave anchored on the sofa',
      [['cues.papa_bump.visual.anchor', 'sofa']],
      ['cues.papa_bump.visual.anchor'],
    ],
    [
      'an event pointing at an invalid cue id',
      [['events.PapaBlocked', 'Papa Bump']],
      ['events.PapaBlocked'],
    ],
    ['a cue id in camelCase', [['cues.papaBump', { haptic: 'light' }]], ['cues.papaBump']],
    // The cross-reference of the schema: an event whose cue does not exist (and `constructor` is
    // no cue, whatever `Object.prototype` says).
    [
      'an event pointing at a cue that does not exist',
      [['events.PapaBlocked', 'no_such_cue']],
      ['events.PapaBlocked'],
    ],
    [
      'an event pointing at the cue id "constructor"',
      [['events.PapaBlocked', 'constructor']],
      ['events.PapaBlocked'],
    ],
    // Unknown keys at every level.
    ['an unknown key in a haptic', [['haptics.light.bogusMs', 1]], ['haptics.light.bogusMs']],
    [
      'an unknown haptic kind in the table',
      [['haptics.bogus', { patternMs: [1] }]],
      ['haptics.bogus'],
    ],
    ['an unknown key in a loop', [['loops.babble.bogusPct', 1]], ['loops.babble.bogusPct']],
    ['an unknown loop', [['loops.bogus', {}]], ['loops.bogus']],
    [
      'an unknown key in a cue audio',
      [['cues.papa_bump.audio.bogusPct', 1]],
      ['cues.papa_bump.audio.bogusPct'],
    ],
    [
      'a non-integer vibration',
      [['haptics.light.patternMs', [1.5]]],
      ['haptics.light.patternMs[0]'],
    ],
    [
      'a vibration of 1001 ms',
      [['haptics.light.patternMs', [1001]]],
      ['haptics.light.patternMs[0]'],
    ],
    ['a cue gain of -1', [['cues.papa_bump.audio.gainPct', -1]], ['cues.papa_bump.audio.gainPct']],
  ])('refuses %s, and only that', (_name, changes, expected) => {
    // The exact set of failing paths: a blanket failure, or a second unrelated one, does not pass.
    expect([...new Set(failedPaths(mutated(...changes)))].sort()).toEqual([...expected].sort());
  });

  // The other side of each bound: a schema that is too strict breaks the content Geo tunes.
  it.each<[string, [string, unknown][]]>([
    ['a bus gain of 0', [['buses.sfx.gainPct', 0]]],
    ['a bus gain of 100', [['buses.sfx.gainPct', 100]]],
    ['a cue gain of 0', [['cues.papa_bump.audio.gainPct', 0]]],
    ['a cue gain of 100', [['cues.papa_bump.audio.gainPct', 100]]],
    ['a fade of 0 ms', [['loops.music.fadeMs', 0]]],
    ['a vibration of 1 ms', [['haptics.light.patternMs', [1]]]],
    ['a vibration of 1000 ms', [['haptics.light.patternMs', [1000]]]],
    ['a vibration pattern of eight items', [['haptics.light.patternMs', [1, 1, 1, 1, 1, 1, 1, 1]]]],
    ['a sound wave of radius exactly 3 m', [['cues.papa_bump.visual.maxRadiusM', 3]]],
  ])('accepts %s', (_name, changes) => {
    expect(mutated(...changes)).toMatchObject({ ok: true });
  });

  it.each(['success', 'perfect', 'gag'])('accepts the %s fx preset, alone in a cue', (preset) => {
    expect(mutated(['cues.countdown_tick', { fx: preset }])).toMatchObject({ ok: true });
  });

  it.each([
    ['an unknown preset', 'boom'],
    ['an object where a preset name is expected', { kind: 'shake', amplitudeM: 0.1 }],
  ])('refuses %s, on the fx field', (_name, fx) => {
    const failed = failedPaths(mutated(['cues.countdown_tick', { fx }]));
    expect(failed).toContain('cues.countdown_tick.fx');
  });

  it('refuses the removed camera member', () => {
    const camera = { kind: 'shake', amplitudeM: 0.1, durationMs: 100 };
    // The real cue, untouched but for the old member: nothing else can be what fails.
    const cue = (real as { cues: Record<string, Json> }).cues.countdown_tick as Json;
    expect(parse(real)).toMatchObject({ ok: true });
    const failed = failedPaths(mutated(['cues.countdown_tick', { ...cue, camera }]));
    expect(failed).toEqual(['cues.countdown_tick.camera']);
  });

  describe('pulsing sound waves (story 2.4)', () => {
    const wave = (extra: Json) => ({
      kind: 'soundWave',
      anchor: 'threat',
      maxRadiusM: 0.6,
      durationMs: 300,
      ...extra,
    });

    it.each([2, 3])('accepts %i pulses with an interval', (pulses) => {
      const result = mutated(['cues.papa_bump.visual', wave({ pulses, pulseIntervalMs: 120 })]);
      expect(result).toMatchObject({ ok: true });
    });

    it.each<[string, Json]>([
      ['1 pulse', { pulses: 1, pulseIntervalMs: 100 }],
      ['4 pulses', { pulses: 4, pulseIntervalMs: 100 }],
      ['a fractional pulse count', { pulses: 2.5, pulseIntervalMs: 100 }],
      ['an interval of 0 ms', { pulses: 2, pulseIntervalMs: 0 }],
    ])('refuses %s', (_name, extra) => {
      const failed = failedPaths(mutated(['cues.papa_bump.visual', wave(extra)]));
      expect(failed.length).toBeGreaterThan(0);
      expect(failed.every((path) => path.startsWith('cues.papa_bump.visual'))).toBe(true);
    });

    it('refuses pulses without an interval, and an interval without pulses', () => {
      expect(failedPaths(mutated(['cues.papa_bump.visual', wave({ pulses: 2 })]))).toEqual([
        'cues.papa_bump.visual.pulses',
      ]);
      expect(
        failedPaths(mutated(['cues.papa_bump.visual', wave({ pulseIntervalMs: 100 })])),
      ).toEqual(['cues.papa_bump.visual.pulses']);
    });
  });

  describe('screen flash (story 2.4)', () => {
    it('accepts a flash, and a cue with only a flash', () => {
      const flash = { peakOpacityPct: 35, durationMs: 180 };
      expect(mutated(['cues.papa_bump.flash', flash])).toMatchObject({ ok: true });
      expect(mutated(['cues.countdown_tick', { flash }])).toMatchObject({ ok: true });
    });

    it.each<[string, Json, string]>([
      ['an opacity of 0', { peakOpacityPct: 0, durationMs: 180 }, 'peakOpacityPct'],
      ['an opacity of 61', { peakOpacityPct: 61, durationMs: 180 }, 'peakOpacityPct'],
      ['a duration of 0', { peakOpacityPct: 35, durationMs: 0 }, 'durationMs'],
      ['an unknown key', { peakOpacityPct: 35, durationMs: 180, bogusMs: 1 }, 'bogusMs'],
    ])('refuses %s, on that field', (_name, flash, field) => {
      expect(failedPaths(mutated(['cues.papa_bump.flash', flash]))).toEqual([
        `cues.papa_bump.flash.${field}`,
      ]);
    });

    it('accepts the bounds 1 % and 60 %', () => {
      for (const peakOpacityPct of [1, 60]) {
        const flash = { peakOpacityPct, durationMs: 180 };
        expect(mutated(['cues.papa_bump.flash', flash])).toMatchObject({ ok: true });
      }
    });
  });

  it('accepts a uiElement visual, and refuses one with another key (story 1.22 D6)', () => {
    expect(mutated(['cues.papa_bump.visual', { kind: 'uiElement' }])).toMatchObject({ ok: true });
    expect(
      failedPaths(mutated(['cues.papa_bump.visual', { kind: 'uiElement', anchor: 'papa' }])),
    ).toEqual(['cues.papa_bump.visual.anchor']);
  });

  it.each<[string, [string, unknown][], string]>([
    ['a missing calibration block', [['calibration', undefined]], 'calibration'],
    ['a missing calibration beep', [['calibration.beep', undefined]], 'calibration.beep'],
    ['an unknown key in calibration', [['calibration.bogus', 1]], 'calibration.bogus'],
    [
      'a calibration beep with no category',
      [['calibration.beep.clip', 'beep']],
      'calibration.beep.clip',
    ],
    [
      'a calibration beep above 100 %',
      [['calibration.beep.gainPct', 101]],
      'calibration.beep.gainPct',
    ],
    ['a missing comboBadge (story 4.2)', [['comboBadge', undefined]], 'comboBadge'],
    ['an unknown key in comboBadge', [['comboBadge.bogusMs', 1]], 'comboBadge.bogusMs'],
    ['a cash-in hold of 0 ms', [['comboBadge.cashInHoldMs', 0]], 'comboBadge.cashInHoldMs'],
    ['a fractional cash-in hold', [['comboBadge.cashInHoldMs', 1.5]], 'comboBadge.cashInHoldMs'],
    ['a missing resultScreen', [['resultScreen', undefined]], 'resultScreen'],
    ['an unknown key in resultScreen', [['resultScreen.bogusMs', 1]], 'resultScreen.bogusMs'],
    ['a count-up of 0 ms', [['resultScreen.rowCountUpMs', 0]], 'resultScreen.rowCountUpMs'],
    ['a negative row stagger', [['resultScreen.rowStaggerMs', -1]], 'resultScreen.rowStaggerMs'],
    [
      'a star interval of 0 ms',
      [['resultScreen.starIntervalMs', 0]],
      'resultScreen.starIntervalMs',
    ],
    ['a fractional stars delay', [['resultScreen.starsDelayMs', 1.5]], 'resultScreen.starsDelayMs'],
    ['a negative input grace', [['resultScreen.inputGraceMs', -1]], 'resultScreen.inputGraceMs'],
    [
      'a missing input grace',
      [['resultScreen.inputGraceMs', undefined]],
      'resultScreen.inputGraceMs',
    ],
    [
      'a missing actions delay',
      [['resultScreen.actionsDelayMs', undefined]],
      'resultScreen.actionsDelayMs',
    ],
  ])('refuses %s (the Result screen timings are strict)', (_name, changes, path) => {
    expect(failedPaths(mutated(...changes))).toEqual([path]);
  });

  it('accepts a row stagger of 0 ms: the rows then count up together', () => {
    expect(mutated(['resultScreen.rowStaggerMs', 0])).toMatchObject({ ok: true });
  });

  it('accepts an input grace of 0 ms: the screen then takes every press', () => {
    expect(mutated(['resultScreen.inputGraceMs', 0])).toMatchObject({ ok: true });
  });

  describe('the end photo (story 3.6)', () => {
    it.each<[string, [string, unknown][], string]>([
      ['a missing photo', [['photo', undefined]], 'photo'],
      ['an unknown key in photo', [['photo.bogusPx', 1]], 'photo.bogusPx'],
      ['a canvas under 120 px wide', [['photo.widthPx', 119]], 'photo.widthPx'],
      ['a canvas over 1280 px wide', [['photo.widthPx', 1281]], 'photo.widthPx'],
      ['a fractional width', [['photo.widthPx', 570.5]], 'photo.widthPx'],
      ['a canvas under 80 px high', [['photo.heightPx', 79]], 'photo.heightPx'],
      ['a canvas over 1024 px high', [['photo.heightPx', 1025]], 'photo.heightPx'],
      ['a negative tilt', [['photo.tiltMaxDeg', -1]], 'photo.tiltMaxDeg'],
      ['a tilt over 3 degrees (DESIGN.md)', [['photo.tiltMaxDeg', 3.5]], 'photo.tiltMaxDeg'],
      ['a negative vignette start', [['photo.vignetteFromPct', -1]], 'photo.vignetteFromPct'],
      [
        'a vignette that starts at the edge',
        [['photo.vignetteFromPct', 100]],
        'photo.vignetteFromPct',
      ],
      ['a vignette over 100 %', [['photo.vignetteOpacityPct', 101]], 'photo.vignetteOpacityPct'],
      ['a vignette radius under 10 %', [['photo.vignetteRadiusPct', 9]], 'photo.vignetteRadiusPct'],
      [
        'a vignette radius over 200 %',
        [['photo.vignetteRadiusPct', 201]],
        'photo.vignetteRadiusPct',
      ],
      [
        'a missing vignette radius',
        [['photo.vignetteRadiusPct', undefined]],
        'photo.vignetteRadiusPct',
      ],
      [
        'a photo taller than its card fits (400 x 1024)',
        [
          ['photo.widthPx', 400],
          ['photo.heightPx', 1024],
        ],
        'photo',
      ],
      [
        'a square photo (aspect 1)',
        [
          ['photo.widthPx', 360],
          ['photo.heightPx', 360],
        ],
        'photo',
      ],
      [
        'a photo wider than 2.5 (1280 x 400)',
        [
          ['photo.widthPx', 1280],
          ['photo.heightPx', 400],
        ],
        'photo',
      ],
      ['a negative photo hold', [['resultScreen.photoHoldMs', -1]], 'resultScreen.photoHoldMs'],
      ['a fractional photo hold', [['resultScreen.photoHoldMs', 1.5]], 'resultScreen.photoHoldMs'],
      [
        'a missing photo hold',
        [['resultScreen.photoHoldMs', undefined]],
        'resultScreen.photoHoldMs',
      ],
    ])('refuses %s', (_name, changes, path) => {
      expect(failedPaths(mutated(...changes))).toEqual([path]);
    });

    it('accepts the bounds themselves, and a photo hold of 0 ms (straight to the rows)', () => {
      expect(
        mutated(
          ['photo.widthPx', 120],
          ['photo.heightPx', 80],
          ['photo.tiltMaxDeg', 0],
          ['photo.vignetteFromPct', 0],
          ['photo.vignetteOpacityPct', 0],
          ['photo.vignetteRadiusPct', 10],
          ['resultScreen.photoHoldMs', 0],
        ),
      ).toMatchObject({ ok: true });
      expect(
        mutated(
          ['photo.widthPx', 1280],
          ['photo.heightPx', 1024],
          ['photo.tiltMaxDeg', 3],
          ['photo.vignetteFromPct', 99],
          ['photo.vignetteOpacityPct', 100],
          ['photo.vignetteRadiusPct', 200],
        ),
      ).toMatchObject({ ok: true });
    });

    it('accepts the aspect bounds themselves (1.25 and 2.5)', () => {
      expect(mutated(['photo.widthPx', 500], ['photo.heightPx', 400])).toMatchObject({ ok: true });
      expect(mutated(['photo.widthPx', 1000], ['photo.heightPx', 400])).toMatchObject({ ok: true });
    });
  });

  describe('layers (story 2.3 D1)', () => {
    const layer = { clip: 'baby_laugh_perfect', bus: 'voice', gainPct: 100 };

    it.each([1, 2, 3])('accepts %i layer(s) on a cue with an audio', (count) => {
      const layers = Array.from({ length: count }, () => layer);
      expect(mutated(['cues.papa_bump.layers', layers])).toMatchObject({ ok: true });
    });

    it.each<[string, unknown, string[]]>([
      ['no layer at all', [], ['cues.papa_bump.layers']],
      ['four layers', [layer, layer, layer, layer], ['cues.papa_bump.layers']],
      [
        'a layer with a bad clip name',
        [{ ...layer, clip: 'laugh' }],
        ['cues.papa_bump.layers[0].clip'],
      ],
      [
        'a layer with an unknown bus',
        [{ ...layer, bus: 'radio' }],
        ['cues.papa_bump.layers[0].bus'],
      ],
      [
        'a layer with a gain of 101',
        [{ ...layer, gainPct: 101 }],
        ['cues.papa_bump.layers[0].gainPct'],
      ],
      [
        'an unknown key in a layer',
        [{ ...layer, bogusPct: 1 }],
        ['cues.papa_bump.layers[0].bogusPct'],
      ],
    ])('refuses %s, and only that', (_name, layers, expected) => {
      expect([...new Set(failedPaths(mutated(['cues.papa_bump.layers', layers])))]).toEqual(
        expected,
      );
    });

    it('refuses layers on a cue with no audio', () => {
      const failed = failedPaths(
        mutated(['cues.countdown_tick', { haptic: 'light', layers: [layer] }]),
      );
      expect(failed).toEqual(['cues.countdown_tick.layers']);
    });
  });

  it('accepts the table the tests build by hand: it cannot drift from the schema', () => {
    expect(parse(createTestFeedback())).toMatchObject({ ok: true });
  });

  it('gives every numeric key of the file a unit suffix, in arrays too', () => {
    const numericKeys: string[] = [];
    const walk = (node: unknown, key: string): void => {
      if (typeof node === 'number') numericKeys.push(key);
      else if (Array.isArray(node)) for (const child of node) walk(child, key);
      else if (typeof node === 'object' && node !== null) {
        for (const [name, child] of Object.entries(node)) walk(child, name);
      }
    };
    walk(real, '');
    expect(numericKeys.length).toBeGreaterThan(0);
    // `patternMs: [15]` is checked through its array's key.
    expect(numericKeys).toContain('patternMs');
    for (const key of numericKeys) expect(key, `${key} has no unit suffix`).toMatch(UNIT_SUFFIX);
  });

  it('rejects a key that only ends in a bare M or Ms: the suffixes are spelled out', () => {
    for (const key of ['gamM', 'items', 'terms']) expect(key).not.toMatch(UNIT_SUFFIX);
  });

  it('describes every key in the JSON Schema, with its unit where it has one', () => {
    const emitted = toContentJsonSchema(FeedbackTableSchema);
    const undescribed: string[] = [];
    let visited = 0;
    const walk = (node: unknown, path: string): void => {
      if (typeof node !== 'object' || node === null) return;
      const schema = node as Record<string, unknown>;
      const properties = schema.properties as Record<string, unknown> | undefined;
      for (const [name, child] of Object.entries(properties ?? {})) {
        if (name === '$schema') continue;
        visited++;
        const described = (child as { description?: unknown }).description;
        if (typeof described !== 'string' || described === '') undescribed.push(`${path}${name}`);
        walk(child, `${path}${name}.`);
      }
      const additional = schema.additionalProperties;
      if (typeof additional === 'object' && additional !== null) walk(additional, `${path}*.`);
      if (typeof schema.items === 'object') walk(schema.items, `${path}[].`);
      for (const group of [schema.oneOf, schema.anyOf, schema.allOf]) {
        for (const branch of (group as unknown[] | undefined) ?? []) walk(branch, path);
      }
      // A `$ref` would hide a whole subtree from this walk: if the emitter ever starts to use
      // them, follow them here rather than silently describe nothing.
      expect(schema.$ref, `${path} uses a $ref the walk does not follow`).toBeUndefined();
    };
    walk(emitted, '');
    // Not vacuous: the walk really went through the table (top level, buses, haptics, loops, cues...).
    expect(visited).toBeGreaterThan(30);
    expect(undescribed).toEqual([]);
  });
});

describe('the characters table (story 7.2)', () => {
  const characters = real.characters as {
    squash: Json[];
    clipSpeeds: Json[];
    papaClipFacing: Json[];
  };

  it('refuses a second squash of the same character on the same event', () => {
    const first = characters.squash[0] as Json;
    const result = mutated(['characters.squash', [...characters.squash, { ...first }]]);
    expect(failedPaths(result).some((path) => path.startsWith('characters.squash'))).toBe(true);
  });

  it('accepts one event squashing both characters', () => {
    const result = mutated([
      'characters.squash',
      [
        { event: 'GagTriggered', character: 'papa', amountPct: 10, durationMs: 100 },
        { event: 'GagTriggered', character: 'baby', amountPct: -10, durationMs: 100 },
      ],
    ]);
    expect(result).toMatchObject({ ok: true });
  });

  it('refuses a second speed for the same clip', () => {
    const first = characters.clipSpeeds[0] as Json;
    const result = mutated(['characters.clipSpeeds', [...characters.clipSpeeds, { ...first }]]);
    expect(failedPaths(result).some((path) => path.startsWith('characters.clipSpeeds'))).toBe(true);
  });

  it('squashes only on events the sim emits: a typo would silence a squash', () => {
    for (const event of SQUASH_EVENTS) expect(SIM_EVENT_TYPES, event).toContain(event);
  });
});

describe('the busy props and the facing of Papa (story 2.13)', () => {
  const characters = real.characters as { papaClipFacing: Json[]; busyProps: Json };

  it('refuses a second facing for the same clip', () => {
    const first = characters.papaClipFacing[0] as Json;
    const result = mutated([
      'characters.papaClipFacing',
      [...characters.papaClipFacing, { ...first, facing: 'awayFromBaby' }],
    ]);
    expect(failedPaths(result).some((path) => path.startsWith('characters.papaClipFacing'))).toBe(
      true,
    );
  });

  it('refuses a facing that is neither the camera nor away from the baby', () => {
    const result = mutated(['characters.papaClipFacing', [{ clip: 'drink', facing: 'sideways' }]]);
    expect(failedPaths(result).some((path) => path.startsWith('characters.papaClipFacing'))).toBe(
      true,
    );
  });

  it('accepts a table with no facing row: Papa then faces his heading', () => {
    expect(mutated(['characters.papaClipFacing', []])).toMatchObject({ ok: true });
  });

  it.each([
    ['a sway of the steam past 45 degrees', 'steamSwayDeg', 46],
    ['a negative sway of the steam', 'steamSwayDeg', -1],
    ['a stretch of the steam past 50 percent', 'steamStretchPct', 51],
    ['a steam period under the 3 Hz flash cap', 'steamPeriodMs', 333],
    ['a tilt of the bubble past 45 degrees', 'blablaTiltDeg', 46],
    ['a bob of the bubble past 0.2 m', 'blablaBobAmplitudeM', 0.21],
    ['a bubble period under the 3 Hz flash cap', 'blablaPeriodMs', 333],
  ])('refuses %s', (_name, key, value) => {
    const result = mutated([`characters.busyProps.${key}`, value]);
    expect(failedPaths(result)).toContain(`characters.busyProps.${key}`);
  });

  it.each([
    ['a bubble more than 1 m aside', 'screenOffsetM', 1.1],
    ['a bubble more than 1 m aside, to the left', 'screenOffsetM', -1.1],
    ['a bubble under 0.3 m high', 'heightM', 0.2],
    ['a bubble over 1.2 m high', 'heightM', 1.3],
  ])('refuses %s', (_name, key, value) => {
    const result = mutated([`characters.busyProps.blablaPlace.${key}`, value]);
    expect(failedPaths(result)).toContain(`characters.busyProps.blablaPlace.${key}`);
  });

  it('accepts a period exactly at the flash cap', () => {
    expect(mutated(['characters.busyProps.steamPeriodMs', 334])).toMatchObject({ ok: true });
  });

  it('squashes Papa when the coffee is drunk, and maps the first sip to a cue with audio, visual and haptic', () => {
    const parsed = parse(real);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(
      parsed.value.characters.squash.some(
        (row) => row.event === 'CoffeeDrunk' && row.character === 'papa',
      ),
    ).toBe(true);
    const cueId = parsed.value.events.CoffeeStarted;
    expect(cueId).toBeDefined();
    const cue = parsed.value.cues[cueId as string];
    expect(cue?.audio).toBeDefined();
    expect(cue?.visual).toBeDefined();
    expect(cue?.haptic).toBeDefined();
  });
});

describe('the rhythm tracks (story 4.5)', () => {
  it('names the lullaby track with its notes, count-in tick and decoy sound', () => {
    const parsed = parse(real);
    expect(parsed.ok && Object.keys(parsed.value.beatTracks)).toEqual(['lullaby']);
    const track = parsed.ok ? parsed.value.beatTracks.lullaby : undefined;
    expect(track?.notes.length).toBeGreaterThan(0);
    expect(track?.countIn).toMatch(/^music_lullaby_tick$/);
    expect(track?.decoy).toMatch(/^baby_/);
    expect(track?.bus).toBe('music');
    expect(track?.gainPct).toBeGreaterThan(0);
  });

  it.each([
    ['no note', mutated(['beatTracks.lullaby.notes', []]), ['beatTracks.lullaby.notes']],
    [
      'a note that is not a clip',
      mutated(['beatTracks.lullaby.notes', ['lullaby_note']]),
      ['beatTracks.lullaby.notes[0]'],
    ],
    [
      'no count-in tick',
      mutated(['beatTracks.lullaby.countIn', undefined]),
      ['beatTracks.lullaby.countIn'],
    ],
    [
      'no decoy sound',
      mutated(['beatTracks.lullaby.decoy', undefined]),
      ['beatTracks.lullaby.decoy'],
    ],
    ['no bus', mutated(['beatTracks.lullaby.bus', undefined]), ['beatTracks.lullaby.bus']],
    [
      'no volume',
      mutated(['beatTracks.lullaby.gainPct', undefined]),
      ['beatTracks.lullaby.gainPct'],
    ],
    [
      'a track id in capitals',
      mutated(['beatTracks', { Lullaby: (real.beatTracks as Json).lullaby }]),
      ['beatTracks.Lullaby'],
    ],
    [
      'a scheduler window of 0 ms',
      mutated(['beatScheduler.scheduleAheadMs', 0]),
      ['beatScheduler.scheduleAheadMs'],
    ],
    ['no ring approach', mutated(['beatRing.approachMs', undefined]), ['beatRing.approachMs']],
  ])('refuses %s', (_name, result, expected) => {
    expect(failedPaths(result)).toEqual(expected);
  });
});

describe('feedback.json › render (story 7.3)', () => {
  it.each([
    ['tones out of order', 'render.toonTones', [178, 96, 255]],
    ['a tone above 255', 'render.toonTones', [96, 178, 256]],
    ['a pulse above 3 Hz', 'render.dangerTint.pulseHz', 3.5],
    ['no outline width', 'render.outlines.widthM', 0],
    ['a sun under the floor', 'render.sunOffsetM', [5, -9, 7]],
    ['a colour that is not #RRGGBB', 'render.lights.default.sunColor', 'white'],
    ['a pulse low above its top', 'render.dangerTint.minOpacityPct', 95],
    ['no section', 'render.outlines', undefined],
  ] as const)('refuses %s', (_name, path, value) => {
    expect(parse(mutated([path, value])).ok).toBe(false);
  });

  it('keeps the danger glow at or under the 3 Hz of the comfort rule', () => {
    expect(parse(real).ok).toBe(true);
    expect(
      (real as { render: { dangerTint: { pulseHz: number } } }).render.dangerTint.pulseHz,
    ).toBeLessThanOrEqual(3);
  });
});
