import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import { createTestContent, stepN } from '../../tests/support/testContent.ts';
import { createSim } from './createSim.ts';
import type { SimEvent } from './events.ts';
import type { Journal, JournalEntry } from './journal.ts';
import { replayJournal } from './replay.ts';

const content = createTestContent();
const scale = (t: number, value: number) =>
  ({ type: 'SetTimeScale', t: asSimMs(t), scale: value }) as const;

async function liveGame() {
  const sim = await createSim({ content, seed: 11 });
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

    const replay = await replayJournal({ content, journal, untilSimMs: 3000 });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(hashJson(replay.value.sim.world)).toBe(hashJson(live.sim.world));
    expect(replay.value.events).toEqual(live.events);
    expect(replay.value.sim.journal()).toEqual(journal);
  });

  it('would diverge if the late command were replayed by t instead of applyAt', async () => {
    const live = await liveGame();
    const journal = live.sim.journal();
    const naive = await createSim({ content, seed: 11 });
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
    const replay = await replayJournal({ content, journal: live.sim.journal(), untilSimMs: 15 });
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
      const result = await replayJournal({ content, journal: value as Journal, untilSimMs: 100 });
      expect(result).toMatchObject({ ok: false, error: { kind: 'journal' } });
      expect(!result.ok && result.error.message).toContain(needle);
    }
    for (const untilSimMs of [Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(await replayJournal({ content, journal, untilSimMs })).toMatchObject({
        ok: false,
        error: { kind: 'journal' },
      });
    }
  });

  it('refuses a journal that does not start at 0 (a restored sim)', async () => {
    const sim = await createSim({ content, seed: 11 });
    stepN(sim, 5);
    sim.restore(sim.snapshot());
    const result = await replayJournal({ content, journal: sim.journal(), untilSimMs: 100 });
    expect(result).toMatchObject({ ok: false, error: { kind: 'journal' } });
    expect(!result.ok && result.error.message).toContain('starts at 50');
  });

  it('stops at untilSimMs', async () => {
    const live = await liveGame();
    const replay = await replayJournal({ content, journal: live.sim.journal(), untilSimMs: 1000 });
    expect(replay.ok && replay.value.sim.world.time.sim).toBe(1000);
  });

  it('returns an error for a different feel or an unknown version, without throwing', async () => {
    const journal = (await liveGame()).sim.journal();
    const otherFeel = {
      ...content,
      feel: { ...content.feel, movement: { glideMaxMs: content.feel.movement.glideMaxMs + 1 } },
    };
    const feelResult = await replayJournal({ content: otherFeel, journal, untilSimMs: 100 });
    expect(feelResult).toMatchObject({ ok: false, error: { kind: 'journal' } });

    const versionResult = await replayJournal({
      content,
      journal: { ...journal, version: 2 as 1 },
      untilSimMs: 100,
    });
    expect(versionResult).toMatchObject({ ok: false, error: { kind: 'journal' } });
  });
});
