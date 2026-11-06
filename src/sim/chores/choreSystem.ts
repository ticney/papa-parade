import { isBabyCarried } from '../baby/babyFsm.ts';
import type { StepContext } from '../context.ts';
import { enterPapaState } from '../papa/papaFsm.ts';
import { judgePress } from '../timing/judge.ts';
import type { ChoreInstance, World } from '../world.ts';
import { enterChoreState } from './choreFsm.ts';
import { announceBeat, choreBeatCloseAt, clearBeat, isAnyThreatWindowOpen } from './chores.ts';

/** The chore stops: its beats done are kept, the announced beat is dropped without a judgement. */
function pauseChore(world: World, chore: ChoreInstance): void {
  enterChoreState(world, chore, 'paused');
  clearBeat(chore);
}

/** A missed beat (story 9.4): it does not advance, the same beat is announced again at the end of the step. */
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
 * It emits the events and writes `score.perfects` / `successes`; it never calls the catastrophe
 * gauge, which reads `ChoreBeatJudged` (D9). Draws nothing from `world.rng`.
 */
export function runChores(world: World, ctx: StepContext): void {
  const { chores } = world;
  if (chores.length === 0) return;
  const now = world.time.sim;
  const isHeld = isAnyThreatWindowOpen(world);
  for (let i = 0; i < chores.length; i++) {
    const chore = chores[i] as ChoreInstance;
    if (chore.state !== 'working') continue;
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
}
