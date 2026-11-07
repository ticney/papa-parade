import { hashJson } from '@shared/hash';
import { replayJournal } from '@sim';
import { describe, expect, it } from 'vitest';
import { createTestContent, createTestGeometry } from '../support/testContent.ts';
import { recordScenario, SCENARIOS } from './scenarios.ts';

/**
 * The golden compares hashes, which say nothing about what a scenario exercises. This pins that
 * `papa_look` shows what it is there for (story 3.7): one gag shows Papa's hair on end, a second
 * one shows nothing more, and the Laugh counts the part when the level is scored.
 */
const scenario = SCENARIOS.find((candidate) => candidate.name === 'papa_look');
if (scenario === undefined) throw new Error('missing scenario papa_look');
const content = createTestContent();
const geometry = createTestGeometry();
const { events, journal, worldHash } = await recordScenario(content, geometry, scenario);

describe('golden scenario papa_look covers the look it is there for', () => {
  it('gags twice but shows the hair once: one PapaLookChanged, at the first gag', () => {
    const gags = events.filter((event) => event.type === 'GagTriggered');
    expect(gags).toHaveLength(2);
    const looks = events.filter((event) => event.type === 'PapaLookChanged');
    expect(looks).toEqual([
      { type: 'PapaLookChanged', t: gags[0]?.t, part: 'hairOnEnd', threatId: gags[0]?.threatId },
    ]);
  });

  it('counts the part in the Laugh when the level is scored, after the timer end', () => {
    expect(events.filter((event) => event.type === 'LevelEnded')).toMatchObject([
      { reason: 'timer' },
    ]);
    const scored = events.find((event) => event.type === 'LevelScored');
    expect(scored?.type).toBe('LevelScored');
    if (scored?.type !== 'LevelScored') return;
    const { mama } = content.feel;
    // Nobody answered: no perfect, no success, no combo. The hair is the whole Laugh.
    expect(scored.laughPoints).toBe(
      Math.round(Math.min(mama.laughPerLookPartPoints, mama.laughMaxPoints)),
    );
    expect(scored.laughPoints).toBeGreaterThan(0);
  });

  it('replays to exactly the same world and events, bit for bit', async () => {
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
