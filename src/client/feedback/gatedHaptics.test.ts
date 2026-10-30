import type { HapticKind, Haptics } from '@platform/platform';
import { describe, expect, it } from 'vitest';
import { createGatedHaptics } from './gatedHaptics.ts';

function spy() {
  const pulses: HapticKind[] = [];
  const haptics: Haptics = { pulse: (kind) => pulses.push(kind) };
  return { haptics, pulses };
}

describe('createGatedHaptics (story 2.8)', () => {
  it('passes a pulse through while the setting is on', () => {
    const { haptics, pulses } = spy();
    createGatedHaptics(haptics, () => true).pulse('heavy');
    expect(pulses).toEqual(['heavy']);
  });

  it('drops a pulse while the setting is off', () => {
    const { haptics, pulses } = spy();
    createGatedHaptics(haptics, () => false).pulse('light');
    expect(pulses).toEqual([]);
  });

  it('reads the setting at each pulse, so a switch applies to the next one', () => {
    const { haptics, pulses } = spy();
    let isOn = true;
    const gated = createGatedHaptics(haptics, () => isOn);
    gated.pulse('light');
    isOn = false;
    gated.pulse('medium');
    isOn = true;
    gated.pulse('heavy');
    expect(pulses).toEqual(['light', 'heavy']);
  });
});
