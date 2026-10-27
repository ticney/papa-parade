import { describe, expect, it } from 'vitest';
import { SIM_EVENT_TYPES, SIM_EVENT_TYPES_ARE_COMPLETE } from './events.ts';

// The list is kept in the order of the `SimEvent` union (a convention the compiler cannot check);
// what is checked here is that it has no duplicate and that every name follows the event naming.
describe('SIM_EVENT_TYPES', () => {
  it('lists each event once', () => {
    expect(new Set(SIM_EVENT_TYPES).size).toBe(SIM_EVENT_TYPES.length);
  });

  it('names events in PascalCase', () => {
    for (const name of SIM_EVENT_TYPES) expect(name).toMatch(/^[A-Z][a-z]+(?:[A-Z][a-z]+)*$/);
  });

  it('is proved complete at compile time', () => {
    expect(SIM_EVENT_TYPES_ARE_COMPLETE).toBe(true);
  });
});
