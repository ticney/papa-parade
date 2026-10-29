import { STEP_MS } from '@shared/constants';
import { hashJson } from '@shared/hash';
import { replayJournal } from '@sim';
import { describe, expect, it } from 'vitest';
import { createTestContent, createTestGeometry } from '../support/testContent.ts';
import { recordScenario, SCENARIOS } from './scenarios.ts';

/**
 * The golden compares hashes, which say nothing about what a scenario exercises. This pins that
 * `mama_woke` really is the early end it is there for: the noise commanded to 100 % ends the level
 * well before its timer, Mama's note loses a star, and the world is frozen from then on.
 */
const scenario = SCENARIOS.find((candidate) => candidate.name === 'mama_woke');
if (scenario === undefined) throw new Error('missing scenario mama_woke');
const content = createTestContent();
const geometry = createTestGeometry();
const { events, journal, worldHash } = await recordScenario(content, geometry, scenario);

const COMMAND_AT_MS = 1000;

describe('golden scenario mama_woke covers the early end it is there for', () => {
  it('ends the level the step after the command: MamaWoke, LevelEnded{mamaWoke}, LevelScored, one t', () => {
    const endAt = COMMAND_AT_MS + STEP_MS;
    const ending = events.filter((event) => event.t === endAt).map((event) => event.type);
    expect(ending).toEqual(['NoiseChanged', 'MamaWoke', 'LevelEnded', 'LevelScored']);
    expect(events.filter((event) => event.type === 'LevelEnded')).toEqual([
      { type: 'LevelEnded', t: endAt, reason: 'mamaWoke' },
    ]);
    expect(endAt).toBeLessThan(scenario.level.level.durationMs);
  });

  it('takes the penalty off the base stars: lostStars 1, and a base note with a star to lose', () => {
    const scored = events.find((event) => event.type === 'LevelScored');
    expect(scored?.type).toBe('LevelScored');
    if (scored?.type !== 'LevelScored') return;
    expect(scored.lostStars).toBe(
      Math.min(content.feel.mama.earlyWakePenaltyStars, scored.stars + scored.lostStars),
    );
    expect(scored.lostStars).toBe(1);
    expect(scored.stars + scored.lostStars).toBeGreaterThanOrEqual(1);
  });

  it('emits nothing after the end: the world is frozen', () => {
    const last = events.at(-1);
    expect(last?.type).toBe('LevelScored');
  });

  it('replays to exactly the same world, bit for bit', async () => {
    const replay = await replayJournal({
      content,
      geometry,
      level: scenario.level,
      journal,
      untilSimMs: scenario.untilSimMs,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(hashJson(replay.value.sim.world)).toBe(worldHash);
    expect(replay.value.events).toEqual(events);
    replay.value.sim.dispose();
  });
});
