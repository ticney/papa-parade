import type { DisruptionDef } from '@content/schemas/disruption';
import { asSimMs } from '@shared/time';
import type { SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import {
  createTestLevel,
  createTestPhone,
  TEST_OBJECTS,
  testPhoneEntry,
  testWave,
} from '../../../tests/support/testContent.ts';
import { disruptionCueOf } from './disruptionFeedback.ts';

const phone = createTestPhone();
const planned = createTestLevel({
  waves: [testWave([]), testWave([], { fromMs: 60_000, disruptions: [testPhoneEntry(61_000)] })],
  objects: TEST_OBJECTS,
});
const defs: Readonly<Record<string, DisruptionDef>> = planned.disruptions;

const started: SimEvent = {
  type: 'PhoneRingStarted',
  t: asSimMs(61_000),
  objectId: 'phone',
  untilAt: asSimMs(76_000),
};
const ringing: SimEvent = { type: 'PhoneRinging', t: asSimMs(62_000), objectId: 'phone' };
const answered: SimEvent = {
  type: 'PhoneAnswered',
  t: asSimMs(63_000),
  objectId: 'phone',
  untilAt: asSimMs(68_000),
  fatigue: 50,
};
const ended: SimEvent = {
  type: 'PhoneRingEnded',
  t: asSimMs(76_000),
  objectId: 'phone',
  reason: 'timedOut',
};

describe('disruptionCueOf', () => {
  it('plays the def ring cue for the start of the ring and for each second it goes on', () => {
    expect(disruptionCueOf(started, planned.level, defs)).toBe(phone.feedback.ring);
    expect(disruptionCueOf(ringing, planned.level, defs)).toBe(phone.feedback.ring);
  });

  it('plays the def answer cue when Papa picks up', () => {
    expect(disruptionCueOf(answered, planned.level, defs)).toBe(phone.feedback.answer);
  });

  it('plays nothing for the end of the ring (the sound has stopped by itself), nor for other events', () => {
    expect(disruptionCueOf(ended, planned.level, defs)).toBeNull();
    expect(
      disruptionCueOf({ type: 'PapaArrived', t: asSimMs(0), xM: 0, zM: 0 }, planned.level, defs),
    ).toBeNull();
    expect(
      disruptionCueOf({ type: 'ThreatRearmed', t: asSimMs(0), threatId: 1 }, planned.level, defs),
    ).toBeNull();
  });

  it('takes the cues from the def, so another def brings its own sounds with no other change', () => {
    const dog: DisruptionDef = {
      ...phone,
      feedback: { ring: 'tel_dog_bark', answer: 'papa_dog_pet' },
    };
    expect(disruptionCueOf(started, planned.level, { phone: dog })).toBe('tel_dog_bark');
    expect(disruptionCueOf(answered, planned.level, { phone: dog })).toBe('papa_dog_pet');
  });

  it('plays nothing for an object no wave rings at, or a def that is not loaded', () => {
    expect(
      disruptionCueOf({ ...ringing, objectId: 'coffee_machine' } as SimEvent, planned.level, defs),
    ).toBeNull();
    expect(disruptionCueOf(ringing, planned.level, {})).toBeNull();
    // `constructor` is no def: `hasOwn`, not `in`.
    expect(
      disruptionCueOf(
        ringing,
        {
          waves: [
            testWave([], { disruptions: [{ def: 'constructor', object: 'phone', atMs: 0 }] }),
          ],
        },
        {},
      ),
    ).toBeNull();
  });
});
