import { describe, expect, it } from 'vitest';
import { createTestFeedback } from '../../tests/support/testContent.ts';
import { feedbackClips } from './feedbackClips.ts';

describe('feedbackClips', () => {
  it('lists the loops and the cue clips, once each, sorted', () => {
    expect(feedbackClips(createTestFeedback())).toEqual([
      'baby_babble_loop',
      'music_crawler_calm',
      'music_crawler_tense',
      'papa_bump',
    ]);
  });

  it('lists a clip shared by a loop and a cue once, and skips a cue with no sound', () => {
    const table = createTestFeedback();
    table.cues.echo = {
      audio: { clip: 'baby_babble_loop', bus: 'voice', gainPct: 50 },
      haptic: 'light',
    };
    expect(feedbackClips(table)).toEqual([
      'baby_babble_loop',
      'music_crawler_calm',
      'music_crawler_tense',
      'papa_bump',
    ]);
  });

  it("lists the clips of a cue's layers, once, sorted", () => {
    const table = createTestFeedback();
    table.cues.cheer = {
      audio: { clip: 'papa_bump', bus: 'sfx', gainPct: 100 },
      layers: [
        { clip: 'baby_laugh_perfect', bus: 'voice', gainPct: 100 },
        { clip: 'baby_laugh_perfect', bus: 'voice', gainPct: 50 },
        { clip: 'env_applause', bus: 'sfx', gainPct: 100 },
      ],
      haptic: 'light',
    };
    expect(feedbackClips(table)).toEqual([
      'baby_babble_loop',
      'baby_laugh_perfect',
      'env_applause',
      'music_crawler_calm',
      'music_crawler_tense',
      'papa_bump',
    ]);
  });
});
