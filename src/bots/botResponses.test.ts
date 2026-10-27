import { describe, expect, it } from 'vitest';
import { botResponsesOf } from './botResponses.ts';

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
