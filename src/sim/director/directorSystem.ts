import { nextFloat } from '@shared/rng';
import { asSimMs } from '@shared/time';
import type { StepContext } from '../context.ts';
import { telegraphThreat } from '../threats/threatFsm.ts';
import type { ThreatInstance, World } from '../world.ts';
import { isThreatActive } from './waveState.ts';

/**
 * System: the wave director (story 1.18, architecture L273). It enters each wave at its `fromMs`
 * (`WaveStarted`) and, at most once per step, telegraphs one threat. A threat comes only when the
 * wave is open (before `closesAtMs`, the lull follows), the gap since the last telegraph has
 * passed (`director.nextAt`), the baby is not playing out a gag, and fewer than the wave's
 * `maxSimultaneous` threats are announced or open. The threat is drawn from `world.rng`, uniformly
 * among the idle ones of the waves entered so far (waves are cumulative). The draws depend only on
 * the game, never on the tuning: one `nextFloat` per gap and one per pick, even with a single
 * candidate. A level with no wave draws nothing. Allocation-free: counting loops only.
 */
export function runDirector(world: World, ctx: StepContext): void {
  const { waves } = ctx.level;
  const { director } = world;
  const now = world.time.sim;

  // Enter the waves whose time has come, in order (one `WaveStarted` each).
  while (director.waveIndex + 1 < waves.length) {
    const next = director.waveIndex + 1;
    const wave = waves[next];
    if (wave === undefined || now < wave.fromMs) break;
    director.waveIndex = next;
    ctx.events.push({ type: 'WaveStarted', t: now, waveIndex: next });
    // The first gap of the wave, only when something can be drawn (the pool is cumulative).
    if (hasCandidates(world, ctx, next)) {
      const gapMs = wave.gapMinMs + nextFloat(world.rng) * (wave.gapMaxMs - wave.gapMinMs);
      director.nextAt = asSimMs(wave.fromMs + gapMs);
    } else {
      director.nextAt = asSimMs(wave.fromMs);
    }
  }

  const waveIndex = director.waveIndex;
  if (waveIndex < 0) return;
  const wave = waves[waveIndex];
  if (wave === undefined) return;
  if (now >= wave.closesAtMs || now < director.nextAt) return;
  if (world.baby.state === 'act') return;

  const { threats } = world;
  let activeCount = 0;
  let candidateCount = 0;
  for (let i = 0; i < threats.length; i++) {
    const threat = threats[i] as ThreatInstance;
    if (isThreatActive(threat)) activeCount++;
    else if (threat.state === 'idle' && isInPool(ctx, i, waveIndex)) candidateCount++;
  }
  if (activeCount >= wave.maxSimultaneous || candidateCount === 0) return;

  let pick = Math.min(candidateCount - 1, Math.floor(nextFloat(world.rng) * candidateCount));
  for (let i = 0; i < threats.length; i++) {
    const threat = threats[i] as ThreatInstance;
    if (threat.state !== 'idle' || !isInPool(ctx, i, waveIndex)) continue;
    if (pick > 0) {
      pick--;
      continue;
    }
    const planned = ctx.level.threats[i];
    if (planned === undefined) return;
    telegraphThreat(world, ctx, threat, planned.def, waveIndex);
    const gapMs = wave.gapMinMs + nextFloat(world.rng) * (wave.gapMaxMs - wave.gapMinMs);
    director.nextAt = asSimMs(now + gapMs);
    return;
  }
}

/** Whether the threat at `index` can be drawn by wave `waveIndex` (it was added by that wave or an earlier one). */
function isInPool(ctx: StepContext, index: number, waveIndex: number): boolean {
  const planned = ctx.level.threats[index];
  return planned !== undefined && planned.firstWaveIndex <= waveIndex;
}

/** Whether wave `waveIndex` has any threat in its pool at all (idle or not). */
function hasCandidates(world: World, ctx: StepContext, waveIndex: number): boolean {
  for (let i = 0; i < world.threats.length; i++) if (isInPool(ctx, i, waveIndex)) return true;
  return false;
}
