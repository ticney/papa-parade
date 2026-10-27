import { describe, expect, it } from 'vitest';
import { SIM_EVENT_TYPES, SIM_EVENT_TYPES_ARE_COMPLETE } from './events.ts';

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

  it('lists NearMiss (story 1.16), between InvariantViolated and PapaArrived', () => {
    const names: readonly string[] = SIM_EVENT_TYPES;
    expect(names.indexOf('NearMiss')).toBe(names.indexOf('InvariantViolated') + 1);
    expect(names.indexOf('PapaArrived')).toBe(names.indexOf('NearMiss') + 1);
  });

  // `SIM_EVENT_TYPES_ARE_COMPLETE` is the literal `true` by construction, so this assertion cannot
  // fail at runtime: the proof is that this file typechecks (`npm run typecheck`), and a `SimEvent`
  // missing from the list stops it from doing so. The import keeps the constant, and so the proof, alive.
  it('is proved complete at compile time, by typecheck', () => {
    expect(SIM_EVENT_TYPES_ARE_COMPLETE).toBe(true);
  });
});
