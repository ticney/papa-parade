import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Pillar 3 (GDD): every signal that has a sound has a visual twin and a haptic twin, so that it
// reaches the player with the sound off (NFR7) and on a device that cannot vibrate. This test
// reads `content/feedback.json` as raw JSON, not through the schema: a schema that refused the bad
// case could never load the bad fixtures that prove the guard bites. Never weaken it to pass.

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, 'fixtures', 'feedback');
const LIVE_FILE = join(here, '..', '..', 'content', 'feedback.json');

type Json = Record<string, unknown>;

/** A member is there when it is neither missing nor `null`: `"haptic": null` is no twin. */
const isPresent = (value: unknown): boolean => value !== undefined && value !== null;

/** The cues of a feedback file that carry an `audio`. */
function audioCues(table: unknown): [string, Json][] {
  const cues = (table as { cues?: unknown } | null)?.cues;
  if (typeof cues !== 'object' || cues === null) return [];
  return Object.entries(cues as Record<string, Json>).filter(([, cue]) => isPresent(cue.audio));
}

/** A visual twin is a `visual` (ring or screen element) or a `flash`: a flash alone is something to see. */
const hasVisualTwin = (cue: Json): boolean => isPresent(cue.visual) || isPresent(cue.flash);

/** The cues of a feedback file that have an `audio` and lack a `visual` or a `haptic`, one message each. */
function untwinnedCues(table: unknown): string[] {
  const problems: string[] = [];
  for (const [id, cue] of audioCues(table)) {
    if (!hasVisualTwin(cue)) problems.push(`cue "${id}" has an audio but no visual twin`);
    if (!isPresent(cue.haptic)) problems.push(`cue "${id}" has an audio but no haptic twin`);
  }
  return problems;
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

describe('feedbackEquivalence', () => {
  it('every cue of content/feedback.json that has an audio has a visual and a haptic', () => {
    expect(untwinnedCues(readJson(LIVE_FILE))).toEqual([]);
  });

  // Not vacuous: a file that lost its `cues` (renamed, restructured) or all its audio would pass the
  // test above with nothing examined.
  it('examines at least one cue with an audio in content/feedback.json', () => {
    expect(audioCues(readJson(LIVE_FILE)).length).toBeGreaterThan(0);
  });

  /** Fixture -> the problems it must give, in order. */
  const MUST_FAIL: Record<string, string[]> = {
    'audio-without-visual.json': ['papa_bump:visual'],
    'audio-without-haptic.json': ['papa_bump:haptic'],
    'audio-without-either.json': ['papa_bump:visual', 'papa_bump:haptic'],
    'audio-with-null-twins.json': ['papa_bump:visual', 'papa_bump:haptic'],
    'audio-with-null-flash.json': ['resp_parry_perfect:visual'],
  };
  const MUST_PASS = [
    'haptic-only.json',
    'visual-only.json',
    'audio-with-both-twins.json',
    'audio-with-flash-only.json',
  ];

  it('has exactly the fixtures this test declares', () => {
    expect(readdirSync(FIXTURES).sort()).toEqual([...Object.keys(MUST_FAIL), ...MUST_PASS].sort());
  });

  for (const [file, expected] of Object.entries(MUST_FAIL)) {
    it(`fails the fixture "${file}", naming the cue and the missing twin`, () => {
      const problems = untwinnedCues(readJson(join(FIXTURES, file)));
      expect(problems).toHaveLength(expected.length);
      expected.forEach((want, index) => {
        const [cue, twin] = want.split(':');
        expect(problems[index]).toContain(`"${cue}"`);
        expect(problems[index]).toContain(`no ${twin} twin`);
      });
    });
  }

  for (const file of MUST_PASS) {
    it(`passes the fixture "${file}" (no audio owes no twin; a complete cue has both)`, () => {
      expect(untwinnedCues(readJson(join(FIXTURES, file)))).toEqual([]);
    });
  }
});
