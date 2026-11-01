import type { ThreatDef } from '@content/schemas/threat';
import { invariant } from '@shared/invariant';
import { asSimMs } from '@shared/time';
import { isBabyCarried } from '../baby/babyFsm.ts';
import type { StepContext } from '../context.ts';
import { isPapaBusy } from '../papa/papaFsm.ts';
import { classifyPress, pressKindOf } from '../timing/classifyPress.ts';
import type { EffectiveWindow } from '../timing/effectiveWindow.ts';
import { firmHoldOutcome, holdEndAt } from '../timing/holdEnd.ts';
import { judgePress } from '../timing/judge.ts';
import type { ThreatInstance, World } from '../world.ts';
import { gagThreat, giveFeint, openWindow, rearmThreat, resolveThreat } from './threatFsm.ts';

type SimLevelEntry = StepContext['level']['threats'][number];

/** A press on a threat that is `telegraph` or `windowOpen`, judged on its own `t` (never on the step's). */
function pressThreat(
  world: World,
  ctx: StepContext,
  threat: ThreatInstance,
  index: number,
  t: number,
): void {
  if (threat.state !== 'telegraph' && threat.state !== 'windowOpen') return;
  if (threat.press !== null || threat.responseWindow === null) return;
  const def = (ctx.level.threats[index] as SimLevelEntry).def;
  if (def.response === 'nothing') {
    // Aimed at a threat the player was to leave alone (story 4.9): a gag, whatever `earlyPress` says,
    // up to the end of the stretch, judged on the press's own `t`. Later than that it is nothing:
    // the verdict is a success, and `threat.press` stays null, always.
    if (t < threat.windowOpenAt + threat.responseWindow.windowMs) {
      gagThreat(world, ctx, threat, def, 'acted', null);
    }
    return;
  }
  const judgement = judgePress(t, threat.windowOpenAt, threat.responseWindow);
  if (def.release !== undefined) {
    // A Firmness judged on its release (story 4.8): the press only has to come within `pressWithinMs` of
    // the telegraph, the release is what is judged. The deadline is `pressWithinMs` plus the tolerance,
    // which the schema keeps below the descent only by `pressWithinMs`: past it, or in `windowOpen`,
    // the press is `late`. `earlyPress` is not read.
    const deadline =
      threat.enteredAt + def.release.pressWithinMs + threat.responseWindow.toleranceMs;
    if (threat.state === 'telegraph' && t <= deadline) {
      threat.press = {
        t: asSimMs(t),
        quality: 'success',
        offsetMs: 0,
        releasedAt: null,
        heldAt: null,
      };
    } else {
      gagThreat(world, ctx, threat, def, 'late', judgement.offsetMs);
    }
    return;
  }
  if (def.response === 'wait' && t < threat.windowOpenAt) {
    // Before the signal (story 4.6, D2): a press cannot be a reaction to it, so no buffer, no
    // tolerance and no `earlyPress` choice. Judged on the press's own `t`.
    gagThreat(world, ctx, threat, def, 'early', judgement.offsetMs);
    return;
  }
  if (judgement.quality === 'early') {
    // `guard`: Papa has already set off (the glide is his system's); only a new press in the window counts.
    if (ctx.feel.input.earlyPress === 'fail') {
      gagThreat(world, ctx, threat, def, 'early', judgement.offsetMs);
    }
    return;
  }
  if (judgement.quality === 'late') {
    gagThreat(world, ctx, threat, def, 'late', judgement.offsetMs);
    return;
  }
  threat.press = {
    t: asSimMs(t),
    quality: judgement.quality,
    offsetMs: judgement.offsetMs,
    releasedAt: null,
    heldAt: null,
  };
}

/**
 * The judgement of a Firmness with a `release` (story 4.8), on the release's own `t`: too early is a
 * `released` gag (a quick tap is that, not a `wrongResponse`), after the window a `late` one, else a
 * response. A release in the tolerance before the pose waits for the window to open, so
 * `WindowOpened` comes first. With no release the hold is never kept: past the window it is `late`
 * (`firmHoldOutcome` must not run here, it would resolve a hold through the pose).
 */
function judgeRelease(
  world: World,
  ctx: StepContext,
  threat: ThreatInstance,
  def: ThreatDef,
  press: NonNullable<ThreatInstance['press']>,
  response: EffectiveWindow,
): void {
  if (press.releasedAt === null) {
    const closesAt = threat.windowOpenAt + response.windowMs + response.toleranceMs;
    if (threat.state === 'windowOpen' && world.time.sim > closesAt + world.input.lagMs) {
      gagThreat(world, ctx, threat, def, 'late', null);
    }
    return;
  }
  const judgement = judgePress(press.releasedAt, threat.windowOpenAt, response);
  if (judgement.quality === 'early') {
    gagThreat(world, ctx, threat, def, 'released', judgement.offsetMs);
  } else if (threat.state !== 'windowOpen') {
    return;
  } else if (judgement.quality === 'late') {
    gagThreat(world, ctx, threat, def, 'late', judgement.offsetMs);
  } else {
    resolveThreat(world, ctx, threat, def, judgement.quality, judgement.offsetMs);
  }
}

/** A release ends every press made before it. It names no threat. */
function releasePresses(world: World, t: number): void {
  for (let i = 0; i < world.threats.length; i++) {
    const press = (world.threats[i] as ThreatInstance).press;
    if (press !== null && press.releasedAt === null && press.t <= t) press.releasedAt = asSimMs(t);
  }
}

/**
 * System: the threats. First this step's `PressThreat` and `Release` commands, in order; then each
 * instance in level order: the window opens at `windowOpenAt`, a press whose type is known is
 * resolved (or is a gag if it is the wrong one; a Firmness waits for the end of the attack, and a
 * press that reaches `holdMinMs` emits `ResponseHeld` once), a window nobody answered closes after the
 * tolerance, and a result is rearmed when its cooldown is over. Commands run before the expiry, so
 * a press at the very end of the tolerance, applied at the step that would expire the window, is
 * still judged on its `t`. A threat with a pending press never expires. Allocates only for a press.
 */
export function runThreats(world: World, ctx: StepContext): void {
  const now = world.time.sim;
  const { threats } = world;
  // The client corrects every stamp into the past by this much (story 2.7 D1): what the sim decides
  // from the absence of a command waits for it, so the late edge of a press can still arrive.
  const { lagMs } = world.input;

  for (let i = 0; i < ctx.commands.length; i++) {
    const command = ctx.commands[i];
    if (command === undefined) continue;
    if (command.type === 'PressThreat') {
      // Busy Papa (`drink` / `asleep` / `onPhone` / `onToilet`, stories 1.19 D6, 4.3) answers nothing: a threat that opens meanwhile
      // ends in its gag (`late`), which is the cost of the coffee. `Release` still passes below.
      // At the step where `busyUntil` is reached he is awake already (`runPapa` only records it
      // later in the step), so a press then is judged, and it glides him.
      if (isPapaBusy(world.papa) && now < world.papa.busyUntil) continue;
      for (let j = 0; j < threats.length; j++) {
        const threat = threats[j] as ThreatInstance;
        if (threat.id === command.threatId) pressThreat(world, ctx, threat, j, command.t);
      }
    } else if (command.type === 'TapBaby') {
      // A tap on the baby aims at him, so it « vise » every `nothing` threat on him (story 4.9): the
      // same branch as a press on it, on the command's own `t`. No other def is touched. Busy Papa
      // answers nothing, as for a `PressThreat`.
      if (isPapaBusy(world.papa) && now < world.papa.busyUntil) continue;
      for (let j = 0; j < threats.length; j++) {
        const { def } = ctx.level.threats[j] as SimLevelEntry;
        if (def.response === 'nothing' && def.target === 'baby') {
          pressThreat(world, ctx, threats[j] as ThreatInstance, j, command.t);
        }
      }
    } else if (command.type === 'Release') {
      releasePresses(world, command.t);
    }
  }

  for (let i = 0; i < threats.length; i++) {
    const threat = threats[i] as ThreatInstance;
    const { def } = ctx.level.threats[i] as SimLevelEntry;

    // The feint (story 4.7) is before the signal, so before the window: a press in this same step has
    // already made it a gag (commands run first), and no feint comes then.
    if (
      threat.state === 'telegraph' &&
      threat.feintAt !== null &&
      !threat.isFeintGiven &&
      now >= threat.feintAt
    ) {
      giveFeint(world, ctx, threat);
    }

    // A buffered press already resolved by its release waits for the window: `WindowOpened` first,
    // then its result, in this same step.
    if (threat.state === 'telegraph' && now >= threat.windowOpenAt) {
      openWindow(world, ctx, threat, def);
    }

    if (def.response === 'nothing') {
      // Nobody acted on it (a command aimed at it has gagged it already): once the stretch is over, and
      // the late edge of a press stamped before its end could no longer arrive, the player sat it
      // through. Decided from an absence, so it waits for `lagMs`. Never `perfect`; never `late`.
      if (
        threat.state === 'windowOpen' &&
        threat.responseWindow !== null &&
        now >= threat.windowOpenAt + threat.responseWindow.windowMs + lagMs
      ) {
        resolveThreat(world, ctx, threat, def, 'success', 0);
      } else if (
        (threat.state === 'resolved' || threat.state === 'gag') &&
        now >= threat.enteredAt + def.cooldownMs
      ) {
        rearmThreat(world, ctx, threat);
      }
      continue;
    }

    const { press, responseWindow } = threat;
    if (press !== null) {
      const { holdMinMs } = ctx.feel.input;
      // Once the ring has closed (`heldAt`), the press is a Firmness for good: raising `holdMinMs`
      // meanwhile (a `SetFeel`) must not turn its release into a Parry.
      const kind =
        press.heldAt !== null
          ? 'firm'
          : classifyPress(press.t, press.releasedAt, now, holdMinMs, lagMs);
      // The ring closes once per press, as soon as it has been held `holdMinMs`, before any result.
      if (kind === 'firm' && press.heldAt === null) {
        press.heldAt = asSimMs(now);
        ctx.events.push({ type: 'ResponseHeld', t: asSimMs(now), threatId: threat.id });
      }
      if (def.release !== undefined) {
        // Before the carried Firmness rule below: laying the baby down takes both hands, and is the
        // one Firmness that is meant to be held in the arms (story 4.8).
        if (responseWindow !== null) judgeRelease(world, ctx, threat, def, press, responseWindow);
      } else if (kind !== null && threat.state === 'windowOpen') {
        if (def.response === 'firm' && kind === 'firm' && isBabyCarried(world)) {
          // Papa has one hand left (story 4.1): he cannot hold with Firmness while carrying.
          gagThreat(world, ctx, threat, def, 'wrongResponse', press.offsetMs);
        } else if (def.response === 'firm' && kind === 'firm') {
          // A Firmness is held to the end of the attack: the hold alone resolves it, no release needed.
          // The schema ties `holdUntilMs` to `response: 'firm'`; a def that skipped it must not play.
          invariant(def.holdUntilMs !== undefined, `firm threat ${def.id} has no holdUntilMs`);
          const endAt = holdEndAt(press.t, threat.windowOpenAt, def.holdUntilMs, holdMinMs);
          // With no release yet, the hold is kept only once the release could no longer arrive.
          const outcome = firmHoldOutcome(press.t, press.releasedAt, endAt, now - lagMs);
          if (outcome === 'held') {
            resolveThreat(world, ctx, threat, def, press.quality, press.offsetMs);
          } else if (outcome === 'released') {
            gagThreat(world, ctx, threat, def, 'released', press.offsetMs);
          }
        } else if (kind === pressKindOf(def.response)) {
          resolveThreat(world, ctx, threat, def, press.quality, press.offsetMs);
        } else {
          gagThreat(world, ctx, threat, def, 'wrongResponse', press.offsetMs);
        }
      }
    } else if (
      def.release !== undefined &&
      threat.state === 'telegraph' &&
      responseWindow !== null &&
      now > threat.enteredAt + def.release.pressWithinMs + responseWindow.toleranceMs + lagMs
    ) {
      // Nobody pressed within `pressWithinMs` of the telegraph: the baby is never laid (story 4.8).
      gagThreat(world, ctx, threat, def, 'late', null);
    } else if (
      threat.state === 'windowOpen' &&
      responseWindow !== null &&
      now > threat.windowOpenAt + responseWindow.windowMs + responseWindow.toleranceMs + lagMs
    ) {
      gagThreat(world, ctx, threat, def, 'late', null);
    } else if (
      (threat.state === 'resolved' || threat.state === 'gag') &&
      now >= threat.enteredAt + def.cooldownMs
    ) {
      rearmThreat(world, ctx, threat);
    }
  }
}
