import { hashJson } from '@shared/hash';
import { replayJournal } from '@sim';
import { describe, expect, it } from 'vitest';
import { createTestContent, createTestGeometry } from '../support/testContent.ts';
import { recordScenario, SCENARIOS } from './scenarios.ts';

/**
 * The golden compares hashes, which say nothing about what a scenario exercises. This pins that
 * `instinct` really is what it is there for: real misses reach the rule, the instinct triggers once
 * with its slow-mo, lasts exactly `durationMs`, and a threat telegraphed during it has the wider window.
 */
const scenario = SCENARIOS.find((candidate) => candidate.name === 'instinct');
if (scenario === undefined) throw new Error('missing scenario instinct');
const content = createTestContent();
const geometry = createTestGeometry();
const { events, journal, worldHash } = await recordScenario(content, geometry, scenario);
const { instinct } = content.feel;

const triggered = events.filter((event) => event.type === 'InstinctTriggered');
const ended = events.filter((event) => event.type === 'InstinctEnded');
const gags = events.filter((event) => event.type === 'GagTriggered');

describe('golden scenario instinct covers what it is there for', () => {
  it('is reached by real misses: at least two gags before the trigger, and nothing answered', () => {
    expect(triggered).toHaveLength(1);
    const at = triggered[0]?.t ?? 0;
    expect(gags.filter((event) => event.t <= at).length).toBeGreaterThanOrEqual(
      instinct.missesCount,
    );
    expect(
      events.some((event) => event.type === 'ResponseResolved' && event.quality !== 'fail'),
    ).toBe(false);
  });

  it('triggers in the step of a miss, with the slow-mo right after', () => {
    const [start] = triggered;
    if (start === undefined) throw new Error('no instinct');
    const step = events.filter((event) => event.t === start.t).map((event) => event.type);
    expect(step.indexOf('ResponseResolved')).toBeLessThan(step.indexOf('InstinctTriggered'));
    expect(
      events.find((event) => event.type === 'TimeScaleChanged' && event.t === start.t),
    ).toMatchObject({ from: 1, to: instinct.timeScale });
    expect(start.untilAt).toBe(start.t + instinct.durationMs);
  });

  it('ends by the timer exactly durationMs later', () => {
    expect(ended).toEqual([
      { type: 'InstinctEnded', t: (triggered[0]?.t ?? 0) + instinct.durationMs, reason: 'timer' },
    ]);
  });

  it('judges a threat telegraphed during the instinct against the wider window, the others against the plain one', () => {
    const windows = events.flatMap((event) =>
      event.type === 'ResponseResolved' ? [event.responseWindow.windowMs] : [],
    );
    const widened = content.feel.timing.windowMs * (1 + instinct.windowBonusPct / 100);
    expect(windows.some((windowMs) => Math.abs(windowMs - widened) < 1e-9)).toBe(true);
    expect(windows).toContain(content.feel.timing.windowMs);
  });

  it('replays to the same world', async () => {
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
    replay.value.sim.dispose();
  });
});
