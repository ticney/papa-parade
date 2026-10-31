import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCREEN_FLASH_MIN_INTERVAL_MS } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import { checkFlashRate, repeatingAnimations } from './designTokens.ts';
import { extractFrontmatter, parseYamlSubset, type YamlMap } from './yamlSubset.ts';

// Nothing blinks faster than 3 Hz (NFR6, story 2.10 AC 13-14). Pure parsing of the shipped files, and
// for each rule a failing fixture that proves the rule bites. Never loosen a bound to pass.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const DESIGN = join(
  repoRoot,
  '_bmad-output',
  'planning-artifacts',
  'ux-designs',
  'ux-papa-parade-2026-10-26',
  'DESIGN.md',
);
const MAX_FLASH_HZ = 3;

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

function listCss(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return listCss(path);
      return name.endsWith('.css') ? [path] : [];
    });
}

// ---------------------------------------------------------------------------------------------
// CSS: a repeating animation of opacity
// ---------------------------------------------------------------------------------------------

describe('a repeating CSS animation of opacity has a period of at least 334 ms (3 Hz)', () => {
  const sheets = listCss(join(repoRoot, 'src')).map((file) => ({
    file,
    css: readFileSync(file, 'utf8'),
  }));

  it('holds for every stylesheet of the client', () => {
    for (const { file, css } of sheets) {
      expect(checkFlashRate(css, SCREEN_FLASH_MIN_INTERVAL_MS), file).toEqual([]);
    }
  });

  // Not vacuous: a parser that found nothing would pass the test above.
  it('sees the repeating animations that exist today: bubble 500 ms, gauge 1 s, halos 1400 ms, prompt 2 s', () => {
    const found = sheets.flatMap(({ css }) => repeatingAnimations(css).animations);
    const periodOf = (name: string) =>
      found.filter((animation) => animation.name === name).map((animation) => animation.periodMs);
    expect(periodOf('pp-silence-blink')).toEqual([500]);
    expect(periodOf('pp-gauge-pulse')).toEqual([1000]);
    expect(periodOf('pp-threat-pulse')).toEqual([1400, 1400]);
    expect(periodOf('pp-breathe')).toEqual([2000]);
    expect(found.filter((animation) => animation.animatesOpacity).length).toBeGreaterThanOrEqual(5);
  });

  const KEYFRAMES = '@keyframes pp-k { 50% { opacity: 0.2; } }';

  it('flags a faster blink, with the rate in the message', () => {
    expect(
      checkFlashRate(
        `.pp-a { animation: pp-k 250ms steps(1, end) infinite; } ${KEYFRAMES}`,
        SCREEN_FLASH_MIN_INTERVAL_MS,
      ),
    ).toEqual(['".pp-a" repeats pp-k every 250 ms (4.0 Hz): a flash is at most 3 Hz']);
  });

  it('flags the period one millisecond under the bound and accepts the bound itself', () => {
    expect(
      checkFlashRate(`.pp-a { animation: pp-k 333ms infinite; } ${KEYFRAMES}`, 334),
    ).toHaveLength(1);
    expect(checkFlashRate(`.pp-a { animation: pp-k 334ms infinite; } ${KEYFRAMES}`, 334)).toEqual(
      [],
    );
  });

  it('reads seconds, a delay and an easing with commas', () => {
    expect(
      checkFlashRate(
        `.pp-a { animation: pp-k 0.2s cubic-bezier(0.1, 0.7, 1, 0.1) 50ms infinite; } ${KEYFRAMES}`,
        334,
      ),
    ).toEqual(['".pp-a" repeats pp-k every 200 ms (5.0 Hz): a flash is at most 3 Hz']);
  });

  it('checks each animation of a list, and each selector', () => {
    const css = `.pp-a, .pp-b { animation: pp-k 1s infinite, pp-k 100ms infinite; } ${KEYFRAMES}`;
    expect(checkFlashRate(css, 334)).toHaveLength(2);
  });

  it('does not count movement or an animation that ends', () => {
    expect(
      checkFlashRate(
        '.pp-a { animation: pp-m 100ms infinite; } @keyframes pp-m { to { transform: scale(2); } }',
        334,
      ),
    ).toEqual([]);
    expect(checkFlashRate(`.pp-a { animation: pp-k 100ms 3; } ${KEYFRAMES}`, 334)).toEqual([]);
  });

  it('refuses what it cannot read, so that a longhand is no way around the rule', () => {
    expect(
      checkFlashRate(
        `.pp-a { animation-name: pp-k; animation-duration: 100ms; animation-iteration-count: infinite; } ${KEYFRAMES}`,
        334,
      ),
    ).toHaveLength(1);
    expect(checkFlashRate(`.pp-a { animation: pp-k infinite; } ${KEYFRAMES}`, 334)).toHaveLength(1);
    expect(checkFlashRate('.pp-a { animation: pp-gone 1s infinite; }', 334)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// The bubble's two rates, against DESIGN.md
// ---------------------------------------------------------------------------------------------

describe('the silence bubble’s rates stay inside DESIGN.md (silence-bubble)', () => {
  const frontmatter = parseYamlSubset(extractFrontmatter(readFileSync(DESIGN, 'utf8')));
  const bubble = (frontmatter.components as YamlMap)['silence-bubble'] as YamlMap;
  const maxFlashHz = Number(bubble.maxFlashHz);
  const reducedMotionPulseHz = Number(bubble.reducedMotionPulseHz);
  const css = readFileSync(join(repoRoot, 'src', 'client', 'ui', 'styles', 'ui.css'), 'utf8');
  const { animations } = repeatingAnimations(css);
  const rateOf = (name: string): number => {
    const found = animations.filter((animation) => animation.name === name);
    expect(found, name).toHaveLength(1);
    return 1000 / (found[0]?.periodMs ?? Number.NaN);
  };

  it('reads both bounds as numbers, and the flash bound is the 3 Hz of NFR6', () => {
    expect(maxFlashHz).toBe(MAX_FLASH_HZ);
    expect(reducedMotionPulseHz).toBeGreaterThan(0);
    expect(reducedMotionPulseHz).toBeLessThanOrEqual(maxFlashHz);
  });

  it('blinks (pp-silence-blink) at no more than maxFlashHz', () => {
    expect(rateOf('pp-silence-blink')).toBeLessThanOrEqual(maxFlashHz);
  });

  it('pulses (pp-silence-pulse) under reduced motion at no more than reducedMotionPulseHz', () => {
    expect(rateOf('pp-silence-pulse')).toBeLessThanOrEqual(reducedMotionPulseHz);
  });
});

// ---------------------------------------------------------------------------------------------
// content/feedback.json: the screen flash, and the sound rings (decision D3)
// ---------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;

const cuesOf = (table: unknown): [string, Json][] => {
  const cues = (table as { cues?: unknown } | null)?.cues;
  if (typeof cues !== 'object' || cues === null) return [];
  return Object.entries(cues as Record<string, Json>);
};

/** Every cue's screen flash lasts at most the 3 Hz interval, so that a flash never restarts on itself. */
function flashProblems(table: unknown): string[] {
  const problems: string[] = [];
  for (const [id, cue] of cuesOf(table)) {
    const flash = cue.flash as { durationMs?: unknown } | null | undefined;
    if (flash === undefined || flash === null) continue;
    if (typeof flash.durationMs !== 'number' || flash.durationMs > SCREEN_FLASH_MIN_INTERVAL_MS) {
      problems.push(
        `cue "${id}": flash.durationMs ${String(flash.durationMs)} is over the 3 Hz interval`,
      );
    }
  }
  return problems;
}

/**
 * Decision D3: a sound ring is not a flash. `pulses` (2 or 3, every `pulseIntervalMs` of 120-250 ms)
 * sends small rings one after the other from a source, each growing and fading once: a ripple over a
 * small area, not an on/off of the screen. A rate test on `pulseIntervalMs` would call it a flash, and
 * would be wrong; what bounds it is the count, so that a ripple never becomes a strobe.
 */
function ringProblems(table: unknown): string[] {
  const problems: string[] = [];
  for (const [id, cue] of cuesOf(table)) {
    const visual = cue.visual as { kind?: unknown; pulses?: unknown } | null | undefined;
    if (visual === undefined || visual === null || visual.pulses === undefined) continue;
    if (typeof visual.pulses !== 'number' || visual.pulses > 3) {
      problems.push(`cue "${id}": ${String(visual.pulses)} rings, at most 3`);
    }
  }
  return problems;
}

describe('content/feedback.json', () => {
  const live = readJson(join(repoRoot, 'content', 'feedback.json'));

  it('every cue’s flash lasts at most the 3 Hz interval (threat, disruption and sequence cues included)', () => {
    expect(flashProblems(live)).toEqual([]);
  });

  it('examines the cues that flash today', () => {
    const flashing = cuesOf(live).filter(
      ([, cue]) => cue.flash !== undefined && cue.flash !== null,
    );
    expect(flashing.map(([id]) => id)).toEqual(
      expect.arrayContaining(['resp_parry_perfect', 'resp_firm_perfect', 'combo_cashed_in']),
    );
    expect(cuesOf(live).length).toBeGreaterThan(30);
  });

  it('flags a flash longer than the interval, or without a duration', () => {
    const table = (flash: unknown) => ({ cues: { c: { flash } } });
    expect(flashProblems(table({ peakOpacityPct: 35, durationMs: 335 }))).toHaveLength(1);
    expect(flashProblems(table({ peakOpacityPct: 35 }))).toHaveLength(1);
    expect(flashProblems(table({ peakOpacityPct: 35, durationMs: 334 }))).toEqual([]);
    expect(flashProblems({ cues: { c: { flash: null }, d: {} } })).toEqual([]);
  });

  it('sends at most 3 sound rings per cue: a ripple, not a flash (decision D3)', () => {
    expect(ringProblems(live)).toEqual([]);
    const pulsing = cuesOf(live).filter(([, cue]) => (cue.visual as Json | undefined)?.pulses);
    expect(pulsing.length).toBeGreaterThan(0);
    const table = (pulses: unknown) => ({ cues: { c: { visual: { kind: 'soundWave', pulses } } } });
    expect(ringProblems(table(4))).toHaveLength(1);
    expect(ringProblems(table('3'))).toHaveLength(1);
    expect(ringProblems(table(3))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// content/feel.json: the calibration beats
// ---------------------------------------------------------------------------------------------

/** The calibration flashes the screen on each beat: `bpm / 60` beats a second is the rate of the flash. */
const calibrationProblems = (feel: unknown): string[] => {
  const bpm = (feel as { calibration?: { bpm?: unknown } } | null)?.calibration?.bpm;
  if (typeof bpm !== 'number') return ['feel.calibration.bpm is missing'];
  return bpm / 60 > MAX_FLASH_HZ ? [`${bpm} bpm is ${(bpm / 60).toFixed(2)} Hz, over 3 Hz`] : [];
};

describe('content/feel.json calibration', () => {
  it('beats at most 3 Hz in the shipped file', () => {
    const feel = readJson(join(repoRoot, 'content', 'feel.json'));
    expect(calibrationProblems(feel)).toEqual([]);
    expect((feel as { calibration: { bpm: number } }).calibration.bpm / 60).toBeLessThanOrEqual(
      MAX_FLASH_HZ,
    );
  });

  it('flags a tempo over 180 bpm, and a missing one', () => {
    expect(calibrationProblems({ calibration: { bpm: 181 } })).toHaveLength(1);
    expect(calibrationProblems({ calibration: { bpm: 180 } })).toEqual([]);
    expect(calibrationProblems({ calibration: {} })).toHaveLength(1);
    expect(calibrationProblems({})).toHaveLength(1);
  });
});
