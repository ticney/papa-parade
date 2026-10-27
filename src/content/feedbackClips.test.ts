import { describe, expect, it } from 'vitest';
import { createTestFeedback } from '../../tests/support/testContent.ts';
import { feedbackClips } from './feedbackClips.ts';

describe('feedbackClips', () => {
  it('lists the loops and the cue clips, once each, sorted', () => {
    expect(feedbackClips(createTestFeedback())).toEqual([
      'baby_babble_loop',
      'music_crawler_calm',
      'papa_bump',
    ]);
  });

  it('lists a clip shared by a loop and a cue once, and skips a cue with no sound', () => {
    const table = createTestFeedback();
    table.cues.echo = {
      audio: { clip: 'baby_babble_loop', bus: 'voice', gainPct: 50 },
      haptic: 'light',
    };
    expect(feedbackClips(table)).toEqual(['baby_babble_loop', 'music_crawler_calm', 'papa_bump']);
  });
});
