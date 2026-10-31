import { asSimMs } from '@shared/time';
import type { SilenceSlice, SimCommand, ThreatInstance } from '@sim';
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
export type FingerPlan = { kind: 'tap'; holdMs: number } | { kind: 'untilAnswered' };

/**
 * How the finger gives `response`. Exhaustive on purpose: the story that teaches the sim a new
 * response (`nothing`…) fails to typecheck here until the bots learn it. A Firmness is not
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
  const at = plan.kind === 'tap' ? pressAt : Math.max(pressAt, hold.tapUntil);
  scheduler.schedule({ type: 'PressThreat', t: asSimMs(at), threatId: threat.id });
  if (plan.kind === 'tap') {
    scheduler.schedule({ type: 'Release', t: asSimMs(at + plan.holdMs) });
    hold.noteTap(at + plan.holdMs);
  } else {
    hold.begin(threat.id);
  }
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
