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

/** The cues of a feedback file that have an `audio` and lack a `visual` or a `haptic`, one message each. */
function untwinnedCues(table: unknown): string[] {
  const cues = (table as { cues?: Record<string, Json> } | null)?.cues ?? {};
  const problems: string[] = [];
  for (const [id, cue] of Object.entries(cues)) {
    if (cue.audio === undefined) continue;
    if (cue.visual === undefined) problems.push(`cue "${id}" has an audio but no visual twin`);
    if (cue.haptic === undefined) problems.push(`cue "${id}" has an audio but no haptic twin`);
  }
  return problems;
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

describe('feedbackEquivalence', () => {
  it('every cue of content/feedback.json that has an audio has a visual and a haptic', () => {
    expect(untwinnedCues(readJson(LIVE_FILE))).toEqual([]);
  });

  const MUST_FAIL: Record<string, string> = {
    'audio-without-visual.json': 'papa_bump',
    'audio-without-haptic.json': 'papa_bump',
  };
  const MUST_PASS = ['haptic-only.json', 'visual-only.json'];

  it('has exactly the fixtures this test declares', () => {
    expect(readdirSync(FIXTURES).sort()).toEqual([...Object.keys(MUST_FAIL), ...MUST_PASS].sort());
  });

  for (const [file, cue] of Object.entries(MUST_FAIL)) {
    it(`fails the fixture "${file}", naming the cue`, () => {
      const problems = untwinnedCues(readJson(join(FIXTURES, file)));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(`"${cue}"`);
    });
  }

  for (const file of MUST_PASS) {
    it(`passes the fixture "${file}" (a cue without audio owes no twin)`, () => {
      expect(untwinnedCues(readJson(join(FIXTURES, file)))).toEqual([]);
    });
  }

  it('names the missing twin: the visual and the haptic are told apart', () => {
    expect(untwinnedCues(readJson(join(FIXTURES, 'audio-without-visual.json')))[0]).toContain(
      'visual',
    );
    expect(untwinnedCues(readJson(join(FIXTURES, 'audio-without-haptic.json')))[0]).toContain(
      'haptic',
    );
  });
});
