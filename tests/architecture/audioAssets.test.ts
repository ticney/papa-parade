import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { feedbackClips } from '../../src/content/feedbackClips.ts';
import { parseContentFile } from '../../src/content/parseContentFile.ts';
import { FeedbackTableSchema } from '../../src/content/schemas/feedback.ts';
import { DEFAULT_LEVEL_ID, LEVEL_PAYLOAD_MAX_BYTES } from '../../src/shared/constants.ts';

// The committed audio: every clip the live feedback table names is a real MP4 audio file (a
// single-page fallback would answer a missing file with HTML), and the level's payload, the .glb
// and its clips together, stays within NFR3's 3 MB. CI has no `afconvert`: the clips are generated
// by `npm run assets:audio` (or replaced by real sounds) and committed.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const audioDir = join(root, 'public', 'assets', 'audio');
const glbFile = join(root, 'public', 'assets', 'levels', `${DEFAULT_LEVEL_ID}.glb`);

const parsed = parseContentFile(
  'content/feedback.json',
  readFileSync(join(root, 'content', 'feedback.json'), 'utf8'),
  FeedbackTableSchema,
);
if (!parsed.ok) throw new Error('content/feedback.json is invalid: run `npm run content:check`');
const clips = feedbackClips(parsed.value);

describe('the committed audio clips', () => {
  it('names at least one clip', () => {
    expect(clips.length).toBeGreaterThan(0);
  });

  it.each(clips)('%s.m4a exists and starts with an MP4 ftyp box', (clip) => {
    const bytes = readFileSync(join(audioDir, `${clip}.m4a`));
    expect(bytes.length).toBeGreaterThan(8);
    expect(bytes.toString('ascii', 4, 8)).toBe('ftyp');
  });

  it('keeps the level .glb and every clip within the payload ceiling', () => {
    const total =
      statSync(glbFile).size +
      clips.reduce((sum, clip) => sum + statSync(join(audioDir, `${clip}.m4a`)).size, 0);
    expect(total).toBeLessThanOrEqual(LEVEL_PAYLOAD_MAX_BYTES);
  });
});
