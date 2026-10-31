import { asSimMs } from '@shared/time';
import { createSim, type SimEvent, type World } from '@sim';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  createTestBedtimeEyes,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  createTestOutlet,
  OUTLET,
  testWave,
} from '../../../tests/support/testContent.ts';
import { threatCueOf } from './threatFeedback.ts';

// The cue of a wait threat's signal (story 4.6): `WaitSignalGiven` plays the def's `feedback.signal`,
// so a sound, a wave and a vibration tell the player the baby's eyes have closed.
const eyes = createTestBedtimeEyes();
const outlet = createTestOutlet();
const defs = { [eyes.id]: eyes, [outlet.id]: outlet };
const world: World = (
  await createSim({
    content: createTestContent(),
    geometry: createTestGeometry(),
    level: createTestLevel({
      waves: [testWave([OUTLET])],
      carry: CARRY,
      sequences: ['bedtime_duel'],
    }),
    seed: 1,
  })
).world;
const idOf = (defId: string) => world.threats.find((threat) => threat.defId === defId)?.id ?? -1;
const signal = (id: number): SimEvent => ({
  type: 'WaitSignalGiven',
  t: asSimMs(1000),
  threatId: id,
});

describe('threatCueOf and the signal of a wait (story 4.6)', () => {
  it('maps the signal to the def’s signal cue', () => {
    expect(threatCueOf(signal(idOf(eyes.id)), world, defs)).toBe(eyes.feedback.signal);
    expect(eyes.feedback.signal).toBeDefined();
  });

  it('plays nothing for a signal of a def that has no signal cue', () => {
    expect(threatCueOf(signal(idOf(outlet.id)), world, defs)).toBeNull();
  });

  it('plays nothing for a signal of a threat the world does not know', () => {
    expect(threatCueOf(signal(9999), world, defs)).toBeNull();
  });

  it('keeps the telegraph, success, perfect and gag of the eyes on their own cues', () => {
    const id = idOf(eyes.id);
    const telegraphed: SimEvent = {
      type: 'ThreatTelegraphed',
      t: asSimMs(0),
      threatId: id,
      kind: eyes.id,
      anchorId: '',
      waveIndex: -1,
    };
    expect(threatCueOf(telegraphed, world, defs)).toBe(eyes.feedback.telegraph);
    expect(
      threatCueOf(
        {
          type: 'GagTriggered',
          t: asSimMs(0),
          threatId: id,
          gag: 'baby_eyes_reopened',
          reason: 'early',
        },
        world,
        defs,
      ),
    ).toBe(eyes.feedback.gag);
  });
});
