import type { SilenceSlice, ThreatInstance } from '@sim';
import type { BotResponse } from './bot.ts';

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

/**
 * How long a finger stays down to give `response`. Exhaustive on purpose: the story that teaches
 * the sim a new response (Firmness, `wait`…) fails to typecheck here until the bots learn it.
 */
export function holdMsFor(response: BotResponse, tapMs: number): number {
  switch (response) {
    case 'parry':
      return tapMs;
    default: {
      const unreachable: never = response;
      return unreachable;
    }
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
