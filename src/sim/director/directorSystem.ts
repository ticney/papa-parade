import { nextFloat } from '@shared/rng';
import { asSimMs } from '@shared/time';
import { isBabyCarried, isBabyFree, isSilenceUnderway } from '../baby/babyFsm.ts';
import { isInZone } from '../baby/zone.ts';
import type { StepContext } from '../context.ts';
import { isJudgeableBeforeEnd } from '../threats/judgeable.ts';
import { hideThreat, telegraphThreat } from '../threats/threatFsm.ts';
import type { ThreatInstance, World } from '../world.ts';
import { fairWindowOpenAt, simultaneousWeightOf } from './fairness.ts';
import { isThreatActive } from './waveState.ts';

/**
 * System: the wave director (story 1.18, architecture L273). It enters each wave at its `fromMs`
 * (`WaveStarted`) and, at most once per step, telegraphs one threat. A threat comes only when the
 * wave is open (before `closesAtMs`, the lull follows), Papa is not carrying the baby (story 4.1: nothing is drawn then, and no draw is spent), the gap since the last telegraph has
 * passed (`director.nextAt`), the baby is not playing out a gag, and fewer than the wave's
 * `maxSimultaneous` threats are announced or open (a silence counts for two, any other wave-planned
 * threat for one, the micro-sleep for none). The threat is drawn from `world.rng`, uniformly
 * among the idle ones of the waves entered so far (waves are cumulative). The number of draws never
 * depends on the tuning: one `nextFloat` per gap and one per pick, even with a single candidate
 * (the tuning decides which threat is picked and, through the fairness rule below, whether it is
 * telegraphed, never how many numbers are drawn). A level with no wave draws nothing.
 * Allocation-free: counting loops only.
 *
 * The fairness rule (story 3.13, FR75, ADR-011): the threat is telegraphed now, but its window opens
 * no closer than `movement.glideMaxMs + director.fairnessMarginMs` to any other frozen window, and
 * no sooner than the end of a found silence's parry plus that spacing ({@link fairWindowOpenAt}):
 * the window is postponed, the telegraph lasts longer. A postponed window that could no longer be
 * judged before the end of the level is not telegraphed at all (the threat stays idle, the gap is
 * drawn as usual, so the draws do not change). The director reads no Papa state, so an occupation
 * Papa chose or a sequel of a miss moves nothing; a window already frozen never moves.
 *
 * A `hiddenZone` threat (the suspicious silence, story 1.21) is drawn like any other, but is a
 * candidate only while the baby is free, Papa is outside its zone, two places are left in the wave
 * and no other wave threat is active; picking it does not telegraph it: it is hidden until
 * the baby is found ({@link startThreat}). This step's `ForceThreat` debug commands run first, through
 * the same helper; they ignore the gaps, `maxSimultaneous`, the lull and the fairness rule
 * (the e2e specs force overlapping threats on purpose), and draw nothing.
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

  // A special sequence (story 4.4) owns the room: the waves above still entered on time (their
  // draw and clock do not depend on sequences), but nothing is forced or drawn, and nothing but
  // the sequence's own threats is telegraphed.
  if (world.flow.state === 'sequence') return;

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
  // The places taken by the wave's active threats: a silence takes two, the micro-sleep (no wave
  // plans it) none (deferred L326); and whether any wave-planned threat is active at all.
  let activeCount = 0;
  let isWaveThreatActive = false;
  for (let i = 0; i < threats.length; i++) {
    if (!isThreatActive(threats[i] as ThreatInstance)) continue;
    const weight = simultaneousWeightOf(ctx, i);
    activeCount += weight;
    if (weight > 0) isWaveThreatActive = true;
  }
  const placesLeft = wave.maxSimultaneous - activeCount;
  if (placesLeft <= 0) return;
  let candidateCount = 0;
  for (let i = 0; i < threats.length; i++) {
    if (isCandidate(world, ctx, i, waveIndex, placesLeft, isWaveThreatActive)) candidateCount++;
  }
  if (candidateCount === 0) return;

  let pick = Math.min(candidateCount - 1, Math.floor(nextFloat(world.rng) * candidateCount));
  for (let i = 0; i < threats.length; i++) {
    if (!isCandidate(world, ctx, i, waveIndex, placesLeft, isWaveThreatActive)) continue;
    if (pick > 0) {
      pick--;
      continue;
    }
    // Telegraphed now with its window postponed to a fair instant; or, when that instant could no
    // longer be judged before the end of the level, not telegraphed (it waits; the gap is drawn).
    const postponeMs = postponementOf(world, ctx, i);
    if (postponeMs !== null) startThreat(world, ctx, i, waveIndex, postponeMs);
    const gapMs = wave.gapMinMs + nextFloat(world.rng) * (wave.gapMaxMs - wave.gapMinMs);
    director.nextAt = asSimMs(now + gapMs);
    return;
  }
}

/**
 * Whether the idle threat at `index` can be drawn by wave `waveIndex` now: it is in the pool, a
 * place is left for it and, while a silence is under way, nothing else is drawn (the baby is away
 * and would ignore the telegraph). A silence needs the baby free to go and hide, Papa outside the
 * zone (he would find the baby at once: no silence at all), two places left in the wave and no
 * other wave threat active (an announced threat would open its window while Papa searches, story 3.13).
 * `placesLeft` is the wave's `maxSimultaneous` minus the places its active threats take (a silence
 * takes two); `isWaveThreatActive` is whether any wave-planned threat (a silence included) is
 * hidden, announced or open. Both are counted once per step by {@link runDirector}.
 */
function isCandidate(
  world: World,
  ctx: StepContext,
  index: number,
  waveIndex: number,
  placesLeft: number,
  isWaveThreatActive: boolean,
): boolean {
  const threat = world.threats[index];
  if (threat === undefined || threat.state !== 'idle' || !isInPool(ctx, index, waveIndex)) {
    return false;
  }
  // Papa carries the baby (story 4.1): nobody is left to menace, so the director draws nothing.
  if (isBabyCarried(world)) return false;
  if (simultaneousWeightOf(ctx, index) > placesLeft) return false;
  const planned = ctx.level.threats[index];
  if (planned?.def.target !== 'hiddenZone') return !isSilenceUnderway(world);
  if (isWaveThreatActive || !isBabyFree(world)) return false;
  return planned.zone === null || !isInZone(planned.zone, world.papa.xM, world.papa.zM);
}

/**
 * How much later than its natural instant the window of the idle threat at `index` opens when the
 * director draws it now (the fairness rule, {@link fairWindowOpenAt}), or null when that postponed
 * window could no longer be judged before the end of the level (the threat waits). A silence has
 * no window yet: 0.
 */
function postponementOf(world: World, ctx: StepContext, index: number): number | null {
  const def = ctx.level.threats[index]?.def;
  if (def === undefined || def.target === 'hiddenZone') return 0;
  const delayMs = def.telegraphDelayMs ?? ctx.feel.timing.telegraphDelayDefaultMs;
  const naturalAt = world.time.sim + delayMs;
  const postponeMs = fairWindowOpenAt(world, ctx, index, naturalAt) - naturalAt;
  if (postponeMs <= 0) return 0;
  return isJudgeableBeforeEnd(world, ctx, def, world.time.sim + postponeMs) ? postponeMs : null;
}

/**
 * Starts the idle threat at `index`: a silence goes `idle → hidden`, any other threat is
 * telegraphed with its window postponed by `postponeMs`. The one place a draw and `ForceThreat`
 * share (`ForceThreat` postpones nothing).
 */
function startThreat(
  world: World,
  ctx: StepContext,
  index: number,
  waveIndex: number,
  postponeMs: number,
): void {
  const threat = world.threats[index];
  const planned = ctx.level.threats[index];
  if (threat === undefined || planned === undefined) return;
  if (planned.def.target === 'hiddenZone') hideThreat(world, ctx, threat, waveIndex);
  else telegraphThreat(world, ctx, threat, planned.def, waveIndex, postponeMs);
}

/**
 * `ForceThreat` (debug): starts the idle threat `threatId` now. Ignored, with no event, when it is
 * unknown, not idle, on Papa, on the baby or on a chore station, or a silence while the baby is not free, or Papa stands in its zone.
 */
function forceThreat(world: World, ctx: StepContext, threatId: number): void {
  for (let i = 0; i < world.threats.length; i++) {
    const threat = world.threats[i] as ThreatInstance;
    if (threat.id !== threatId) continue;
    const target = ctx.level.threats[i]?.def.target;
    // A threat on Papa, on the baby or on a chore station is spawned by the sim itself (a micro-sleep,
    // a stealth step's alerts, an abandoned cooking's pot).
    if (threat.state !== 'idle' || target === 'papa' || target === 'baby' || target === 'station') {
      return;
    }
    if (target === 'hiddenZone') {
      const zone = ctx.level.threats[i]?.zone;
      const isPapaIn =
        zone !== null && zone !== undefined && isInZone(zone, world.papa.xM, world.papa.zM);
      if (!isBabyFree(world) || isPapaIn) return;
    }
    startThreat(world, ctx, i, world.director.waveIndex, 0);
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
