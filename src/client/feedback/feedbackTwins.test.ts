import { readdirSync, readFileSync } from 'node:fs';
import { parseContentFile } from '@content/parseContentFile';
import { type DisruptionDef, DisruptionDefSchema } from '@content/schemas/disruption';
import { type FeedbackTable, FeedbackTableSchema } from '@content/schemas/feedback';
import { type ThreatDef, ThreatDefSchema } from '@content/schemas/threat';
import type { Haptics } from '@platform/platform';
import { log } from '@shared/log';
import { asSimMs } from '@shared/time';
import type { SimObjectSpec, World } from '@sim';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { LevelFx } from '../render/levelScene.ts';
import { createFeedbackDirector } from './feedbackDirector.ts';

// Pillar 3 (story 2.4, AC 2-3), proved through the real director and the live `feedback.json`: every
// cue that has a sound draws something to see and vibrates its kind, and each telegraph's waves
// start from the source of its sound. A cue added later is covered with no change here, and no
// tunable value is typed: radii, pulses and kinds are read from the table.

beforeAll(() => {
  log.setLevel('error');
});
const warnSpy = vi.spyOn(log, 'warn');

const root = new URL('../../../', import.meta.url).pathname;
const read = <T>(path: string, schema: Parameters<typeof parseContentFile<T>>[2]): T => {
  const result = parseContentFile(path, readFileSync(path, 'utf8'), schema);
  if (!result.ok) throw new Error(`${path}: ${JSON.stringify(result.error)}`);
  return result.value;
};

const feedback: FeedbackTable = read(`${root}content/feedback.json`, FeedbackTableSchema);
const threats: ThreatDef[] = readdirSync(`${root}content/threats`)
  .filter((file) => file.endsWith('.json'))
  .map((file) => read<ThreatDef>(`${root}content/threats/${file}`, ThreatDefSchema));
const disruptions: DisruptionDef[] = readdirSync(`${root}content/disruptions`)
  .filter((file) => file.endsWith('.json'))
  .map((file) => read<DisruptionDef>(`${root}content/disruptions/${file}`, DisruptionDefSchema));
const levelObjects: { id: string; kind: SimObjectSpec['kind'] }[] = JSON.parse(
  readFileSync(`${root}content/levels/salon_crawler.json`, 'utf8'),
).objects;

const NOW_MS = 1000;
const THREAT_ID = 4;
const THREAT_AT = { xM: 1.5, zM: -0.5 };
const PAPA_AT = { xM: -2, zM: 0.25 };
/** The level's objects, each at a place of its own. */
const OBJECTS: readonly SimObjectSpec[] = levelObjects.map((object, index) => ({
  id: object.id,
  kind: object.kind,
  xM: 3 + index,
  zM: -0.75 - index,
  yM: 0.8,
}));
const world = {
  time: { sim: asSimMs(NOW_MS) },
  papa: PAPA_AT,
  baby: { xM: 2, zM: 2 },
  threats: [{ id: THREAT_ID, ...THREAT_AT }],
} as unknown as World;

interface Ring {
  xM: number;
  zM: number;
  maxRadiusM: number;
  durationMs: number;
  startAt: number;
}

/** Plays `cueId` through the real director with recording fakes. */
function play(cueId: string, objectId: string | null = null) {
  const rings: Ring[] = [];
  const flashes: { peakOpacityPct: number; durationMs: number }[] = [];
  const visuals: string[] = [];
  const pulses: string[] = [];
  const cues: string[] = [];
  const fx: LevelFx = {
    soundWave: (xM, zM, maxRadiusM, durationMs, startAt) =>
      void rings.push({ xM, zM, maxRadiusM, durationMs, startAt }),
    shake: () => {},
    gag: () => {},
    liftBaby: () => {},
  };
  const director = createFeedbackDirector({
    table: feedback,
    audio: { playOneShot: () => {} },
    haptics: { pulse: (kind) => void pulses.push(kind) } as Haptics,
    getObjects: () => OBJECTS,
    getScene: () => fx,
    prefersReducedMotion: () => false,
    flash: (peakOpacityPct, durationMs) => {
      flashes.push({ peakOpacityPct, durationMs });
      return true;
    },
    onVisual: (_id, kind) => void visuals.push(kind),
    onCue: (id) => void cues.push(id),
  });
  const warnings = warnSpy.mock.calls.length;
  director.playCue(cueId, world, THREAT_ID, objectId);
  return {
    rings,
    flashes,
    visuals,
    pulses,
    cues,
    newWarnings: warnSpy.mock.calls.slice(warnings).map(([, message]) => message),
  };
}

const phoneObjectId = (): string => {
  const object = levelObjects.find((candidate) => candidate.kind === 'phone');
  if (object === undefined) throw new Error('the level has no phone');
  return object.id;
};

const audioCues = Object.entries(feedback.cues).filter(([, cue]) => cue.audio !== undefined);

describe('every cue with a sound has a visual and a haptic twin (story 2.4, AC 2)', () => {
  it('examines the cues of the table', () => {
    expect(audioCues.length).toBeGreaterThan(0);
  });

  it.each(audioCues)('%s draws something and vibrates its kind, once', (cueId, cue) => {
    const played = play(cueId, cue.visual?.kind === 'soundWave' ? phoneObjectId() : null);
    // A ring or a flash was drawn here; a `uiElement` is drawn by the HUD, the director only reports
    // it, so it counts only when the cue declares one.
    const hasUiElement = cue.visual?.kind === 'uiElement' && played.visuals.includes('uiElement');
    const drawnCount = played.rings.length + played.flashes.length + (hasUiElement ? 1 : 0);
    expect(drawnCount, `${cueId} drew nothing`).toBeGreaterThan(0);
    // What was drawn is what was reported, once per part.
    expect(played.visuals.filter((kind) => kind === 'soundWave')).toHaveLength(
      played.rings.length > 0 ? 1 : 0,
    );
    expect(cue.haptic, `${cueId} has an audio but no haptic`).toBeDefined();
    expect(played.pulses).toEqual([cue.haptic]);
    expect(played.cues).toEqual([cueId]);
    expect(played.newWarnings).toEqual([]);
  });
});

describe('a telegraph sends waves from the source of its sound (story 2.4, AC 3)', () => {
  const telegraphs = [
    ...threats.map((def) => ({ what: `threat ${def.id}`, cueId: def.feedback.telegraph })),
    ...disruptions.map((def) => ({ what: `disruption ${def.id}`, cueId: def.feedback.ring })),
  ];

  it('examines every telegraph of the content', () => {
    expect(telegraphs.length).toBeGreaterThanOrEqual(5);
  });

  it.each(telegraphs)(
    '$what ($cueId): light vibration, rings at its anchor, on the sim clock',
    ({ cueId }) => {
      const cue = feedback.cues[cueId];
      const wave = cue?.visual?.kind === 'soundWave' ? cue.visual : undefined;
      if (wave === undefined) throw new Error(`${cueId} has no sound wave`);
      expect(wave.anchor === 'threat' || wave.anchor === 'object').toBe(true);
      const played = play(cueId, phoneObjectId());
      expect(played.pulses).toEqual(['light']);
      const source =
        wave.anchor === 'object'
          ? OBJECTS.find((object) => object.id === phoneObjectId())
          : THREAT_AT;
      expect(source).toBeDefined();
      const count = wave.pulses ?? 1;
      expect(played.rings).toHaveLength(count);
      played.rings.forEach((ring, pulse) => {
        expect(ring.xM).toBe(source?.xM);
        expect(ring.zM).toBe(source?.zM);
        expect([ring.xM, ring.zM]).not.toEqual([PAPA_AT.xM, PAPA_AT.zM]);
        expect(ring.maxRadiusM).toBe(wave.maxRadiusM);
        expect(ring.durationMs).toBe(wave.durationMs);
        expect(ring.startAt).toBe(NOW_MS + pulse * (wave.pulseIntervalMs ?? 0));
      });
    },
  );

  it('tells the telegraphs apart by their waves: no two share pulses, size and duration', () => {
    const signatures = new Map<string, string>();
    for (const { cueId } of telegraphs) {
      const wave = feedback.cues[cueId]?.visual;
      if (wave?.kind !== 'soundWave') continue;
      const signature = [
        wave.pulses ?? 1,
        wave.maxRadiusM,
        wave.durationMs,
        wave.pulseIntervalMs ?? 0,
      ].join('/');
      expect(
        signatures.get(signature),
        `${cueId} sends the waves of ${signatures.get(signature)}`,
      ).toBeUndefined();
      signatures.set(signature, cueId);
    }
    expect(signatures.size).toBeGreaterThanOrEqual(5);
  });
});

describe('a perfect flashes the screen and keeps its ring (story 2.4, AC 6)', () => {
  const perfects = threats.map((def) => ({ what: def.id, cueId: def.feedback.perfect }));

  it.each(perfects)('$what ($cueId): flash, ring and heavy vibration', ({ cueId }) => {
    const cue = feedback.cues[cueId];
    const played = play(cueId);
    expect(cue?.flash).toBeDefined();
    expect(played.flashes).toEqual([cue?.flash]);
    expect(played.rings).toHaveLength(1);
    expect(played.pulses).toEqual(['heavy']);
    expect(played.visuals).toEqual(['soundWave', 'flash']);
  });
});
