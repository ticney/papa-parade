import { nextFloat } from '@shared/rng';
import { asSimMs } from '@shared/time';
import { isBabyFree, isSilenceUnderway } from '../baby/babyFsm.ts';
import { isInZone } from '../baby/silence.ts';
import type { StepContext } from '../context.ts';
import { hideThreat, telegraphThreat } from '../threats/threatFsm.ts';
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
 *
 * A `hiddenZone` threat (the suspicious silence, story 1.21) is drawn like any other, but is a
 * candidate only while the baby is free and Papa is outside its zone, and picking it does not telegraph it: it is hidden until
 * the baby is found ({@link startThreat}). This step's `ForceThreat` debug commands run first, through
 * the same helper; they ignore the gaps, `maxSimultaneous` and the lull, and draw nothing.
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

  for (let c = 0; c < ctx.commands.length; c++) {
    const command = ctx.commands[c];
    if (command?.type === 'ForceThreat') forceThreat(world, ctx, command.threatId);
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
    // The micro-sleep (no wave plans it) never counts against `maxSimultaneous` (deferred L326).
    if (isThreatActive(threat)) {
      if ((ctx.level.threats[i]?.firstWaveIndex ?? -1) >= 0) activeCount++;
    } else if (isCandidate(world, ctx, i, waveIndex)) candidateCount++;
  }
  if (activeCount >= wave.maxSimultaneous || candidateCount === 0) return;

  let pick = Math.min(candidateCount - 1, Math.floor(nextFloat(world.rng) * candidateCount));
  for (let i = 0; i < threats.length; i++) {
    if (!isCandidate(world, ctx, i, waveIndex)) continue;
    if (pick > 0) {
      pick--;
      continue;
    }
    startThreat(world, ctx, i, waveIndex);
    const gapMs = wave.gapMinMs + nextFloat(world.rng) * (wave.gapMaxMs - wave.gapMinMs);
    director.nextAt = asSimMs(now + gapMs);
    return;
  }
}

/**
 * Whether the idle threat at `index` can be drawn by wave `waveIndex` now: it is in the pool and,
 * while a silence is under way, nothing else is drawn (the baby is away and would ignore the
 * telegraph). A silence needs the baby free to go and hide, and Papa outside the zone (he would
 * find the baby at once: no silence at all).
 */
function isCandidate(world: World, ctx: StepContext, index: number, waveIndex: number): boolean {
  const threat = world.threats[index];
  if (threat === undefined || threat.state !== 'idle' || !isInPool(ctx, index, waveIndex)) {
    return false;
  }
  const planned = ctx.level.threats[index];
  if (planned?.def.target !== 'hiddenZone') return !isSilenceUnderway(world);
  if (!isBabyFree(world)) return false;
  return planned.zone === null || !isInZone(planned.zone, world.papa.xM, world.papa.zM);
}

/**
 * Starts the idle threat at `index`: a silence goes `idle → hidden`, any other threat is telegraphed.
 * The one place a draw and `ForceThreat` share.
 */
function startThreat(world: World, ctx: StepContext, index: number, waveIndex: number): void {
  const threat = world.threats[index];
  const planned = ctx.level.threats[index];
  if (threat === undefined || planned === undefined) return;
  if (planned.def.target === 'hiddenZone') hideThreat(world, ctx, threat, waveIndex);
  else telegraphThreat(world, ctx, threat, planned.def, waveIndex);
}

/**
 * `ForceThreat` (debug): starts the idle threat `threatId` now. Ignored, with no event, when it is
 * unknown, not idle, on Papa, or a silence while the baby is not free, or Papa stands in its zone.
 */
function forceThreat(world: World, ctx: StepContext, threatId: number): void {
  for (let i = 0; i < world.threats.length; i++) {
    const threat = world.threats[i] as ThreatInstance;
    if (threat.id !== threatId) continue;
    const target = ctx.level.threats[i]?.def.target;
    if (threat.state !== 'idle' || target === 'papa') return;
    if (target === 'hiddenZone') {
      const zone = ctx.level.threats[i]?.zone;
      const isPapaIn =
        zone !== null && zone !== undefined && isInZone(zone, world.papa.xM, world.papa.zM);
      if (!isBabyFree(world) || isPapaIn) return;
    }
    startThreat(world, ctx, i, world.director.waveIndex);
    return;
  }
}

/**
 * Whether the threat at `index` can be drawn by wave `waveIndex` (it was added by that wave or an
 * earlier one). A threat the sim spawns itself (`firstWaveIndex` -1, the micro-sleep) is in no pool.
 */
function isInPool(ctx: StepContext, index: number, waveIndex: number): boolean {
  const planned = ctx.level.threats[index];
  return (
    planned !== undefined && planned.firstWaveIndex >= 0 && planned.firstWaveIndex <= waveIndex
  );
}

/** Whether wave `waveIndex` has any threat in its pool at all (idle or not). */
function hasCandidates(world: World, ctx: StepContext, waveIndex: number): boolean {
  for (let i = 0; i < world.threats.length; i++) if (isInPool(ctx, i, waveIndex)) return true;
  return false;
}
