import { MAMA_REACTIONS } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import { LEVEL_END_REASONS } from '../events.ts';
import type { MamaScore } from '../world.ts';
import { mamaReactionsOf } from './mamaReactions.ts';

const NOTE: MamaScore = {
  laughPoints: 0,
  calmPoints: 30,
  homePoints: 0,
  sighPoints: 0,
  screamPoints: 0,
  scorePoints: 60,
  stars: 3,
  lostStars: 0,
};
const note = (changes: Partial<MamaScore>): MamaScore => ({ ...NOTE, ...changes });
const idsOf = (score: MamaScore, reason: (typeof LEVEL_END_REASONS)[number] = 'timer') =>
  mamaReactionsOf(score, reason).map((entry) => entry.reaction);

describe('mamaReactionsOf (story 3.7, D4)', () => {
  it('lists the reactions in the order Laugh, Sigh, Scream', () => {
    expect(MAMA_REACTIONS).toEqual(['laugh', 'sigh', 'scream']);
    expect(idsOf(note({ laughPoints: 4, sighPoints: 2, screamPoints: 1 }))).toEqual([
      'laugh',
      'sigh',
      'scream',
    ]);
  });

  it('plays a reaction only when its component has points', () => {
    expect(idsOf(note({ laughPoints: 4 }))).toEqual(['laugh']);
    expect(idsOf(note({ sighPoints: 3 }))).toEqual(['sigh']);
    expect(idsOf(note({ screamPoints: 3 }))).toEqual(['scream']);
    expect(idsOf(note({ laughPoints: 4, screamPoints: 3 }))).toEqual(['laugh', 'scream']);
    expect(idsOf(note({ sighPoints: 1, screamPoints: 3 }))).toEqual(['sigh', 'scream']);
  });

  it('carries the points of the component, not of the others', () => {
    expect(
      mamaReactionsOf(note({ laughPoints: 7, sighPoints: 2.5, screamPoints: 4 }), 'timer'),
    ).toEqual([
      { reaction: 'laugh', points: 7 },
      { reaction: 'sigh', points: 2.5 },
      { reaction: 'scream', points: 4 },
    ]);
  });

  it('has no reaction for the Calme and the Maison rows', () => {
    expect(idsOf(note({ calmPoints: 40, homePoints: 15, laughPoints: 1 }))).toEqual(['laugh']);
  });

  it('still reacts when there is nothing at all: the Laugh, worth 0', () => {
    expect(mamaReactionsOf(NOTE, 'timer')).toEqual([{ reaction: 'laugh', points: 0 }]);
  });

  it('always screams when she was woken or came home early, even with no near miss', () => {
    for (const reason of ['mamaWoke', 'mamaHome'] as const) {
      expect(mamaReactionsOf(NOTE, reason), reason).toEqual([{ reaction: 'scream', points: 0 }]);
      expect(idsOf(note({ laughPoints: 4, sighPoints: 2 }), reason), reason).toEqual([
        'laugh',
        'sigh',
        'scream',
      ]);
      expect(mamaReactionsOf(note({ screamPoints: 5 }), reason), reason).toEqual([
        { reaction: 'scream', points: 5 },
      ]);
    }
  });

  it('follows the general rule for a timer end and a finished bedtime cycle', () => {
    for (const reason of ['timer', 'cycleDone'] as const) {
      expect(mamaReactionsOf(NOTE, reason), reason).toEqual([{ reaction: 'laugh', points: 0 }]);
      expect(idsOf(note({ sighPoints: 2 }), reason), reason).toEqual(['sigh']);
    }
  });

  it('answers every end reason there is, with at least one reaction', () => {
    for (const reason of LEVEL_END_REASONS) {
      expect(mamaReactionsOf(NOTE, reason).length, reason).toBeGreaterThan(0);
      expect(idsOf(NOTE, reason).includes('scream'), reason).toBe(
        reason === 'mamaWoke' || reason === 'mamaHome',
      );
    }
  });
});
