import type { BeatsStep } from '@content/schemas/sequence';
import { LATE_TAP_GRACE_MS, NEUTRAL_WINDOW_MODIFIER } from '@shared/constants';
import { asSimMs } from '@shared/time';
import type { StepContext } from '../context.ts';
import type { BabyStirReason } from '../events.ts';
import { fatigueWindowModifier } from '../gauges/fatigue.ts';
import { activeDifficulty } from '../timing/difficulty.ts';
import { effectiveWindow } from '../timing/effectiveWindow.ts';
import type { BeatSlice, World } from '../world.ts';
import { type BeatEntry, classifyTap, nextJudgedEntryIndex } from './beatClock.ts';
import { failSequence, plannedSequenceOf } from './sequenceEnd.ts';
import type { StepHandler } from './sequenceSteps.ts';

// « Les 100 pas en rythme » (story 4.5): the `beats` step. Papa rocks the baby by tapping to a
// lullaby that slows down. The step is a timeline of notes (`beatTimelineOf`, rebuilt from content
// by `simLevelOf`, never in the snapshot) and two cursors in `world.sequence.beat`: `cueIndex`
// announces notes, `judgeIndex` settles beats. They are separate on purpose: a beat tapped early has
// not been announced yet, and it still must be. A `beats` step draws nothing from `world.rng`.

/** Whether a `beats` step is the running step: the client sends `TapBeat`s (and draws the ring) while it is. */
export function isBeatStepRunning(world: World): boolean {
  return world.sequence.beat.isRunning;
}

/** The timeline of the step that runs, or null (no sequence, or the step is not a `beats` step). */
function timelineOf(world: World, ctx: StepContext): readonly BeatEntry[] | null {
  const planned = plannedSequenceOf(ctx, world.sequence.id);
  return planned?.beatTimelines[world.sequence.stepIndex] ?? null;
}

/** When the running step started, in sim time: the end of the step minus its length. */
function stepStartAtOf(world: World, step: BeatsStep): number {
  return world.sequence.stepEndsAt - step.durationMs;
}

/**
 * Moves the judge cursor to the entry `to` (or past the end): no decoy is spent, `nextBeatAt` is the
 * new beat's time, and its window is computed now, once, so that a window already announced keeps its
 * length whatever the fatigue or the tier do next (the threats' rule). `bufferMs` is forced to 0: a
 * buffer keeps a press that is early, which in a rhythm would swallow the off-beat.
 */
function moveJudgeCursor(
  world: World,
  ctx: StepContext,
  step: BeatsStep,
  timeline: readonly BeatEntry[],
  to: number,
): void {
  const { beat } = world.sequence;
  beat.judgeIndex = to;
  beat.isDecoySpent = false;
  const entry = timeline[to];
  if (entry === undefined) {
    beat.nextBeatAt = null;
    return;
  }
  beat.nextBeatAt = asSimMs(stepStartAtOf(world, step) + entry.offsetMs);
  const response = effectiveWindow(ctx.feel.timing, step.windowMs, {
    tier: activeDifficulty(world, ctx).windowMultiplier,
    fatigue: fatigueWindowModifier(world, ctx),
    instinct: NEUTRAL_WINDOW_MODIFIER,
  });
  response.bufferMs = 0;
  beat.responseWindow = response;
}

/**
 * The baby stirs: `wakePct` goes up by the cost of `reason` (the def's `babyAwake` failure), held in
 * `[0, 100]`, and `BabyStirred` says so. At 100 the baby is up: `BabyWoke`, then the sequence ends
 * (`SequenceEnded{failed}`, flow back to `playing`, the resume of 4.4). No snore and no noise (D5),
 * no change of the baby's state: the sequence is lost, the note goes on. A cost of 0 stirs nobody,
 * so it says nothing (`BabyStirred` is the sound and the haptic): `strayWakePct: 0` is a free stray.
 */
function stirBaby(world: World, ctx: StepContext, reason: BabyStirReason): void {
  const { beat } = world.sequence;
  const failure = plannedSequenceOf(ctx, world.sequence.id)?.def.failure;
  if (failure?.kind !== 'babyAwake') return;
  let costPct = failure.strayWakePct;
  if (reason === 'missed') costPct = failure.missWakePct;
  else if (reason === 'decoy') costPct = failure.decoyWakePct;
  const before = beat.wakePct;
  beat.wakePct = Math.min(100, Math.max(0, before + costPct));
  const now = world.time.sim;
  if (beat.wakePct > before) {
    ctx.events.push({
      type: 'BabyStirred',
      t: now,
      wakePct: beat.wakePct,
      deltaPct: beat.wakePct - before,
      reason,
    });
  }
  if (beat.wakePct < 100) return;
  ctx.events.push({ type: 'BabyWoke', t: now });
  failSequence(world, ctx);
}

/** Settles the judged beat at the judge cursor as a miss, and moves on. May end the sequence. */
function missBeat(
  world: World,
  ctx: StepContext,
  step: BeatsStep,
  timeline: readonly BeatEntry[],
  entry: BeatEntry,
): void {
  const { beat } = world.sequence;
  ctx.events.push({ type: 'BeatMissed', t: world.time.sim, judgedIndex: entry.judgedIndex });
  moveJudgeCursor(world, ctx, step, timeline, nextJudgedEntryIndex(timeline, beat.judgeIndex + 1));
  stirBaby(world, ctx, 'missed');
}

/**
 * Judges one `TapBeat` on its own timestamp `tapT` (never `world.time.sim`, ADR-003) through
 * `classifyTap`. A tap with no judged beat left is free: there is nothing left to hit and nothing to
 * mash through.
 */
function judgeTap(
  world: World,
  ctx: StepContext,
  step: BeatsStep,
  timeline: readonly BeatEntry[],
  tapT: number,
): void {
  const { beat } = world.sequence;
  const entry = timeline[beat.judgeIndex];
  if (entry === undefined) return;
  const stepStartAt = stepStartAtOf(world, step);
  const beatAt = stepStartAt + entry.offsetMs;
  const before = beat.judgeIndex > 0 ? timeline[beat.judgeIndex - 1] : undefined;
  const decoyAt =
    before?.kind === 'decoy' && !beat.isDecoySpent ? stepStartAt + before.offsetMs : null;
  const isFirstBeat = beat.judgeIndex === nextJudgedEntryIndex(timeline, 0);
  const kind = classifyTap(tapT, beatAt, decoyAt, beat.responseWindow, isFirstBeat);
  const now = world.time.sim;
  if (kind === 'hit') {
    ctx.events.push({
      type: 'BeatHit',
      t: now,
      judgedIndex: entry.judgedIndex,
      offsetMs: tapT - beatAt,
    });
    moveJudgeCursor(
      world,
      ctx,
      step,
      timeline,
      nextJudgedEntryIndex(timeline, beat.judgeIndex + 1),
    );
  } else if (kind === 'miss') {
    missBeat(world, ctx, step, timeline, entry);
  } else if (kind === 'decoy') {
    ctx.events.push({ type: 'DecoyTapped', t: now, entryIndex: beat.judgeIndex - 1 });
    beat.isDecoySpent = true;
    stirBaby(world, ctx, 'decoy');
  } else if (kind === 'stray') {
    ctx.events.push({ type: 'BeatStrayTapped', t: now });
    stirBaby(world, ctx, 'stray');
  }
}

/** Announces every note whose time has come (`BeatCued`, `DecoyCued`), whether it was tapped or not. */
function cueNotes(world: World, ctx: StepContext, step: BeatsStep, timeline: readonly BeatEntry[]) {
  const beat: BeatSlice = world.sequence.beat;
  const now = world.time.sim;
  const stepStartAt = stepStartAtOf(world, step);
  for (;;) {
    const entry = timeline[beat.cueIndex];
    if (entry === undefined || now < stepStartAt + entry.offsetMs) return;
    if (entry.kind === 'decoy') {
      ctx.events.push({ type: 'DecoyCued', t: now, entryIndex: beat.cueIndex });
    } else {
      ctx.events.push({
        type: 'BeatCued',
        t: now,
        entryIndex: beat.cueIndex,
        judgedIndex: entry.kind === 'beat' ? entry.judgedIndex : null,
      });
    }
    beat.cueIndex += 1;
  }
}

/** `beats`: the walk to the lullaby. See the file's header. */
export const BEATS_HANDLER: StepHandler<'beats'> = {
  enter(world, ctx, step) {
    const timeline = timelineOf(world, ctx);
    if (timeline === null) return;
    const { beat } = world.sequence;
    beat.isRunning = true;
    beat.cueIndex = 0;
    beat.wakePct = 0;
    moveJudgeCursor(world, ctx, step, timeline, nextJudgedEntryIndex(timeline, 0));
  },
  tick(world, ctx, step) {
    const { beat } = world.sequence;
    const timeline = timelineOf(world, ctx);
    if (!beat.isRunning || timeline === null) return;
    // 1. The taps, in order, each on its own timestamp.
    for (let i = 0; i < ctx.commands.length; i++) {
      const command = ctx.commands[i];
      if (command?.type !== 'TapBeat') continue;
      judgeTap(world, ctx, step, timeline, command.t);
      if (world.flow.state !== 'sequence') return;
    }
    // 2. The misses: a beat whose window has closed with nobody on it (`lagMs`: a stamp corrected
    // into the past reaches the sim that long after the instant it names; `LATE_TAP_GRACE_MS`: so
    // does any tap, by a frame, and a late one must find its beat still open to be a `miss`).
    const now = world.time.sim;
    for (;;) {
      const entry = timeline[beat.judgeIndex];
      if (entry === undefined || beat.nextBeatAt === null) break;
      const { windowMs, toleranceMs } = beat.responseWindow;
      const closesAt =
        beat.nextBeatAt + windowMs / 2 + toleranceMs + world.input.lagMs + LATE_TAP_GRACE_MS;
      if (now < closesAt) break;
      missBeat(world, ctx, step, timeline, entry);
      if (world.flow.state !== 'sequence') return;
    }
    // 3. The cues, on a cursor of their own.
    cueNotes(world, ctx, step, timeline);
  },
  isSettled(world) {
    const { beat } = world.sequence;
    return !beat.isRunning || beat.nextBeatAt === null;
  },
};
