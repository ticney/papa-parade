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
 * System: the house chores (story 9.4), after the threats and before Papa. For the chore Papa works
 * at (at most one), in order:
 *
 * 1. Leaving: Papa is no longer in `chore` (a tap elsewhere, a press, a séquelle, a sequence, the baby
 *    taken: whatever moved him, `runPapa` of the previous step or a helper), so the chore is `paused`
 *    with its progress and the announced beat is dropped. A Papa still in `chore` with the baby in
 *    his arms or a sequence under way is set `idle`, then the same.
 * 2. The hold (D7): while a threat's window is open the beat is `held`, withdrawn without a
 *    judgement.
 * 3. The beat's press (D6): the `TapObject`s on the station this step are taken out of the step's
 *    commands (`runPapa` must not walk Papa to a stove he works at, nor to one he has just finished);
 *    the first one is judged by `judgePress` on its own `t`, the others are dropped. `perfect` and
 *    `success` catch the beat; `late`, and `early` under `earlyPress: "fail"`, miss it; an `early` under
 *    `guard` is ignored. At most one beat is judged per step.
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

    if (isHeld) {
      clearBeat(chore);
      chore.beatState = 'held';
    }

    let isJudged = false;
    for (let j = 0; j < ctx.commands.length; j++) {
      const command = ctx.commands[j];
      if (command?.type !== 'TapObject' || command.objectId !== objectId) continue;
      ctx.commands.splice(j, 1);
      j--;
      if (isJudged || chore.beatState !== 'telegraph') continue;
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
