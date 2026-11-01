import { describe, expect, it } from 'vitest';
import { botResponsesOf, releaseDefIdsOf } from './botResponses.ts';

describe('botResponsesOf', () => {
  it('maps each threat def id to the response it asks for', () => {
    const defs = {
      outlet: { response: 'parry', windowMs: 300 },
      lamp: { response: 'parry', windowMs: 500 },
    } as const;
    expect(botResponsesOf(defs)).toEqual({ outlet: 'parry', lamp: 'parry' });
  });

  it('gives an empty map for a level with no def', () => {
    expect(botResponsesOf({})).toEqual({});
  });

  it('returns a new object, so a caller cannot change the defs through it', () => {
    const defs = { outlet: { response: 'parry' } } as const;
    const responses = botResponsesOf(defs);
    expect(responses).not.toBe(defs);
  });
});

describe('releaseDefIdsOf (story 4.8)', () => {
  it('lists the defs that carry a release, in order, and keeps their response as it is', () => {
    const defs = {
      outlet: { response: 'parry' },
      bomb_drop_lay: { response: 'firm', release: { pressWithinMs: 700 } },
      cupboard: { response: 'firm', holdUntilMs: 1500 },
      second_drop: { response: 'firm', release: { pressWithinMs: 500 } },
    } as const;
    expect(releaseDefIdsOf(defs)).toEqual(['bomb_drop_lay', 'second_drop']);
    // `BotResponse` has no member for it: the response of a release def is still `firm`.
    expect(botResponsesOf(defs)).toEqual({
      outlet: 'parry',
      bomb_drop_lay: 'firm',
      cupboard: 'firm',
      second_drop: 'firm',
    });
  });

  it('gives an empty list for a level with no release def', () => {
    expect(releaseDefIdsOf({})).toEqual([]);
    expect(releaseDefIdsOf({ outlet: { response: 'parry' } })).toEqual([]);
  });
});
