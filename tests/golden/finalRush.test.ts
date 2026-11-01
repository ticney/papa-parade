import { STEP_MS } from '@shared/constants';
import { hashJson } from '@shared/hash';
import { replayJournal } from '@sim';
import { describe, expect, it } from 'vitest';
import { createTestContent, createTestGeometry } from '../support/testContent.ts';
import { recordScenario, SCENARIOS } from './scenarios.ts';

/**
 * The golden compares hashes, which say nothing about what a scenario exercises. This pins that
 * `final_rush_tidied` really is the rush it is there for (story 3.5): the door opens ten seconds before
 * the end, knocks over the toy and the book and nothing else, Papa tidies the three mess, and the level
 * ends on the photo with its note.
 */
const scenario = SCENARIOS.find((candidate) => candidate.name === 'final_rush_tidied');
if (scenario === undefined) throw new Error('missing scenario final_rush_tidied');
const content = createTestContent();
const geometry = createTestGeometry();
const { events, journal, worldHash } = await recordScenario(content, geometry, scenario);

const DURATION_MS = scenario.level.level.durationMs;
const RUSH_AT_MS = DURATION_MS - content.feel.endOfLevel.finalRushMs;

describe('golden scenario final_rush_tidied covers the rush it is there for', () => {
  it('opens the door once, at durationMs - finalRushMs', () => {
    expect(events.filter((event) => event.type === 'FinalRushStarted')).toEqual([
      { type: 'FinalRushStarted', t: RUSH_AT_MS },
    ]);
  });

  it('has the mug already down before the door, and the door knock over the toy and the book alone', () => {
    const impactsBeforeDoor = events.filter(
      (event) => event.type === 'PropImpact' && event.t < RUSH_AT_MS,
    );
    expect(impactsBeforeDoor.length).toBeGreaterThan(0);
    const fromDoor = events.filter(
      (event) =>
        event.type === 'PropImpact' && event.t >= RUSH_AT_MS && event.t < RUSH_AT_MS + 3000,
    );
    const names = new Set(
      fromDoor.map((event) => (event.type === 'PropImpact' ? event.propId : '')),
    );
    expect([...names].sort()).toEqual(['book_01', 'toy_01']);
    expect(events.filter((event) => event.type === 'PropBroken')).toEqual([]);
  });

  it('tidies the three props, the toy, the book, then the mug, in the step each is reached', () => {
    const tidied = events.filter((event) => event.type === 'PropTidied');
    expect(tidied.map((event) => (event.type === 'PropTidied' ? event.propId : ''))).toEqual([
      'toy_01',
      'book_01',
      'mug_01',
    ]);
    expect(tidied[0]?.t).toBeGreaterThan(22_000);
    expect(tidied[2]?.t).toBeLessThan(DURATION_MS);
  });

  it('ends on the photo: LevelEnded{timer} and LevelScored in the same step, the sigh back to 0', () => {
    const ending = events.filter((event) => event.t === DURATION_MS).map((event) => event.type);
    expect(ending).toEqual(['LevelEnded', 'LevelScored']);
    const scored = events.find((event) => event.type === 'LevelScored');
    expect(scored?.type === 'LevelScored' && scored.sighPoints).toBe(0);
    expect(events.at(-1)?.t).toBe(DURATION_MS);
    expect(DURATION_MS % STEP_MS).toBe(0);
  });

  it('replays to exactly the same world, bit for bit', async () => {
    const replay = await replayJournal({
      content,
      geometry: scenario.geometry ?? geometry,
      level: scenario.level,
      journal,
      untilSimMs: scenario.untilSimMs,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.sim.world.flow.state).toBe('photo');
    expect(hashJson(replay.value.sim.world)).toBe(worldHash);
    expect(replay.value.events).toEqual(events);
    replay.value.sim.dispose();
  });
});
