import { isBabyCarried, isSilenceUnderway } from '../baby/babyFsm.ts';
import type { StepContext } from '../context.ts';
import { fairWindowOpenAt } from '../director/fairness.ts';
import { enterPapaState, isPapaBusy } from '../papa/papaFsm.ts';
import { isJudgeableBeforeEnd } from '../threats/judgeable.ts';
import { telegraphThreat } from '../threats/threatFsm.ts';
import { judgePress } from '../timing/judge.ts';
import type { ChoreInstance, World } from '../world.ts';
import { enterChoreState } from './choreFsm.ts';
import {
  announceBeat,
  choreBeatCloseAt,
  clearBeat,
  isAnyThreatWindowOpen,
  isChoreThreatActive,
  openThreatOf,
  pauseChore,
  potOf,
} from './chores.ts';

/**
 * A missed beat (story 9.4): it does not advance, the same beat is announced again at the end of the
 * step. It is counted (`beatsMissed`, story 9.6): a def with `missBrokenObjects` breaks that many objects
 * for each one.
 */
function missBeat(
  world: World,
  ctx: StepContext,
  choreIndex: number,
  reason: 'early' | 'late',
  offsetMs: number | null,
): void {
  const chore = world.chores[choreIndex] as ChoreInstance;
  ctx.events.push({
    type: 'ChoreBeatJudged',
    t: world.time.sim,
    choreIndex,
    beatIndex: chore.beatsDone,
    quality: 'fail',
    reason,
    offsetMs,
  });
  chore.beatsMissed += 1;
  clearBeat(chore);
}

/**
 * A beat caught (story 9.4): the chore moves on to the next beat, or is done. A beat counts as a
 * parry for Rire (D8) and for nothing else: no combo, no instinct, no hitstop, no slow-mo.
 */
function catchBeat(
  world: World,
  ctx: StepContext,
  choreIndex: number,
  quality: 'perfect' | 'success',
  offsetMs: number,
): void {
  const chore = world.chores[choreIndex] as ChoreInstance;
  const { def } = ctx.level.chores[choreIndex] as StepContext['level']['chores'][number];
  ctx.events.push({
    type: 'ChoreBeatJudged',
    t: world.time.sim,
    choreIndex,
    beatIndex: chore.beatsDone,
    quality,
    reason: null,
    offsetMs,
  });
  if (quality === 'perfect') world.score.perfects += 1;
  else world.score.successes += 1;
  chore.beatsDone += 1;
  clearBeat(chore);
  if (chore.beatsDone < def.beats.length) return;
  enterChoreState(world, chore, 'done');
  // Papa closes the emptied dishwasher (story 9.6): a done chore is no target of the baby.
  chore.isOpen = false;
  ctx.events.push({
    type: 'ChoreCompleted',
    t: world.time.sim,
    choreIndex,
    homePoints: def.homePoints,
  });
  enterPapaState(world, ctx, 'idle');
}

/**
 * System: the chores that Papa left in this step (story 9.4, review). `runChores` runs before
 * `runPapa`, so a command that moves Papa (a tap on the floor, a press that makes him glide, the baby
 * taken) leaves him out of `chore` after it ran: this one, right after `runPapa`, pauses the chore in
 * the same step, so that `working` ⇔ `papa.state === 'chore'` holds at the end of every step (the
 * snapshot's rule) and the client never sees a beat of a chore Papa has left. The other writers of
 * Papa's state (a séquelle, a sequence) run before `runChores`, which pauses them itself.
 */
export function settleChores(world: World): void {
  const { chores } = world;
  if (chores.length === 0 || world.papa.state === 'chore') return;
  for (let i = 0; i < chores.length; i++) {
    const chore = chores[i] as ChoreInstance;
    if (chore.state === 'working') pauseChore(world, chore);
  }
}

/**
 * System: the house chores (story 9.4), after the threats and before Papa. For the chore Papa works
 * at (at most one), in order:
 *
 * 1. Leaving: Papa is no longer in `chore` (a tap elsewhere, a press, a séquelle, a sequence, the baby
 *    taken: whatever moved him, `runPapa` of the previous step or a helper), so the chore is `paused`
 *    with its progress and the announced beat is dropped. A Papa still in `chore` with the baby in
 *    his arms or a sequence under way is set `idle`, then the same.
 * 2. The beat's press (D6): the `TapObject`s on the station this step are taken out of the step's
 *    commands (`runPapa` must not walk Papa to a stove he works at, nor to one he has just finished);
 *    the first one is judged by `judgePress` on its own `t`, the others are dropped. `perfect` and
 *    `success` catch the beat; `late`, and `early` under `earlyPress: "fail"`, miss it; an `early` under
 *    `guard` is ignored. At most one beat is judged per step. A press stamped before the beat was
 *    announced is dropped unjudged. The taps are judged first, against the beat as it stood.
 * 3. The hold (D7): while a threat's window is open the beat is `held`, withdrawn without a
 *    judgement (after the taps of the step, so that a tap made inside the window still counts).
 * 4. The silence: no tap by `closeAt + lagMs` is a `late` miss.
 * 5. A beat that is not announced is, unless a threat's window is open: the next one after a catch, the
 *    same one after a miss or a hold.
 *
 * 6. The pot (story 9.5): a chore that Papa left `paused` for `afterMs` starts its pot
 *    ({@link startAbandonedPots}), after the loop, so that a chore Papa has just left is seen as paused.
 *
 * The hold of rule 3 extends (D6) to the chore's own threats: while its pot (story 9.5) or the baby's
 * open-door threat (story 9.6) is telegraphed or its window is open, the beat is `held`, so the cooking
 * cannot be finished with the pot still on, nor the dishwasher emptied with the baby heading for it.
 *
 * The door (story 9.6): before everything else, for every chore whatever its state, a chore whose
 * open-door threat was caught in this step (`resolved`, entered now: only a perfect or a success gets
 * there) has its door shut: `isOpen` false. A gag, a cancellation and a cooldown leave it as it is.
 *
 * It emits the events and writes `score.perfects` / `successes`; it never calls the catastrophe
 * gauge, which reads `ChoreBeatJudged` (D9). Draws nothing from `world.rng`.
 */
export function runChores(world: World, ctx: StepContext): void {
  const { chores } = world;
  if (chores.length === 0) return;
  const now = world.time.sim;
  const isWindowOpen = isAnyThreatWindowOpen(world);
  for (let i = 0; i < chores.length; i++) {
    const chore = chores[i] as ChoreInstance;
    // The open dishwasher caught in this step shuts its door, even when Papa is not working there: the
    // chore is usually `paused` by then (the press made him glide away).
    const openThreat = openThreatOf(world, ctx, i);
    if (openThreat?.state === 'resolved' && openThreat.enteredAt === now) chore.isOpen = false;
    if (chore.state !== 'working') continue;
    const isHeld = isWindowOpen || isChoreThreatActive(world, ctx, i);
    const { objectId } = ctx.level.chores[i] as StepContext['level']['chores'][number];
    if (world.papa.state === 'chore' && (isBabyCarried(world) || world.flow.state === 'sequence')) {
      enterPapaState(world, ctx, 'idle');
    }
    if (world.papa.state !== 'chore') {
      pauseChore(world, chore);
      continue;
    }

    // The taps are judged against the beat as it stood when they were made, so before the hold below
    // withdraws it: a tap made inside the window is not lost because a threat's window opens this step.
    let isJudged = false;
    for (let j = 0; j < ctx.commands.length; j++) {
      const command = ctx.commands[j];
      if (command?.type !== 'TapObject' || command.objectId !== objectId) continue;
      ctx.commands.splice(j, 1);
      j--;
      if (isJudged || chore.beatState !== 'telegraph') continue;
      // A press stamped before the beat was announced (input lag, a tap made while Papa glided) cannot
      // be an answer to it: it is neither a catch nor an `early` miss.
      if (command.t < chore.beatTelegraphAt) continue;
      const judgement = judgePress(command.t, chore.beatWindowOpenAt, chore.responseWindow);
      if (judgement.quality === 'early') {
        // `guard`: the player pressed too soon and only a new press in the window counts.
        if (ctx.feel.input.earlyPress === 'fail') {
          missBeat(world, ctx, i, 'early', judgement.offsetMs);
          isJudged = true;
        }
      } else if (judgement.quality === 'late') {
        missBeat(world, ctx, i, 'late', judgement.offsetMs);
        isJudged = true;
      } else {
        catchBeat(world, ctx, i, judgement.quality, judgement.offsetMs);
        isJudged = true;
      }
    }

    if (isHeld && chore.state === 'working') {
      clearBeat(chore);
      chore.beatState = 'held';
    }

    if (
      !isJudged &&
      chore.beatState === 'telegraph' &&
      now > choreBeatCloseAt(chore) + world.input.lagMs
    ) {
      missBeat(world, ctx, i, 'late', null);
    }

    if (chore.state === 'working' && chore.beatState !== 'telegraph' && !isHeld) {
      announceBeat(world, ctx, i);
    }
  }
  startAbandonedPots(world, ctx);
}

/**
 * A chore left alone becomes a threat (story 9.5): for each `paused` chore that names an
 * `abandonedThreat`, the pot is telegraphed in the first step where all of this holds: its instance
 * is `idle`, `afterMs` have passed since the latest of the chore being paused, the pot last going
 * `idle` and the flow last becoming `playing` (D4: no world field, the next pot is due `afterMs` after
 * the last one is over; review: the time of a sequence, when Papa could not come back, is not
 * counted), the flow is `playing`, no silence is under way (review: the director's rule, the search
 * is the one occupation it keeps clear), Papa is not busy and not on his way to this station, and the
 * pot could still be judged before the level ends. Its window opens no closer than the fairness
 * spacing to another one (D5, `fairWindowOpenAt`), the director's rule. Draws nothing from `world.rng`.
 */
function startAbandonedPots(world: World, ctx: StepContext): void {
  if (world.flow.state !== 'playing' || isPapaBusy(world.papa) || isSilenceUnderway(world)) return;
  const { chores, papa } = world;
  const now = world.time.sim;
  for (let i = 0; i < chores.length; i++) {
    const chore = chores[i] as ChoreInstance;
    const planned = ctx.level.chores[i] as StepContext['level']['chores'][number];
    const { abandoned } = planned;
    if (abandoned === null || chore.state !== 'paused') continue;
    const pot = potOf(world, ctx, i);
    const potDef = ctx.level.threats[abandoned.threatIndex]?.def;
    if (pot === undefined || potDef === undefined || pot.state !== 'idle') continue;
    const since = Math.max(chore.enteredAt, pot.enteredAt, world.flow.enteredAt);
    if (now < since + abandoned.afterMs) continue;
    // Papa is already on his way to this stove: he is coming back to the cooking.
    if (
      papa.state === 'glide' &&
      papa.glide?.threatId === null &&
      papa.objectId === planned.objectId
    ) {
      continue;
    }
    const delayMs = potDef.telegraphDelayMs ?? ctx.feel.timing.telegraphDelayDefaultMs;
    const naturalAt = now + delayMs;
    const postponeMs = fairWindowOpenAt(world, ctx, abandoned.threatIndex, naturalAt) - naturalAt;
    if (!isJudgeableBeforeEnd(world, ctx, potDef, now + Math.max(0, postponeMs))) continue;
    telegraphThreat(world, ctx, pot, potDef, -1, Math.max(0, postponeMs));
  }
}
