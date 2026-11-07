import type { MamaLine } from '@content/schemas/mamaLines';
import type { MamaMemory } from '@content/schemas/save';
import { MAMA_REACTIONS, type MamaReactionId } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import { LEVEL_END_REASONS, SIM_EVENT_TYPES, type SimEvent } from '../events.ts';
import { GAG_IDS } from '../threats/gags.ts';
import { addRunToMamaMemory, chooseMamaLines, mamaTagOf } from './mamaMemory.ts';

const GAG_EVENT_TYPES = new Set(['GagTriggered', 'NearMiss', 'NearMissFrozen']);

describe('mamaTagOf (story 3.8, AC 1-2)', () => {
  it('reads the gag of a GagTriggered, a NearMiss and a NearMissFrozen', () => {
    const triggered: SimEvent = {
      type: 'GagTriggered',
      t: asSimMs(1000),
      threatId: 1,
      gag: 'stairs_slide',
      reason: 'late',
    };
    const nearMiss: SimEvent = {
      type: 'NearMiss',
      t: asSimMs(1000),
      threatId: 1,
      gag: 'stairs_slide',
    };
    const frozen: SimEvent = {
      type: 'NearMissFrozen',
      t: asSimMs(2000),
      threatId: 2,
      gag: 'stairs_slide',
    };
    expect(mamaTagOf(triggered)).toBe('stairs_slide');
    expect(mamaTagOf(nearMiss)).toBe('stairs_slide');
    expect(mamaTagOf(frozen)).toBe('stairs_slide');
  });

  it('answers null for every other event type', () => {
    const others = SIM_EVENT_TYPES.filter((type) => !GAG_EVENT_TYPES.has(type));
    expect(others.length).toBeGreaterThan(40);
    for (const type of others) {
      // Only the `type` is read: a loose shape is enough to prove nothing else carries a tag.
      expect(mamaTagOf({ type, t: 0, gag: 'stairs_slide' } as unknown as SimEvent)).toBeNull();
    }
  });

  it('knows every gag id of the sim', () => {
    for (const gag of GAG_IDS) {
      expect(mamaTagOf({ type: 'NearMissFrozen', t: asSimMs(0), threatId: 1, gag })).toBe(gag);
    }
  });
});

describe('addRunToMamaMemory (story 3.8, D3)', () => {
  it('adds 1 per distinct tag of the run: games, not occurrences', () => {
    const memory: MamaMemory = { counts: { stairs_slide: 2 } };
    const next = addRunToMamaMemory(memory, new Set(['stairs_slide', 'outlet_hair']));
    expect(next).toEqual({ counts: { stairs_slide: 3, outlet_hair: 1 } });
  });

  it('counts a tag once however many times the game fed it into the set', () => {
    const tags = new Set<string>();
    for (let i = 0; i < 5; i++) tags.add('stairs_slide');
    expect(addRunToMamaMemory({ counts: {} }, tags)).toEqual({ counts: { stairs_slide: 1 } });
  });

  it('returns a new object and leaves its input alone', () => {
    const memory: MamaMemory = { counts: { stairs_slide: 1 } };
    const frozen = Object.freeze({ counts: Object.freeze({ ...memory.counts }) });
    const next = addRunToMamaMemory(frozen, new Set(['stairs_slide']));
    expect(next).not.toBe(frozen);
    expect(next.counts).not.toBe(frozen.counts);
    expect(frozen).toEqual({ counts: { stairs_slide: 1 } });
  });

  it('keeps a tag the content no longer knows and changes nothing for an empty run', () => {
    const memory: MamaMemory = { counts: { old_gag_gone: 4 } };
    expect(addRunToMamaMemory(memory, new Set())).toEqual(memory);
    expect(addRunToMamaMemory(memory, new Set(['stairs_slide']))).toEqual({
      counts: { old_gag_gone: 4, stairs_slide: 1 },
    });
  });
});

const line = (
  id: string,
  reaction: MamaReactionId,
  when?: MamaLine['when'],
  text = id.toUpperCase(),
): MamaLine => (when === undefined ? { id, reaction, text } : { id, reaction, text, when });

const GENERIC: readonly MamaLine[] = [
  line('laugh_any', 'laugh'),
  line('sigh_any', 'sigh'),
  line('scream_any', 'scream'),
];
const NO_MEMORY: MamaMemory = { counts: {} };

const idsOfChoice = (
  lines: readonly MamaLine[],
  options: {
    reactions?: readonly MamaReactionId[];
    endReason?: (typeof LEVEL_END_REASONS)[number];
    runTags?: readonly string[];
    memory?: MamaMemory;
    seed?: number;
  } = {},
): string[] =>
  chooseMamaLines({
    reactions: (options.reactions ?? MAMA_REACTIONS).map((reaction) => ({ reaction, points: 1 })),
    endReason: options.endReason ?? 'timer',
    runTags: new Set(options.runTags ?? []),
    memory: options.memory ?? NO_MEMORY,
    lines,
    seed: options.seed ?? 1,
  }).map((choice) => choice.lineId);

describe('chooseMamaLines (story 3.8, D6)', () => {
  it('falls back to the generic line of each reaction', () => {
    expect(idsOfChoice(GENERIC)).toEqual(['laugh_any', 'sigh_any', 'scream_any']);
  });

  it('returns the reaction, its points, the line id and its text, in the order of the reactions', () => {
    const lines = chooseMamaLines({
      reactions: [
        { reaction: 'scream', points: 3 },
        { reaction: 'laugh', points: 0 },
      ],
      endReason: 'timer',
      runTags: new Set(),
      memory: NO_MEMORY,
      lines: [line('scream_any', 'scream', undefined, 'Attention !'), line('laugh_any', 'laugh')],
      seed: 7,
    });
    expect(lines).toEqual([
      { reaction: 'scream', points: 3, lineId: 'scream_any', text: 'Attention !' },
      { reaction: 'laugh', points: 0, lineId: 'laugh_any', text: 'LAUGH_ANY' },
    ]);
  });

  it('gives an empty list for no reaction', () => {
    expect(idsOfChoice(GENERIC, { reactions: [] })).toEqual([]);
  });

  it('prefers a tag line to the generic one only when the tag is in the run', () => {
    const lines = [...GENERIC, line('stairs_first', 'scream', { tag: 'stairs_slide' })];
    expect(idsOfChoice(lines, { reactions: ['scream'] })).toEqual(['scream_any']);
    expect(idsOfChoice(lines, { reactions: ['scream'], runTags: ['outlet_hair'] })).toEqual([
      'scream_any',
    ]);
    expect(idsOfChoice(lines, { reactions: ['scream'], runTags: ['stairs_slide'] })).toEqual([
      'stairs_first',
    ]);
  });

  it('reads minPrevious in the memory before the game, and prefers the larger one', () => {
    const lines = [
      ...GENERIC,
      line('stairs_first', 'scream', { tag: 'stairs_slide', minPrevious: 0 }),
      line('stairs_again', 'scream', { tag: 'stairs_slide', minPrevious: 1 }),
      line('stairs_often', 'scream', { tag: 'stairs_slide', minPrevious: 3 }),
    ];
    const pick = (count?: number) =>
      idsOfChoice(lines, {
        reactions: ['scream'],
        runTags: ['stairs_slide'],
        memory: { counts: count === undefined ? {} : { stairs_slide: count } },
      })[0];
    expect(pick()).toBe('stairs_first');
    expect(pick(1)).toBe('stairs_again');
    expect(pick(2)).toBe('stairs_again');
    expect(pick(3)).toBe('stairs_often');
  });

  it('does not say « encore » about a tag she remembers but did not see in this game', () => {
    const lines = [
      ...GENERIC,
      line('stairs_again', 'scream', { tag: 'stairs_slide', minPrevious: 1 }),
    ];
    expect(
      idsOfChoice(lines, { reactions: ['scream'], memory: { counts: { stairs_slide: 5 } } }),
    ).toEqual(['scream_any']);
  });

  it('keeps a line whose tag she has never seen out of the running', () => {
    const lines = [...GENERIC, line('plant_again', 'sigh', { tag: 'soil_on_rug', minPrevious: 1 })];
    expect(
      idsOfChoice(lines, { reactions: ['sigh'], runTags: ['soil_on_rug'], memory: NO_MEMORY }),
    ).toEqual(['sigh_any']);
  });

  it('matches the end reason', () => {
    const lines = [...GENERIC, line('scream_woke', 'scream', { endReason: 'mamaWoke' })];
    expect(idsOfChoice(lines, { reactions: ['scream'], endReason: 'mamaWoke' })).toEqual([
      'scream_woke',
    ]);
    for (const endReason of LEVEL_END_REASONS.filter((reason) => reason !== 'mamaWoke')) {
      expect(idsOfChoice(lines, { reactions: ['scream'], endReason })).toEqual(['scream_any']);
    }
  });

  it('lets two conditions beat one', () => {
    const lines = [
      ...GENERIC,
      line('scream_woke', 'scream', { endReason: 'mamaWoke' }),
      line('stairs_first', 'scream', { tag: 'stairs_slide' }),
      line('stairs_woke', 'scream', { tag: 'stairs_slide', endReason: 'mamaWoke' }),
    ];
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(
        idsOfChoice(lines, {
          reactions: ['scream'],
          endReason: 'mamaWoke',
          runTags: ['stairs_slide'],
          seed,
        }),
      ).toEqual(['stairs_woke']);
    }
  });

  it('never gives a reaction the line of another', () => {
    const lines = [
      ...GENERIC,
      line('stairs_scream', 'scream', { tag: 'stairs_slide' }),
      line('stairs_sigh', 'sigh', { tag: 'stairs_slide' }),
    ];
    expect(idsOfChoice(lines, { runTags: ['stairs_slide'] })).toEqual([
      'laugh_any',
      'stairs_sigh',
      'stairs_scream',
    ]);
  });

  it('draws among the equals with the seed: the same seed gives the same line, and both come out', () => {
    const lines = [
      ...GENERIC,
      line('scream_woke', 'scream', { endReason: 'mamaWoke' }),
      line('stairs_first', 'scream', { tag: 'stairs_slide' }),
    ];
    const options = {
      reactions: ['scream'] as const,
      endReason: 'mamaWoke' as const,
      runTags: ['stairs_slide'],
    };
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const first = idsOfChoice(lines, { ...options, seed });
      expect(idsOfChoice(lines, { ...options, seed })).toEqual(first);
      expect(['scream_woke', 'stairs_first']).toContain(first[0]);
      seen.add(first[0] as string);
    }
    expect(seen).toEqual(new Set(['scream_woke', 'stairs_first']));
  });

  it('draws only when there is a tie, and a seed outside 32 bits cannot break it', () => {
    const lines = [...GENERIC, line('stairs_first', 'scream', { tag: 'stairs_slide' })];
    const lonely = (seed: number) =>
      idsOfChoice(lines, { reactions: ['scream'], runTags: ['stairs_slide'], seed });
    expect(lonely(0)).toEqual(['stairs_first']);
    expect(lonely(0xffffffff)).toEqual(['stairs_first']);
  });

  it('breaks ties among generic lines too', () => {
    const lines = [line('laugh_a', 'laugh'), line('laugh_b', 'laugh')];
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      seen.add(idsOfChoice(lines, { reactions: ['laugh'], seed })[0] as string);
    }
    expect(seen).toEqual(new Set(['laugh_a', 'laugh_b']));
  });

  it('stops when a reaction has no line at all: content:check forbids it, the function insists', () => {
    expect(() => idsOfChoice([line('laugh_any', 'laugh')], { reactions: ['sigh'] })).toThrow(
      /sigh/,
    );
  });
});
