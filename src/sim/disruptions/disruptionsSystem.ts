import type { DisruptionKind } from '@content/schemas/disruption';
import type { SimPlannedDisruption, StepContext } from '../context.ts';
import { isFlowLive } from '../flow/flowFsm.ts';
import type { DisruptionInstance, World } from '../world.ts';
import { startRinging, tickRinging } from './phone.ts';

/** What the sim does with one kind of disruption: start it, and step it while it runs. */
interface DisruptionHandler {
  start(world: World, ctx: StepContext, index: number): void;
  /** Called every step on an instance that is `ringing`. */
  tick(world: World, ctx: StepContext, index: number): void;
}

/**
 * One handler per `DisruptionKind` (story 1.20 D3), defined once at module scope: the E6 dog and
 * pot add a kind and its entry, and a kind with no handler does not compile.
 */
const HANDLERS: Readonly<Record<DisruptionKind, DisruptionHandler>> = {
  phone: { start: startRinging, tick: tickRinging },
};

/** Every disruption kind the sim has a handler for (`createSim` refuses a def of another kind). */
export const DISRUPTION_HANDLER_KINDS = Object.keys(HANDLERS) as readonly DisruptionKind[];

/**
 * System: the disruptions (story 1.20), right after the director (D4). First this step's debug
 * `StartDisruption` commands (a `pending` instance starts now, anything else is ignored), then each
 * instance in level order: `pending` and `now ≥ atMs` starts, and `ringing` steps. Nothing happens
 * once the level has ended (`runFlow` closes a phone still ringing then). During a special
 * sequence (story 4.4) a `pending` phone waits for its end and `StartDisruption` is ignored; a start is
 * refused while a phone rings (`sequenceRefusal`), so none rings during one. After a sequence a
 * `pending` phone waits `feel.sequences.resumeGapMs` more, as the director does. A disruption fires
 * at most once, draws nothing from `world.rng` itself (answering can, through the fatigue it adds,
 * see `startCall`) and is never a threat: the director neither counts nor draws it. Allocation-free.
 */
export function runDisruptions(world: World, ctx: StepContext): void {
  const planned = ctx.level.disruptions;
  if (planned.length === 0 || !isFlowLive(world)) return;
  const isPlaying = world.flow.state === 'playing';
  const { disruptions } = world;
  const now = world.time.sim;
  // The breath after a sequence: a phone due while it ran rings no earlier than this.
  const { endedAt } = world.sequence;
  const resumeAt = endedAt === null ? 0 : endedAt + ctx.feel.sequences.resumeGapMs;

  for (let i = 0; i < ctx.commands.length && isPlaying; i++) {
    const command = ctx.commands[i];
    if (command?.type !== 'StartDisruption') continue;
    const instance = disruptions[command.index];
    const entry = planned[command.index];
    if (instance === undefined || entry === undefined || instance.state !== 'pending') continue;
    HANDLERS[entry.def.kind].start(world, ctx, command.index);
  }

  for (let i = 0; i < planned.length; i++) {
    const entry = planned[i] as SimPlannedDisruption;
    const instance = disruptions[i] as DisruptionInstance;
    if (isPlaying && instance.state === 'pending' && now >= entry.atMs && now >= resumeAt) {
      HANDLERS[entry.def.kind].start(world, ctx, i);
    }
    // A disruption that just started was due at the first tick one period later: this is a no-op for it.
    if (instance.state === 'ringing') HANDLERS[entry.def.kind].tick(world, ctx, i);
  }
}
