import { asSimMs } from '@shared/time';
import type { SilenceSlice, SimCommand, ThreatInstance, World } from '@sim';
import type { BotResponse } from './bot.ts';
import type { CommandScheduler } from './commandScheduler.ts';

/** The middle of a threat's response window, in sim ms: where a press is `perfect`. */
export function centreOf(threat: Readonly<ThreatInstance>): number {
  return threat.windowOpenAt + (threat.responseWindow?.windowMs ?? 0) / 2;
}

/** A threat a bot may still answer: announced, its window frozen, nobody has pressed it. */
export function isPressable(threat: Readonly<ThreatInstance>): boolean {
  return (
    (threat.state === 'telegraph' || threat.state === 'windowOpen') &&
    threat.responseWindow !== null &&
    threat.press === null
  );
}

/** How a finger gives a response: down for a fixed time, or down until the threat has been answered. */
export type FingerPlan =
  | { kind: 'tap'; holdMs: number }
  | { kind: 'untilAnswered' }
  /** A `nothing` response (story 4.9): the finger stays off the threat, and no press is ever scheduled. */
  | { kind: 'none' };

/**
 * How the finger gives `response`. Exhaustive on purpose: the story that teaches the sim a new
 * response (`dodge`…) fails to typecheck here until the bots learn it. A Firmness is not
 * pre-timed: bots are not told `holdUntilMs`, and the sim resolves a held Firmness with no release,
 * so the finger stays down until the threat leaves the pressed state (story 1.23 D7).
 */
export function fingerPlanFor(response: BotResponse, tapMs: number): FingerPlan {
  switch (response) {
    case 'parry':
    case 'wait':
      return { kind: 'tap', holdMs: tapMs };
    case 'firm':
      return { kind: 'untilAnswered' };
    case 'nothing':
      return { kind: 'none' };
    default: {
      const unreachable: never = response;
      return unreachable;
    }
  }
}

/**
 * The one finger of a bot while it holds a Firmness (story 1.23 D7). `Release` names no threat, so
 * any other tap would end the hold: while one is under way the bot presses nothing else, and a
 * Firmness is never pressed before the `Release` of a tap already planned.
 */
export interface FirmHold {
  /** True from the moment a Firmness press is planned until its `Release` has been sent. */
  readonly isHolding: boolean;
  /** Sim ms when the last tap planned so far lets go (0 if none): the finger is free from then on. */
  readonly tapUntil: number;
  /** The bot has planned a tap whose `Release` falls at `releaseAt`. */
  noteTap(releaseAt: number): void;
  /** The bot has planned a press on this threat that it will hold. */
  begin(threatId: number): void;
  /**
   * Called once per `act`, before anything is planned. Pushes the `Release` (at `now`, so applied at
   * the next step) once the held threat is no longer `telegraph` / `windowOpen` with a pending press:
   * the sim has resolved or gagged it, or its press was an early or late gag.
   */
  update(threats: readonly Readonly<ThreatInstance>[], now: number, out: SimCommand[]): void;
}

export function createFirmHold(): FirmHold {
  let threatId: number | null = null;
  // False until the sim has taken the press: the press is planned ahead of its step.
  let isPressed = false;
  let tapUntil = 0;
  return {
    get isHolding() {
      return threatId !== null;
    },
    get tapUntil() {
      return tapUntil;
    },
    noteTap(releaseAt) {
      tapUntil = Math.max(tapUntil, releaseAt);
    },
    begin(id) {
      threatId = id;
      isPressed = false;
    },
    update(threats, now, out) {
      if (threatId === null) return;
      const held = threats.find((threat) => threat.id === threatId);
      const isActive =
        held !== undefined && (held.state === 'telegraph' || held.state === 'windowOpen');
      if (isActive && held.press !== null) isPressed = true;
      if (isActive && (held.press !== null || !isPressed)) return;
      out.push({ type: 'Release', t: asSimMs(now) });
      threatId = null;
      isPressed = false;
    },
  };
}

/**
 * Plans the press of `threat` at `pressAt`: a tap (press, then release `tapMs` later), or the press
 * of a Firmness, which `hold` keeps down until the threat is answered. A Firmness waits for the
 * `Release` of a tap already planned (`Release` names no threat: it would end the hold).
 */
export function schedulePress(
  scheduler: CommandScheduler,
  hold: FirmHold,
  threat: Readonly<ThreatInstance>,
  response: BotResponse,
  pressAt: number,
  tapMs: number,
): void {
  const plan = fingerPlanFor(response, tapMs);
  // A `nothing` is left alone (story 4.9): a bot never presses it, so this is a guard, not a path.
  if (plan.kind === 'none') return;
  const at = plan.kind === 'tap' ? pressAt : Math.max(pressAt, hold.tapUntil);
  scheduler.schedule({ type: 'PressThreat', t: asSimMs(at), threatId: threat.id });
  if (plan.kind === 'tap') {
    scheduler.schedule({ type: 'Release', t: asSimMs(at + plan.holdMs) });
    hold.noteTap(at + plan.holdMs);
  } else {
    hold.begin(threat.id);
  }
}

/**
 * Plans the drop of a Firmness judged on its release (story 4.8): a press at `pressAt`, early in the
 * descent, and a `Release` at `releaseAt` (at least a ms later), the instant the bot aims at the pose.
 * **Not** {@link schedulePress}'s Firmness: that one holds until the threat is answered, which here would
 * be through the pose, a `late` gag. Like a tap it only notes when the finger is free again, so a Firmness
 * of the other kind waits for it.
 */
export function scheduleDrop(
  scheduler: CommandScheduler,
  hold: FirmHold,
  threat: Readonly<ThreatInstance>,
  pressAt: number,
  releaseAt: number,
): void {
  const at = Math.max(pressAt, hold.tapUntil);
  const releaseT = Math.max(releaseAt, at + 1);
  scheduler.schedule({ type: 'PressThreat', t: asSimMs(at), threatId: threat.id });
  scheduler.schedule({ type: 'Release', t: asSimMs(releaseT) });
  hold.noteTap(releaseT);
}

/** What a bot asks of a threat def it knows, else `undefined` (the bot leaves that threat alone). */
export function responseOf(
  responses: Readonly<Record<string, BotResponse>>,
  defId: string,
): BotResponse | undefined {
  return Object.hasOwn(responses, defId) ? responses[defId] : undefined;
}

/**
 * Remembers the cycles a bot has planned an answer for. A cycle is a threat's telegraph: it is
 * named by the threat id and `windowOpenAt`, which is fixed when the threat is telegraphed and
 * differs in every new cycle. A bot never answers one cycle twice.
 */
export interface CycleMemory {
  /** True the first time it is asked about this cycle of this threat, false after. */
  isNew(threat: Readonly<ThreatInstance>): boolean;
}

export function createCycleMemory(): CycleMemory {
  const plannedWindowOpenAt = new Map<number, number>();
  return {
    isNew(threat) {
      if (plannedWindowOpenAt.get(threat.id) === threat.windowOpenAt) return false;
      plannedWindowOpenAt.set(threat.id, threat.windowOpenAt);
      return true;
    },
  };
}

/**
 * Remembers the suspicious silences (story 1.21) a bot has planned to find. A silence is named by
 * its `startedAt`, which differs in every silence. A bot taps the baby once per silence.
 */
export interface SilenceMemory {
  /** True the first time it is asked about a started silence, false after and while none has started. */
  isNew(silence: Readonly<SilenceSlice>): boolean;
}

export function createSilenceMemory(): SilenceMemory {
  let lastStartedAt: number | null = null;
  return {
    isNew(silence) {
      if (silence.startedAt === null || silence.startedAt === lastStartedAt) return false;
      lastStartedAt = silence.startedAt;
      return true;
    },
  };
}

/**
 * Whether a real wake is up (story 4.9): a threat the bot must answer is announced or open. A `nothing`
 * is not one (it is sat through), so the walk to the exit goes on during a false alarm and stops for a
 * real wake, which the bot answers by pressing it.
 */
function isAnswerUp(
  threats: readonly Readonly<ThreatInstance>[],
  responses: Readonly<Record<string, BotResponse>>,
): boolean {
  for (let i = 0; i < threats.length; i++) {
    const threat = threats[i] as Readonly<ThreatInstance>;
    if (!isPressable(threat)) continue;
    const response = responseOf(responses, threat.defId);
    if (response !== undefined && response !== 'nothing') return true;
  }
  return false;
}

/** Where Papa stood the last time the walk to the exit was sent: see {@link planStealthWalk}. */
export interface StealthWalkMemory {
  sentFromXM: number | null;
  sentFromZM: number | null;
}

export function createStealthWalkMemory(): StealthWalkMemory {
  return { sentFromXM: null, sentFromZM: null };
}

/**
 * The walk of a stealth step (story 4.9), shared by `perfect` and `human`: while it runs, Papa is
 * `idle` and no real wake is up, one `TapFloor` at the exit, stamped `now`. It follows the plain A*
 * path, so it **does creak**: no bot memorises the boards (open point 6 of the story). Nothing is sent
 * while he walks, so a step costs one command at most, and none outside a stealth step. Idle again
 * on the very point he last set off from, with no walk or glide seen since, he is as near the exit as
 * the room lets him (he waits there for an alert to end): a new tap would go nowhere, so none is sent.
 */
export function planStealthWalk(
  world: Readonly<World>,
  responses: Readonly<Record<string, BotResponse>>,
  out: SimCommand[],
  memory: StealthWalkMemory,
): void {
  const { stealth } = world.sequence;
  if (!stealth.isRunning) {
    memory.sentFromXM = null;
    memory.sentFromZM = null;
    return;
  }
  const { papa } = world;
  // A walk or a glide seen under way is a fresh start: the point he comes back to may be the same.
  if (papa.state !== 'idle') {
    memory.sentFromXM = null;
    memory.sentFromZM = null;
    return;
  }
  if (isAnswerUp(world.threats, responses)) return;
  if (memory.sentFromXM === papa.xM && memory.sentFromZM === papa.zM) return;
  memory.sentFromXM = papa.xM;
  memory.sentFromZM = papa.zM;
  out.push({
    type: 'TapFloor',
    t: asSimMs(world.time.sim),
    xM: stealth.exitXM,
    zM: stealth.exitZM,
  });
}

/**
 * How long before the next entry of a cycle is due a bot still bothers to go and put the baby down: a
 * bot's habit, not a game number. Below it, it keeps him in its arms.
 */
const CYCLE_DROP_MIN_LEAD_MS = 5000;

/** The interlude the crib was last tapped in: see {@link planCycleDrop}. */
export interface CycleDropMemory {
  sentForNextAt: number | null;
}

export function createCycleDropMemory(): CycleDropMemory {
  return { sentForNextAt: null };
}

/**
 * The cycle bot (story 4.10), shared by `perfect` and `human`: in an interlude long enough, with the
 * baby in its arms, Papa idle and nothing of the bot's to answer, one `TapFloor` at the crib. So it
 * cashes in, the base threats come, and the gather walks back for the baby. One tap per interlude,
 * whatever happens to the walk. With no cycle, or no safe spot, it does nothing: `nextAt` stays null.
 */
export function planCycleDrop(
  world: Readonly<World>,
  responses: Readonly<Record<string, BotResponse>>,
  safeSpot: { readonly xM: number; readonly zM: number } | null,
  out: SimCommand[],
  memory: CycleDropMemory,
): void {
  const { nextAt } = world.cycle;
  if (nextAt === null || safeSpot === null || world.flow.state !== 'playing') return;
  if (memory.sentForNextAt === nextAt || world.baby.state !== 'carried') return;
  if (world.papa.state !== 'idle' || isAnswerUp(world.threats, responses)) return;
  const now = world.time.sim;
  if (nextAt - now < CYCLE_DROP_MIN_LEAD_MS) return;
  memory.sentForNextAt = nextAt;
  out.push({ type: 'TapFloor', t: asSimMs(now), xM: safeSpot.xM, zM: safeSpot.zM });
}

/** A prop is not tapped twice within this long: a prop Papa cannot get to must not fill the journal (a bot's habit). */
const TIDY_RETRY_MS = 1000;

/** When the bot last tapped each prop, in sim ms, by prop id: see {@link planTidy}. */
export interface TidyMemory {
  readonly sentAtById: Map<string, number>;
}

export function createTidyMemory(): TidyMemory {
  return { sentAtById: new Map() };
}

/**
 * The tidying of the final rush (story 3.5), shared by `perfect` and `human`: in the rush, Papa idle
 * and nothing of the bot's to answer, one `TapObject` on the nearest prop that is a mess, stamped `now`.
 * `waitMs` is how long after the door opened (`flow.finalRushAt`) it starts: 0 for `perfect`, `reactionMs`
 * for `human` (nobody tidies before having seen the door open). It draws nothing from `world.rng`, and
 * does nothing outside the rush, so the games of a level without one are untouched. One command per
 * prop, then the next one when Papa is idle again; a prop it just tapped waits {@link TIDY_RETRY_MS}.
 */
export function planTidy(
  world: Readonly<World>,
  responses: Readonly<Record<string, BotResponse>>,
  out: SimCommand[],
  memory: TidyMemory,
  waitMs: number,
): void {
  const { finalRushAt } = world.flow;
  if (world.flow.state !== 'finalRush' || finalRushAt === null) return;
  const now = world.time.sim;
  if (now < finalRushAt + waitMs) return;
  const { papa } = world;
  if (papa.state !== 'idle' || isAnswerUp(world.threats, responses)) return;
  let nearestId: string | null = null;
  let nearestSq = Number.POSITIVE_INFINITY;
  for (let i = 0; i < world.props.length; i++) {
    const prop = world.props[i] as World['props'][number];
    if (!prop.isMess) continue;
    const sentAt = memory.sentAtById.get(prop.id);
    if (sentAt !== undefined && now - sentAt < TIDY_RETRY_MS) continue;
    const squared = (prop.xM - papa.xM) ** 2 + (prop.zM - papa.zM) ** 2;
    if (squared < nearestSq) {
      nearestSq = squared;
      nearestId = prop.id;
    }
  }
  if (nearestId === null) return;
  memory.sentAtById.set(nearestId, now);
  out.push({ type: 'TapObject', t: asSimMs(now), objectId: nearestId });
}
