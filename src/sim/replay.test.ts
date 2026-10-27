import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  outletEntry,
  stepN,
} from '../../tests/support/testContent.ts';
import { createSim } from './createSim.ts';
import type { SimEvent } from './events.ts';
import type { Journal, JournalEntry } from './journal.ts';
import { replayJournal } from './replay.ts';

const content = createTestContent();
const geometry = createTestGeometry();
const level = createTestLevel();
const scale = (t: number, value: number) =>
  ({ type: 'SetTimeScale', t: asSimMs(t), scale: value }) as const;

async function liveGame() {
  const sim = await createSim({ content, geometry, level, seed: 11 });
  const events: SimEvent[] = [];
  const drain = () => {
    for (const event of sim.drainEvents()) events.push(event);
  };
  sim.enqueue(scale(300, 0.4));
  stepN(sim, 50);
  sim.enqueue(scale(480, 0.6)); // late: older than the sim time (500)
  sim.enqueue(scale(2000, 0.9)); // future
  stepN(sim, 250);
  drain();
  return { sim, events };
}

describe('replayJournal', () => {
  it('reproduces a live game, including a late command', async () => {
    const live = await liveGame();
    const journal = live.sim.journal();
    expect(journal.entries.find((e) => e.command.t === 480)?.applyAt).toBe(510);

    const replay = await replayJournal({ content, geometry, level, journal, untilSimMs: 3000 });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(hashJson(replay.value.sim.world)).toBe(hashJson(live.sim.world));
    expect(replay.value.events).toEqual(live.events);
    expect(replay.value.sim.journal()).toEqual(journal);
  });

  it('rethrows a strict invariant violation of the replay, so the caller sees it (the sim is freed first)', async () => {
    // Recorded without strict mode, where a push over the bound is clamped and reported.
    const sim = await createSim({ content, geometry, level, seed: 11, strictInvariants: false });
    sim.enqueue({
      type: 'PushProp',
      t: asSimMs(100),
      propId: 'mug_01',
      impulseXNs: content.feel.physics.maxPushImpulseNs * 4,
      impulseYNs: 0,
      impulseZNs: 0,
    });
    stepN(sim, 30);
    const journal = sim.journal();
    sim.dispose();
    await expect(
      replayJournal({
        content,
        geometry,
        level,
        journal,
        untilSimMs: 1000,
        strictInvariants: true,
      }),
    ).rejects.toThrow('prop.pushImpulseNs');
  });

  it('would diverge if the late command were replayed by t instead of applyAt', async () => {
    const live = await liveGame();
    const journal = live.sim.journal();
    const naive = await createSim({ content, geometry, level, seed: 11 });
    for (const entry of journal.entries) naive.enqueue(entry.command);
    const naiveEvents: SimEvent[] = [];
    for (let i = 0; i < 300; i++) {
      naive.step();
      for (const event of naive.drainEvents()) naiveEvents.push(event);
    }
    expect(naiveEvents).not.toEqual(live.events);
  });

  it('rounds an untilSimMs that is not a multiple of the step up to the next step', async () => {
    const live = await liveGame();
    const replay = await replayJournal({
      level,
      content,
      geometry,
      journal: live.sim.journal(),
      untilSimMs: 15,
    });
    expect(replay.ok && replay.value.sim.world.time.sim).toBe(20);
  });

  it('returns an error, never throws, for a malformed journal or a bad untilSimMs', async () => {
    const journal = (await liveGame()).sim.journal();
    const first = journal.entries[0] as JournalEntry;
    const bad: [string, unknown][] = [
      ['seed', { ...journal, seed: 1.5 }],
      ['seed', { ...journal, seed: -1 }],
      ['entries', { ...journal, entries: undefined }],
      ['applyAt', { ...journal, entries: [{ ...first, applyAt: null }] }],
      ['step grid', { ...journal, entries: [{ ...first, applyAt: 505 }] }],
      ['command', { ...journal, entries: [{ applyAt: 10, command: { type: 'Nope', t: 1 } }] }],
      [
        't must',
        { ...journal, entries: [{ applyAt: 10, command: { type: 'SetTimeScale', scale: 1 } }] },
      ],
      ['startSimMs', { ...journal, startSimMs: undefined }],
      ['journal must', null],
    ];
    for (const [needle, value] of bad) {
      const result = await replayJournal({
        level,
        content,
        geometry,
        journal: value as Journal,
        untilSimMs: 100,
      });
      expect(result).toMatchObject({ ok: false, error: { kind: 'journal' } });
      expect(!result.ok && result.error.message).toContain(needle);
    }
    for (const untilSimMs of [Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(await replayJournal({ content, geometry, level, journal, untilSimMs })).toMatchObject({
        ok: false,
        error: { kind: 'journal' },
      });
    }
  });

  it('refuses a journal that does not start at 0 (a restored sim)', async () => {
    const sim = await createSim({ content, geometry, level, seed: 11 });
    stepN(sim, 5);
    sim.restore(sim.snapshot());
    const result = await replayJournal({
      level,
      content,
      geometry,
      journal: sim.journal(),
      untilSimMs: 100,
    });
    expect(result).toMatchObject({ ok: false, error: { kind: 'journal' } });
    expect(!result.ok && result.error.message).toContain('starts at 50');
  });

  it('stops at untilSimMs', async () => {
    const live = await liveGame();
    const replay = await replayJournal({
      level,
      content,
      geometry,
      journal: live.sim.journal(),
      untilSimMs: 1000,
    });
    expect(replay.ok && replay.value.sim.world.time.sim).toBe(1000);
  });

  it('returns an error for a different feel or an unknown version, without throwing', async () => {
    const journal = (await liveGame()).sim.journal();
    const otherFeel = {
      ...content,
      feel: {
        ...content.feel,
        movement: { ...content.feel.movement, glideMaxMs: content.feel.movement.glideMaxMs + 1 },
      },
    };
    const feelResult = await replayJournal({
      level,
      content: otherFeel,
      geometry,
      journal,
      untilSimMs: 100,
    });
    expect(feelResult).toMatchObject({ ok: false, error: { kind: 'journal' } });

    const versionResult = await replayJournal({
      level,
      content,
      geometry,
      journal: { ...journal, version: 1 as 3 },
      untilSimMs: 100,
    });
    expect(versionResult).toMatchObject({
      ok: false,
      error: { kind: 'journal', message: expect.stringContaining('version 1') },
    });
  });

  it('returns an error, not a rejection, when the sim refuses the level', async () => {
    const journal = (await liveGame()).sim.journal();
    const noSpawn = {
      ...geometry,
      anchors: geometry.anchors.filter((anchor) => anchor.id !== 'papa_spawn'),
    };
    const forged = { ...journal, geometryHash: hashJson(noSpawn) };
    const result = await replayJournal({
      level,
      content,
      geometry: noSpawn,
      journal: forged,
      untilSimMs: 100,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'journal', message: expect.stringContaining('papa_spawn') },
    });
  });

  it('returns an error, not a rejection, when the level has no baby_spawn', async () => {
    const journal = (await liveGame()).sim.journal();
    const noBaby = {
      ...geometry,
      anchors: geometry.anchors.filter((anchor) => anchor.id !== 'baby_spawn'),
    };
    const forged = { ...journal, geometryHash: hashJson(noBaby) };
    const result = await replayJournal({
      level,
      content,
      geometry: noBaby,
      journal: forged,
      untilSimMs: 100,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'journal', message: expect.stringContaining('baby_spawn') },
    });
  });

  it('returns an error, not a rejection, when no open cell is left for the baby', async () => {
    // A 5 × 5 block of walkable cells: Papa (one cell of clearance) still has cells, the baby
    // (a 1 m radius is four cells) has none.
    const rows = geometry.nav.rows.map((row, index) =>
      index < 5 ? `11111${'0'.repeat(row.length - 5)}` : '0'.repeat(row.length),
    );
    const tight = { ...geometry, nav: { ...geometry.nav, rows } };
    const fat = {
      ...content,
      feel: { ...content.feel, baby: { ...content.feel.baby, bodyRadiusM: 1 } },
    };
    const journal = (await liveGame()).sim.journal();
    const forged = { ...journal, feelHash: hashJson(fat.feel), geometryHash: hashJson(tight) };
    const result = await replayJournal({
      level,
      content: fat,
      geometry: tight,
      journal: forged,
      untilSimMs: 100,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'journal', message: expect.stringContaining('where the baby can stand') },
    });
  });

  it('returns an error for another level geometry, naming it, without throwing', async () => {
    const journal = (await liveGame()).sim.journal();
    const other = { ...geometry, id: 'other_room' };
    const result = await replayJournal({
      content,
      level,
      geometry: other,
      journal,
      untilSimMs: 100,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'journal', message: expect.stringContaining('other_room') },
    });
  });

  it('returns an error for another level, naming it, without throwing', async () => {
    const journal = (await liveGame()).sim.journal();
    const planning = createTestLevel([outletEntry(0)]);
    const result = await replayJournal({
      content,
      geometry,
      level: planning,
      journal,
      untilSimMs: 100,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'journal', message: expect.stringContaining('another level') },
    });
    expect(!result.ok && result.error.message).toContain('salon_crawler');
  });

  it('says that a version 2 journal was recorded before the sim read the level', async () => {
    const journal = (await liveGame()).sim.journal();
    const result = await replayJournal({
      content,
      geometry,
      level,
      journal: { ...journal, version: 2 as 3 },
      untilSimMs: 100,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'journal', message: expect.stringMatching(/version 2.*story 1\.10/) },
    });
  });

  it('reproduces a game with threats, a pressed outlet included', async () => {
    const planning = createTestLevel([outletEntry(0)]);
    const sim = await createSim({ content, geometry, level: planning, seed: 3 });
    sim.enqueue({ type: 'PressThreat', t: asSimMs(1360), threatId: 1 });
    sim.enqueue({ type: 'Release', t: asSimMs(1390) });
    const live: SimEvent[] = [];
    stepN(sim, 800);
    for (const event of sim.drainEvents()) live.push(event);
    expect(live.map((event) => event.type)).toContain('ResponseResolved');
    const replay = await replayJournal({
      content,
      geometry,
      level: planning,
      journal: sim.journal(),
      untilSimMs: 8000,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.events).toEqual(live);
    expect(hashJson(replay.value.sim.world)).toBe(hashJson(sim.world));
  });
});
