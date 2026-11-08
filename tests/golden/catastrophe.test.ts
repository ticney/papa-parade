import { hashJson } from '@shared/hash';
import { replayJournal } from '@sim';
import { describe, expect, it } from 'vitest';
import { createTestContent, createTestGeometry } from '../support/testContent.ts';
import { recordScenario, SCENARIOS } from './scenarios.ts';

/**
 * The golden compares hashes, which say nothing about what a scenario exercises. This pins that
 * `catastrophe_mama_home` really is the early end it is there for (a cascade of near misses fills the
 * gauge, Mama comes home, 0 stars, a frozen world) and that `catastrophe_rush_frozen` really freezes
 * the gauge in the final rush (gags and a command move nothing).
 */
const content = createTestContent();
const geometry = createTestGeometry();

function scenarioNamed(name: string) {
  const scenario = SCENARIOS.find((candidate) => candidate.name === name);
  if (scenario === undefined) throw new Error(`missing scenario ${name}`);
  return scenario;
}

const homeScenario = scenarioNamed('catastrophe_mama_home');
const home = await recordScenario(content, geometry, homeScenario);
const rushScenario = scenarioNamed('catastrophe_rush_frozen');
const rush = await recordScenario(content, geometry, rushScenario);

describe('golden scenario catastrophe_mama_home covers the early end it is there for', () => {
  const rises = home.events.filter((event) => event.type === 'CatastropheChanged');
  const ended = home.events.filter((event) => event.type === 'LevelEnded');

  it('fills the gauge with near misses alone, each worth the feel’s row, the last one up to 100', () => {
    expect(rises.length).toBeGreaterThanOrEqual(3);
    for (const rise of rises) expect(rise.source).toBe('nearMiss');
    for (const rise of rises.slice(0, -1)) {
      expect(rise.deltaPct).toBeCloseTo(content.feel.catastrophe.risePct.nearMiss, 9);
    }
    expect(rises.at(-1)?.catastrophePct).toBe(100);
  });

  it('ends the level in that very step: LevelEnded{mamaHome} then LevelScored, no MamaWoke, no rush', () => {
    expect(ended).toHaveLength(1);
    const endAt = ended[0]?.t ?? Number.NaN;
    expect(ended[0]).toEqual({ type: 'LevelEnded', t: endAt, reason: 'mamaHome' });
    expect(rises.at(-1)?.t).toBe(endAt);
    expect(endAt).toBeLessThan(homeScenario.level.level.durationMs);
    expect(home.events.some((event) => event.type === 'MamaWoke')).toBe(false);
    expect(home.events.some((event) => event.type === 'FinalRushStarted')).toBe(false);
    const ending = home.events.filter((event) => event.t === endAt).map((event) => event.type);
    expect(ending.indexOf('LevelEnded')).toBe(ending.indexOf('LevelScored') - 1);
  });

  it('scores 0 stars and takes none off, whatever the points', () => {
    const scored = home.events.find((event) => event.type === 'LevelScored');
    expect(scored?.type).toBe('LevelScored');
    if (scored?.type !== 'LevelScored') return;
    expect(scored.stars).toBe(0);
    expect(scored.lostStars).toBe(0);
    expect(scored.scorePoints).toBeGreaterThan(0);
  });

  it('emits nothing after the end: the world is frozen', () => {
    expect(home.events.at(-1)?.type).toBe('LevelScored');
  });

  it('replays to exactly the same world, bit for bit', async () => {
    const replay = await replayJournal({
      content,
      geometry,
      level: homeScenario.level,
      journal: home.journal,
      untilSimMs: homeScenario.untilSimMs,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(hashJson(replay.value.sim.world)).toBe(home.worldHash);
    expect(replay.value.sim.world.flow.endReason).toBe('mamaHome');
    expect(replay.value.events).toEqual(home.events);
    replay.value.sim.dispose();
  });
});

describe('golden scenario catastrophe_rush_frozen covers the freeze it is there for', () => {
  const rushStart = rush.events.find((event) => event.type === 'FinalRushStarted');

  it('sets the gauge to 60 % before the rush, by the debug command', () => {
    const rises = rush.events.filter((event) => event.type === 'CatastropheChanged');
    expect(rises).toHaveLength(1);
    expect(rises[0]).toMatchObject({ source: 'debug', catastrophePct: 60 });
    expect(rises[0]?.t).toBeLessThan(rushStart?.t ?? Number.NaN);
  });

  it('fails gags inside the rush and moves nothing: no CatastropheChanged after FinalRushStarted', () => {
    const startAt = rushStart?.t ?? Number.NaN;
    const after = rush.events.filter((event) => event.t >= startAt);
    expect(after.filter((event) => event.type === 'GagTriggered').length).toBeGreaterThanOrEqual(2);
    expect(after.filter((event) => event.type === 'CatastropheChanged')).toEqual([]);
  });

  it('ignores a SetCatastrophe of 100 inside the rush: the level ends on the timer, on the photo', () => {
    const ended = rush.events.filter((event) => event.type === 'LevelEnded');
    expect(ended).toEqual([
      { type: 'LevelEnded', t: rushScenario.level.level.durationMs, reason: 'timer' },
    ]);
    const sent = rush.journal.entries.find(
      (entry) => entry.command.type === 'SetCatastrophe' && entry.command.pct === 100,
    );
    expect(sent).toBeDefined();
  });

  it('replays to exactly the same world, bit for bit', async () => {
    const replay = await replayJournal({
      content,
      geometry: rushScenario.geometry ?? geometry,
      level: rushScenario.level,
      journal: rush.journal,
      untilSimMs: rushScenario.untilSimMs,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(hashJson(replay.value.sim.world)).toBe(rush.worldHash);
    // 60 % less the half second of decay before the rush: nothing moved it afterwards.
    const frozenPct = replay.value.sim.world.gauges.catastrophePct;
    expect(frozenPct).toBeGreaterThan(59);
    expect(frozenPct).toBeLessThan(60);
    expect(replay.value.sim.world.flow.state).toBe('photo');
    replay.value.sim.dispose();
  });
});
