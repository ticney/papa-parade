import { fileURLToPath } from 'node:url';
import { asSimMs } from '@shared/time';
import { createSim, type SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { createFairnessCheck } from '../../../tools/sim/fairnessCheck.ts';
import { loadSimLevel } from '../../../tools/sim/loadSimLevel.ts';
import { fairnessSetupOf, runSim } from '../../../tools/sim/runSim.ts';
import { createRunRecorder } from '../../../tools/sim/simReport.ts';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  OUTLET,
  STAIRS,
  testWave,
} from '../../support/testContent.ts';

const CONTENT_DIR = fileURLToPath(new URL('../../../content', import.meta.url));

// The spacing and the delays are written out here on purpose: the check is a black box over events,
// and these streams are made by hand, so the numbers they are judged by must be plain too.
const SPACING_MS = 900;
const DELAYS = { outlet: 1200, stairs: 1000, silence_mischief: 800, micro_sleep: 1200 };
const WINDOW = { windowMs: 300, perfectMs: 100, toleranceMs: 60, bufferMs: 100 };

const at = (t: number) => asSimMs(t);
const telegraphed = (t: number, threatId: number, kind: string, waveIndex = 0): SimEvent => ({
  type: 'ThreatTelegraphed',
  t: at(t),
  threatId,
  kind,
  anchorId: 'a',
  waveIndex,
});
const hidden = (t: number, threatId: number): SimEvent => ({
  type: 'ThreatHidden',
  t: at(t),
  threatId,
  kind: 'silence_mischief',
  anchorId: 'behind_sofa',
  waveIndex: 0,
});
const silenceEnded = (t: number, threatId: number): SimEvent => ({
  type: 'SilenceEnded',
  t: at(t),
  threatId,
  reason: 'found',
});
const opened = (t: number, threatId: number): SimEvent => ({
  type: 'WindowOpened',
  t: at(t),
  threatId,
});
const resolved = (t: number, threatId: number): SimEvent => ({
  type: 'ResponseResolved',
  t: at(t),
  threatId,
  response: 'parry',
  quality: 'perfect',
  offsetMs: 0,
  responseWindow: WINDOW,
});
const rearmed = (t: number, threatId: number): SimEvent => ({
  type: 'ThreatRearmed',
  t: at(t),
  threatId,
});

function check(events: readonly SimEvent[]) {
  const fairness = createFairnessCheck(SPACING_MS, DELAYS);
  for (const event of events) fairness.onEvent(event);
  return fairness.finish();
}

describe('the fairness check (story 3.13, AC 10)', () => {
  it('counts nothing for two windows exactly the spacing apart, in either order', () => {
    expect(
      check([
        telegraphed(0, 1, 'outlet'),
        telegraphed(10, 2, 'stairs'),
        opened(1200, 1),
        opened(1200 + SPACING_MS, 2),
      ]).fairnessViolations,
    ).toBe(0);
    expect(
      check([
        telegraphed(0, 1, 'outlet'),
        telegraphed(10, 2, 'stairs'),
        opened(1200, 1),
        opened(1200 - SPACING_MS, 2),
      ]).fairnessViolations,
    ).toBe(0);
  });

  it('counts a window that opens less than the spacing from one announced before it, once, whichever side', () => {
    const after = check([
      telegraphed(0, 1, 'outlet'),
      telegraphed(10, 2, 'stairs'),
      opened(1200, 1),
      opened(1200 + SPACING_MS - 10, 2),
    ]);
    expect(after.fairnessViolations).toBe(1);
    const before = check([
      telegraphed(0, 1, 'outlet'),
      telegraphed(10, 2, 'stairs'),
      opened(1010, 2),
      opened(1200, 1),
    ]);
    expect(before.fairnessViolations).toBe(1);
  });

  it('counts the later of three overlapping windows, each against every earlier one, once', () => {
    const result = check([
      telegraphed(0, 1, 'outlet'),
      telegraphed(10, 2, 'stairs'),
      telegraphed(20, 3, 'outlet'),
      opened(1200, 1),
      opened(1300, 2),
      opened(1400, 3),
    ]);
    // Threats 2 and 3 are each too close to an earlier one; threat 1 has none announced before it.
    expect(result.fairnessViolations).toBe(2);
  });

  it('judges a window against a threat announced before it only: the earlier one is not blamed', () => {
    expect(check([telegraphed(0, 1, 'outlet'), opened(1200, 1)]).fairnessViolations).toBe(0);
  });

  it('keeps the guard of a found silence: until the end of its parry plus the spacing, and the spacing before it', () => {
    const silence = [
      hidden(0, 1),
      silenceEnded(3000, 1),
      telegraphed(3000, 1, 'silence_mischief'),
      opened(3800, 1),
      resolved(3950, 1),
    ];
    const guardEnd = 3800 + WINDOW.windowMs + WINDOW.toleranceMs + SPACING_MS;
    const run = (openAt: number) =>
      check([...silence, telegraphed(3960, 2, 'outlet'), opened(openAt, 2)]).fairnessViolations;
    expect(run(guardEnd - 10)).toBe(1);
    expect(run(guardEnd)).toBe(0);
    // Past the first clause's reach (3800 + spacing) but inside the parry's tail: only clause 2 catches it.
    expect(3800 + SPACING_MS).toBeLessThan(guardEnd - 10);
    expect(run(3800 + SPACING_MS + 10)).toBe(1);
  });

  it('counts a threat drawn while a silence is under way, even if its window never opened', () => {
    const result = check([hidden(0, 1), telegraphed(500, 2, 'outlet'), silenceEnded(900, 1)]);
    expect(result.fairnessViolations).toBe(1);
    // After the silence ended (found), drawing is fair again.
    const after = check([
      hidden(0, 1),
      silenceEnded(900, 1),
      telegraphed(900, 1, 'silence_mischief'),
      telegraphed(2000, 2, 'outlet'),
    ]);
    expect(after.fairnessViolations).toBe(0);
  });

  it('never takes a found silence for a draw: its reveal comes after its ThreatHidden', () => {
    expect(
      check([
        hidden(0, 1),
        silenceEnded(900, 1),
        telegraphed(900, 1, 'silence_mischief'),
        opened(1700, 1),
      ]).fairnessViolations,
    ).toBe(0);
  });

  it('never takes the micro-sleep for a draw, whatever it lands next to, but spaces a draw from its window', () => {
    // Announced after the outlet, 100 ms from it: Papa's need, not the director's draw.
    expect(
      check([
        telegraphed(0, 1, 'outlet'),
        telegraphed(10, 9, 'micro_sleep', -1),
        opened(1200, 1),
        opened(1300, 9),
      ]).fairnessViolations,
    ).toBe(0);
    // Announced before a draw that opens close to it: the draw is blamed.
    expect(
      check([
        telegraphed(0, 9, 'micro_sleep', -1),
        telegraphed(10, 2, 'stairs'),
        opened(1200, 9),
        opened(1100, 2),
      ]).fairnessViolations,
    ).toBe(1);
  });

  it('follows a threat through its cycles: a re-armed threat is judged anew', () => {
    const result = check([
      telegraphed(0, 1, 'outlet'),
      opened(1200, 1),
      resolved(1300, 1),
      rearmed(1800, 1),
      telegraphed(5000, 1, 'outlet'),
      opened(6200, 1),
    ]);
    expect(result.fairnessViolations).toBe(0);
  });

  it('measures how much later a draw opened than its telegraph delay says', () => {
    const result = check([
      telegraphed(0, 1, 'outlet'),
      telegraphed(10, 2, 'stairs'),
      opened(1200, 1),
      // The stairs would open at 10 + 1000 = 1010: held until 1200 + 900, 1090 ms late.
      opened(2100, 2),
    ]);
    expect(result).toEqual({ fairnessViolations: 0, stretchedTelegraphs: 1, stretchSumMs: 1090 });
  });

  it('leaves out of the stretch a def it knows no delay for, and a window that never opened', () => {
    const result = check([
      telegraphed(0, 1, 'mystery'),
      opened(5000, 1),
      telegraphed(0, 2, 'outlet'),
    ]);
    expect(result).toEqual({ fairnessViolations: 0, stretchedTelegraphs: 0, stretchSumMs: 0 });
  });
});

describe('the fairness check on the live sim (story 3.13, AC 11)', () => {
  it('flags two threats forced 100 ms apart: it can fail', async () => {
    const content = createTestContent();
    const level = createTestLevel({
      waves: [
        testWave([OUTLET, STAIRS], { maxSimultaneous: 2, gapMinMs: 60_000, gapMaxMs: 60_000 }),
      ],
    });
    const sim = await createSim({ content, geometry: createTestGeometry(), level, seed: 1 });
    try {
      const recorder = createRunRecorder(
        sim,
        1,
        level.level.waves,
        null,
        new Set(),
        fairnessSetupOf(content, level),
      );
      const [outlet, stairs] = sim.world.threats;
      sim.enqueue({ type: 'ForceThreat', t: at(0), threatId: outlet?.id ?? -1 });
      sim.enqueue({ type: 'ForceThreat', t: at(100), threatId: stairs?.id ?? -1 });
      while (sim.world.time.sim < 3000) {
        sim.step();
        for (const event of sim.drainEvents()) recorder.onEvent(event);
      }
      expect(recorder.finish().fairnessViolations).toBeGreaterThanOrEqual(1);
    } finally {
      sim.dispose();
    }
  });

  it('counts none for perfect and human on a few seeds of the live salon, and perfect fails nothing', async () => {
    const loaded = await loadSimLevel(CONTENT_DIR, 'salon_crawler');
    if (!loaded.ok) throw new Error(loaded.error);
    for (const botId of ['perfect', 'human'] as const) {
      const report = await runSim(
        {
          levelId: 'salon_crawler',
          botId,
          tier: 'normal',
          seed: 1,
          runs: 4,
          untilSimMs: null,
          outPath: null,
          journalsDir: null,
          chronoRing: 'on',
          compareDir: null,
          sequenceId: null,
          sequenceAtMs: 1000,
          help: false,
        },
        loaded.value,
      );
      if (!report.ok) throw new Error(report.error);
      expect(report.value.fairnessViolations, botId).toBe(0);
      expect(
        report.value.runList.map((run) => run.fairnessViolations),
        botId,
      ).toEqual([0, 0, 0, 0]);
      // The director does wait in the salon, and says how much.
      expect(report.value.stretchedTelegraphs, botId).toBeGreaterThan(0);
      expect(report.value.meanStretchMs, botId).not.toBeNull();
      if (botId === 'perfect') expect(report.value.gags.total).toBe(0);
    }
  }, 120_000);
});
