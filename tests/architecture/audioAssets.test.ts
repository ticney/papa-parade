import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { feedbackClips } from '../../src/content/feedbackClips.ts';
import { parseContentFile } from '../../src/content/parseContentFile.ts';
import { FeedbackTableSchema } from '../../src/content/schemas/feedback.ts';
import {
  LEVEL_PAYLOAD_MAX_BYTES,
  LEVEL_PAYLOAD_MAX_BYTES_BY_ID,
} from '../../src/shared/constants.ts';

// The committed audio: every clip the live feedback table names is a real MP4 audio file (a
// single-page fallback would answer a missing file with HTML), and the level's payload, the .glb
// and its clips together, stays within NFR3's 3 MB. CI has no `afconvert`: the clips are generated
// by `npm run assets:audio` (or replaced by real sounds) and committed.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const audioDir = join(root, 'public', 'assets', 'audio');
const levelsDir = join(root, 'public', 'assets', 'levels');
/** Every level of `content/levels/`, each held to its own budget (story 9.8: not only the default level). */
const levelIds = readdirSync(join(root, 'content', 'levels'))
  .filter((file) => file.endsWith('.json') && !file.endsWith('.geometry.json'))
  .map((file) => file.replace(/\.json$/, ''));

const parsed = parseContentFile(
  'content/feedback.json',
  readFileSync(join(root, 'content', 'feedback.json'), 'utf8'),
  FeedbackTableSchema,
);
if (!parsed.ok) throw new Error('content/feedback.json is invalid: run `npm run content:check`');
const clips = feedbackClips(parsed.value);
/** Below this, a file is a header and not a sound, in bytes. */
const MIN_CLIP_BYTES = 1024;

describe('the committed audio clips', () => {
  it('names at least one clip', () => {
    expect(clips.length).toBeGreaterThan(0);
  });

  // A 12-byte stub with a valid header would decode to silence with every test green: the brand
  // is the audio one (`M4A `, what `afconvert -f m4af` writes, not an MP4 video or ALAC) and the
  // file is more than a header.
  it.each(clips)('%s.m4a exists, is an M4A audio file and is not a stub', (clip) => {
    const bytes = readFileSync(join(audioDir, `${clip}.m4a`));
    expect(bytes.length).toBeGreaterThan(MIN_CLIP_BYTES);
    expect(bytes.toString('ascii', 4, 8)).toBe('ftyp');
    expect(bytes.toString('ascii', 8, 12)).toBe('M4A ');
  });

  it('has at least one level to measure', () => {
    expect(levelIds.length).toBeGreaterThan(0);
    expect(levelIds).toContain('salon_kitchen');
  });

  // The ceiling of the level's own budget (`inspectDist` applies the same rule to the built `dist/`).
  it.each(levelIds)('keeps the .glb of %s and every clip within its payload ceiling', (id) => {
    const budget = Object.hasOwn(LEVEL_PAYLOAD_MAX_BYTES_BY_ID, id)
      ? (LEVEL_PAYLOAD_MAX_BYTES_BY_ID[id] as number)
      : LEVEL_PAYLOAD_MAX_BYTES;
    const total =
      statSync(join(levelsDir, `${id}.glb`)).size +
      clips.reduce((sum, clip) => sum + statSync(join(audioDir, `${clip}.m4a`)).size, 0);
    expect(total).toBeLessThanOrEqual(budget);
  });
});
