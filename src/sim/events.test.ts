import { describe, expect, it } from 'vitest';
import {
  BABY_STIR_REASONS,
  BABY_STIR_REASONS_ARE_COMPLETE,
  LEVEL_END_REASONS,
  LEVEL_END_REASONS_ARE_COMPLETE,
  SEQUENCE_OUTCOMES,
  SEQUENCE_OUTCOMES_ARE_COMPLETE,
  SIM_EVENT_TYPES,
  SIM_EVENT_TYPES_ARE_COMPLETE,
  THREAT_CANCEL_REASONS,
} from './events.ts';

// Completeness is the compiler's (see the last test); what is checked at runtime is the rest: the
// list is sorted, has no duplicate, and every name follows the event naming.
describe('SIM_EVENT_TYPES', () => {
  it('lists each event once', () => {
    expect(new Set(SIM_EVENT_TYPES).size).toBe(SIM_EVENT_TYPES.length);
  });

  it('is sorted alphabetically', () => {
    expect([...SIM_EVENT_TYPES]).toEqual([...SIM_EVENT_TYPES].sort());
  });

  it('names events in PascalCase', () => {
    for (const name of SIM_EVENT_TYPES) expect(name).toMatch(/^[A-Z][a-z]+(?:[A-Z][a-z]+)*$/);
  });

  it('lists LevelEnded and WaveStarted (story 1.18) in their alphabetical places', () => {
    const names: readonly string[] = SIM_EVENT_TYPES;
    expect(names.indexOf('LevelEnded')).toBe(names.indexOf('InvariantViolated') + 1);
    // `WaitSignalGiven` (story 4.6) sorts between them.
    expect(names.indexOf('WaitSignalGiven')).toBe(names.indexOf('ToiletStarted') + 1);
    expect(names.indexOf('WaveStarted')).toBe(names.indexOf('WaitSignalGiven') + 1);
    expect(names.indexOf('WindowOpened')).toBe(names.indexOf('WaveStarted') + 1);
  });

  it('lists LevelScored (story 1.22), MamaWoke (story 3.2), NearMiss (story 1.16), NoiseChanged (story 3.1) and ObjectTapped (story 1.17), between LevelEnded and PapaArrived', () => {
    const names: readonly string[] = SIM_EVENT_TYPES;
    expect(names.indexOf('LevelScored')).toBe(names.indexOf('LevelEnded') + 1);
    expect(names.indexOf('MamaWoke')).toBe(names.indexOf('LevelScored') + 1);
    expect(names.indexOf('NearMiss')).toBe(names.indexOf('MamaWoke') + 1);
    expect(names.indexOf('NoiseChanged')).toBe(names.indexOf('NearMiss') + 1);
    expect(names.indexOf('ObjectTapped')).toBe(names.indexOf('NoiseChanged') + 1);
    expect(names.indexOf('PapaArrived')).toBe(names.indexOf('ObjectTapped') + 1);
  });

  it('lists the four phone events (story 1.20), after PapaStateChanged and before the props', () => {
    const names: readonly string[] = SIM_EVENT_TYPES;
    const phone = ['PhoneAnswered', 'PhoneRingEnded', 'PhoneRingStarted', 'PhoneRinging'];
    expect(names.slice(names.indexOf('PapaStateChanged') + 1, names.indexOf('PropBroken'))).toEqual(
      phone,
    );
  });

  // `SIM_EVENT_TYPES_ARE_COMPLETE` is the literal `true` by construction, so this assertion cannot
  // fail at runtime: the proof is that this file typechecks (`npm run typecheck`), and a `SimEvent`
  // missing from the list stops it from doing so. The import keeps the constant, and so the proof, alive.
  it('is proved complete at compile time, by typecheck', () => {
    expect(SIM_EVENT_TYPES_ARE_COMPLETE).toBe(true);
  });
});

describe('the fatigue events (story 1.19)', () => {
  it('lists CoffeeDrunk, CoffeeStarted and FatigueThresholdCrossed in their alphabetical places', () => {
    const names: readonly string[] = SIM_EVENT_TYPES;
    expect(names.indexOf('CoffeeDrunk')).toBe(names.indexOf('BladderFilled') + 1);
    expect(names.indexOf('CoffeeStarted')).toBe(names.indexOf('CoffeeDrunk') + 1);
    expect(names.indexOf('ComboCashedIn')).toBe(names.indexOf('CoffeeStarted') + 1);
    expect(names.indexOf('ComboChanged')).toBe(names.indexOf('ComboCashedIn') + 1);
    expect(names.indexOf('DecoyCued')).toBe(names.indexOf('ComboChanged') + 1);
    expect(names.indexOf('DecoyTapped')).toBe(names.indexOf('DecoyCued') + 1);
    expect(names.indexOf('FatigueThresholdCrossed')).toBe(names.indexOf('DecoyTapped') + 1);
    expect(names.indexOf('GagTriggered')).toBe(names.indexOf('FatigueThresholdCrossed') + 1);
  });
});

describe('the lullaby walk events (story 4.5)', () => {
  it('lists the seven events in their alphabetical places', () => {
    const names: readonly string[] = SIM_EVENT_TYPES;
    expect(names.slice(names.indexOf('BabyStirred'), names.indexOf('BladderFilled'))).toEqual([
      'BabyStirred',
      'BabyWoke',
      'BeatCued',
      'BeatHit',
      'BeatMissed',
      'BeatStrayTapped',
    ]);
    expect(names).toContain('DecoyCued');
    expect(names).toContain('DecoyTapped');
  });

  it('lists the three reasons a baby stirs, proved complete at compile time', () => {
    expect([...BABY_STIR_REASONS]).toEqual(['missed', 'decoy', 'stray']);
    expect(BABY_STIR_REASONS_ARE_COMPLETE).toBe(true);
  });
});

describe('LEVEL_END_REASONS (story 3.2)', () => {
  it('lists the two ways a level ends', () => {
    expect([...LEVEL_END_REASONS]).toEqual(['timer', 'mamaWoke']);
    expect(new Set(LEVEL_END_REASONS).size).toBe(LEVEL_END_REASONS.length);
  });

  // Like `SIM_EVENT_TYPES_ARE_COMPLETE`, the proof is that this file typechecks.
  it('is proved complete at compile time, by typecheck', () => {
    expect(LEVEL_END_REASONS_ARE_COMPLETE).toBe(true);
  });
});

describe('the special-sequence events (story 4.4)', () => {
  it('lists the five events in their alphabetical places', () => {
    const names: readonly string[] = SIM_EVENT_TYPES;
    expect(names).toContain('BabyWoke');
    expect(names).toContain('PapaSnored');
    expect(names.indexOf('BabyWoke')).toBe(names.indexOf('BabyStirred') + 1);
    expect(names.indexOf('PapaSnored')).toBe(names.indexOf('PapaPathPlanned') + 1);
    expect(names.slice(names.indexOf('SequenceEnded'), names.indexOf('SilenceEnded'))).toEqual([
      'SequenceEnded',
      'SequenceStarted',
      'SequenceStepRetreated',
      'SequenceStepStarted',
    ]);
  });

  it('lists the three outcomes, proved complete at compile time, and the sequence cancel reason', () => {
    expect([...SEQUENCE_OUTCOMES]).toEqual(['succeeded', 'failed', 'levelEnded']);
    expect(SEQUENCE_OUTCOMES_ARE_COMPLETE).toBe(true);
    expect([...THREAT_CANCEL_REASONS]).toContain('sequence');
  });
});
