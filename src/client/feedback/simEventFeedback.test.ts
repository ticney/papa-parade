import { readdirSync, readFileSync } from 'node:fs';
import { parseContentFile } from '@content/parseContentFile';
import { type DisruptionDef, DisruptionDefSchema } from '@content/schemas/disruption';
import { type FeedbackTable, FeedbackTableSchema } from '@content/schemas/feedback';
import type { Level } from '@content/schemas/level';
import { type ThreatDef, ThreatDefSchema } from '@content/schemas/threat';
import type { Haptics } from '@platform/platform';
import { log } from '@shared/log';
import { asSimMs } from '@shared/time';
import type { SimEvent, World } from '@sim';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestResponseWindow } from '../../../tests/support/testContent.ts';
import { createFeedbackDirector } from './feedbackDirector.ts';
import { type FeedbackSource, playSimEventFeedback } from './simEventFeedback.ts';

// The latency AC of the epic (story 2.3, AC 10-11): « the sound plays at judgement, in the same loop
// tick », proved with the real director, the real `feedback.json`, the real defs and a recording
// audio. A cue id is read from the defs, never typed: Geo retunes the content freely.

beforeAll(() => {
  log.setLevel('error');
});
const warnSpy = vi.spyOn(log, 'warn');

const read = <T>(path: string, schema: Parameters<typeof parseContentFile<T>>[2]): T => {
  const result = parseContentFile(path, readFileSync(path, 'utf8'), schema);
  if (!result.ok) throw new Error(`${path}: ${JSON.stringify(result.error)}`);
  return result.value;
};

const root = new URL('../../../', import.meta.url).pathname;
const feedback: FeedbackTable = read(`${root}content/feedback.json`, FeedbackTableSchema);
const liveThreats: Record<string, ThreatDef> = {};
for (const file of readdirSync(`${root}content/threats`)) {
  if (!file.endsWith('.json')) continue;
  const def = read<ThreatDef>(`${root}content/threats/${file}`, ThreatDefSchema);
  liveThreats[def.id] = def;
}
const phone = read<DisruptionDef>(`${root}content/disruptions/phone.json`, DisruptionDefSchema);
const firm = read<ThreatDef>(`${root}tests/threats/fixtures/test_firm.json`, ThreatDefSchema);

const PHONE_OBJECT = 'phone';
const THREAT_ID = 4;

function setup() {
  const sounds: string[] = [];
  const pulses: string[] = [];
  const audio = {
    playOneShot: (clip: string, bus: string, gainPct: number) => {
      sounds.push(`${clip}@${bus}:${gainPct}`);
    },
  };
  const haptics: Haptics = { pulse: (kind) => void pulses.push(kind) } as Haptics;
  const director = createFeedbackDirector({
    table: feedback,
    audio,
    haptics,
    getScene: () => null,
    prefersReducedMotion: () => false,
  });
  return { sounds, pulses, director };
}

/** A world with one threat of `defId`; Papa is gliding to it when `isGliding`. */
function worldWith(defId: string, isGliding: boolean): World {
  return {
    time: { sim: asSimMs(1000) },
    papa: {
      state: isGliding ? 'glide' : 'idle',
      xM: 0,
      zM: 0,
      glide: isGliding
        ? {
            threatId: THREAT_ID,
            toXM: 1,
            toZM: 1,
            startedAt: asSimMs(990),
            arriveAt: asSimMs(1400),
            speedMps: 3,
          }
        : null,
    },
    baby: { xM: 2, zM: 2 },
    threats: [{ id: THREAT_ID, defId, xM: 1, zM: 1 }],
  } as unknown as World;
}

function sourceOf(world: World, threats: Record<string, ThreatDef> = liveThreats): FeedbackSource {
  return {
    sim: { world },
    level: {
      threats,
      disruptions: { phone },
      level: {
        waves: [{ disruptions: [{ def: 'phone', object: PHONE_OBJECT, atMs: 0 }] }],
      } as unknown as Level,
    },
  };
}

const resolved = (quality: 'success' | 'perfect' | 'fail'): SimEvent => ({
  type: 'ResponseResolved',
  t: asSimMs(1000),
  threatId: THREAT_ID,
  response: 'parry',
  quality,
  ...(quality === 'fail' ? { reason: 'late' as const } : {}),
  offsetMs: quality === 'fail' ? null : 0,
  responseWindow: createTestResponseWindow(),
});

const telegraphed = (): SimEvent => ({
  type: 'ThreatTelegraphed',
  t: asSimMs(1000),
  threatId: THREAT_ID,
  kind: 'test',
  anchorId: 'a',
  waveIndex: 0,
});

/** `clip@bus:gain` of the cue's `audio`, from the real table. */
const soundOf = (cueId: string): string => {
  const audio = feedback.cues[cueId]?.audio;
  if (audio === undefined) throw new Error(`cue ${cueId} has no audio`);
  return `${audio.clip}@${audio.bus}:${audio.gainPct}`;
};

describe('playSimEventFeedback: the sound fires at judgement (story 2.3)', () => {
  it('plays the parry squeak the moment a success is resolved, while Papa is still gliding, with no arrival', () => {
    const { sounds, director } = setup();
    const world = worldWith('outlet', true);
    expect(world.papa.state).toBe('glide');
    expect(world.papa.glide?.threatId).toBe(THREAT_ID);
    playSimEventFeedback(resolved('success'), sourceOf(world), director);
    // Before the function returned: no `PapaArrived`, no later frame.
    expect(sounds).toEqual([soundOf(liveThreats.outlet?.feedback.success as string)]);
    expect(sounds[0]).toMatch(/^resp_parry@sfx:/);
    expect(world.papa.state).toBe('glide');
  });

  it("plays the squeak then the baby's laugh, in that order and in that call, with one heavy haptic, on a perfect", () => {
    const { sounds, pulses, director } = setup();
    playSimEventFeedback(resolved('perfect'), sourceOf(worldWith('outlet', true)), director);
    expect(sounds).toHaveLength(2);
    expect(sounds[0]).toMatch(/^resp_parry@sfx:/);
    expect(sounds[1]).toMatch(/^baby_laugh_perfect@voice:/);
    expect(pulses).toEqual(['heavy']);
  });

  it('plays the laugh on a perfect of the micro-sleep and of the silence too', () => {
    for (const defId of ['papa_microsleep', 'silence_mischief']) {
      const { sounds, director } = setup();
      playSimEventFeedback(resolved('perfect'), sourceOf(worldWith(defId, false)), director);
      expect(
        sounds.map((sound) => sound.split('@')[0]),
        defId,
      ).toEqual(['resp_parry', 'baby_laugh_perfect']);
    }
  });

  it("plays nothing for a failed response, and the def's gag once for its GagTriggered", () => {
    const { sounds, pulses, director } = setup();
    const source = sourceOf(worldWith('outlet', false));
    playSimEventFeedback(resolved('fail'), source, director);
    expect(sounds).toEqual([]);
    expect(pulses).toEqual([]);
    playSimEventFeedback(
      {
        type: 'GagTriggered',
        t: asSimMs(1000),
        threatId: THREAT_ID,
        gag: 'outlet_hair',
        reason: 'late',
      },
      source,
      director,
    );
    expect(sounds).toEqual([soundOf(liveThreats.outlet?.feedback.gag as string)]);
    expect(sounds[0]).toMatch(/^gag_/);
  });

  it('plays its own tel_ clip for the telegraph of each live threat, all different', () => {
    const clips: string[] = [];
    for (const defId of Object.keys(liveThreats)) {
      const { sounds, director } = setup();
      playSimEventFeedback(telegraphed(), sourceOf(worldWith(defId, false)), director);
      expect(sounds, defId).toHaveLength(1);
      const [clip] = (sounds[0] as string).split('@');
      expect(clip, defId).toMatch(/^tel_/);
      clips.push(clip as string);
    }
    expect(clips.length).toBeGreaterThanOrEqual(5);
    expect(new Set(clips).size).toBe(clips.length);
  });

  it("plays the phone's own tel_phone_ring when it starts to ring, and a different clip from every threat's telegraph", () => {
    const { sounds, director } = setup();
    playSimEventFeedback(
      {
        type: 'PhoneRingStarted',
        t: asSimMs(1000),
        objectId: PHONE_OBJECT,
        untilAt: asSimMs(9000),
      },
      sourceOf(worldWith('outlet', false)),
      director,
    );
    expect(sounds).toEqual([soundOf(phone.feedback.ring)]);
    expect(sounds[0]).toMatch(/^tel_phone_ring@/);
  });

  it('plays the firm clack on a firm success, and the clack plus the laugh on a firm perfect', () => {
    const threats = { ...liveThreats, [firm.id]: firm };
    const success = setup();
    playSimEventFeedback(
      resolved('success'),
      sourceOf(worldWith(firm.id, true), threats),
      success.director,
    );
    expect(success.sounds.map((sound) => sound.split('@')[0])).toEqual(['resp_firm']);
    const perfect = setup();
    playSimEventFeedback(
      resolved('perfect'),
      sourceOf(worldWith(firm.id, true), threats),
      perfect.director,
    );
    expect(perfect.sounds.map((sound) => sound.split('@')[0])).toEqual([
      'resp_firm',
      'baby_laugh_perfect',
    ]);
  });

  it('plays only the events table outside a level, and does not warn', () => {
    const before = warnSpy.mock.calls.length;
    const { sounds, director } = setup();
    playSimEventFeedback(resolved('perfect'), null, director);
    expect(sounds).toEqual([]);
    expect(warnSpy.mock.calls.length).toBe(before);
  });
});
