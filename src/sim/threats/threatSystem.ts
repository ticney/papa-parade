import { asSimMs } from '@shared/time';
import type { StepContext } from '../context.ts';
import { isPapaBusy } from '../papa/papaFsm.ts';
import { classifyPress } from '../timing/classifyPress.ts';
import { judgePress } from '../timing/judge.ts';
import type { ThreatInstance, World } from '../world.ts';
import { gagThreat, openWindow, rearmThreat, resolveThreat } from './threatFsm.ts';

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
  const judgement = judgePress(t, threat.windowOpenAt, threat.responseWindow);
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
  };
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
 * resolved (or is a gag if it is the wrong one), a window nobody answered closes after the
 * tolerance, and a result is rearmed when its cooldown is over. Commands run before the expiry, so
 * a press at the very end of the tolerance, applied at the step that would expire the window, is
 * still judged on its `t`. A threat with a pending press never expires. Allocates only for a press.
 */
export function runThreats(world: World, ctx: StepContext): void {
  const now = world.time.sim;
  const { threats } = world;

  for (let i = 0; i < ctx.commands.length; i++) {
    const command = ctx.commands[i];
    if (command === undefined) continue;
    if (command.type === 'PressThreat') {
      // Busy Papa (`drink` / `asleep`, story 1.19 D6) answers nothing: a threat that opens meanwhile
      // ends in its gag (`late`), which is the cost of the coffee. `Release` still passes below.
      // At the step where `busyUntil` is reached he is awake already (`runPapa` only records it
      // later in the step), so a press then is judged, and it glides him.
      if (isPapaBusy(world.papa) && now < world.papa.busyUntil) continue;
      for (let j = 0; j < threats.length; j++) {
        const threat = threats[j] as ThreatInstance;
        if (threat.id === command.threatId) pressThreat(world, ctx, threat, j, command.t);
      }
    } else if (command.type === 'Release') {
      releasePresses(world, command.t);
    }
  }

  for (let i = 0; i < threats.length; i++) {
    const threat = threats[i] as ThreatInstance;
    const { def } = ctx.level.threats[i] as SimLevelEntry;

    // A buffered press already resolved by its release waits for the window: `WindowOpened` first,
    // then its result, in this same step.
    if (threat.state === 'telegraph' && now >= threat.windowOpenAt) openWindow(world, ctx, threat);

    const { press, responseWindow } = threat;
    if (press !== null) {
      const kind = classifyPress(press.t, press.releasedAt, now, ctx.feel.input.holdMinMs);
      if (kind !== null && threat.state === 'windowOpen') {
        if (kind === def.response) {
          resolveThreat(world, ctx, threat, def, press.quality, press.offsetMs);
        } else {
          gagThreat(world, ctx, threat, def, 'wrongResponse', press.offsetMs);
        }
      }
    } else if (
      threat.state === 'windowOpen' &&
      responseWindow !== null &&
      now > threat.windowOpenAt + responseWindow.windowMs + responseWindow.toleranceMs
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
