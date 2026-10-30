import type { SequenceDef } from '@content/schemas/sequence';
import { asSimMs } from '@shared/time';
import type { SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { createTestStayAwake } from '../../../tests/support/testContent.ts';
import { sequenceCueOf } from './sequenceFeedback.ts';

const stayAwake = createTestStayAwake();
const sequences: Record<string, SequenceDef> = { stay_awake: stayAwake };
const t = asSimMs(100);

describe('sequenceCueOf (story 4.4)', () => {
  it('plays the started cue of the def at SequenceStarted', () => {
    expect(sequenceCueOf({ type: 'SequenceStarted', t, id: 'stay_awake' }, sequences)).toBe(
      stayAwake.feedback.started,
    );
  });

  it('plays the succeeded or the failed cue at SequenceEnded', () => {
    const ended = (outcome: 'succeeded' | 'failed'): SimEvent => ({
      type: 'SequenceEnded',
      t,
      id: 'stay_awake',
      outcome,
    });
    expect(sequenceCueOf(ended('succeeded'), sequences)).toBe(stayAwake.feedback.succeeded);
    expect(sequenceCueOf(ended('failed'), sequences)).toBe(stayAwake.feedback.failed);
  });

  it('plays nothing for a step, for a level that ended it, for a sequence not loaded or any other event', () => {
    expect(
      sequenceCueOf({ type: 'SequenceStepStarted', t, id: 'stay_awake', stepIndex: 1 }, sequences),
    ).toBeNull();
    expect(
      sequenceCueOf(
        { type: 'SequenceEnded', t, id: 'stay_awake', outcome: 'levelEnded' },
        sequences,
      ),
    ).toBeNull();
    expect(sequenceCueOf({ type: 'SequenceStarted', t, id: 'unknown' }, sequences)).toBeNull();
    expect(sequenceCueOf({ type: 'SequenceStarted', t, id: 'constructor' }, sequences)).toBeNull();
    expect(sequenceCueOf({ type: 'BabyWoke', t }, sequences)).toBeNull();
  });
});
