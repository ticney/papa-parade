import { STEP_MS } from '@shared/constants';
import { createRng } from '@shared/rng';
import { asSimMs } from '@shared/time';
import type { SimCommand, ThreatInstance, World } from '@sim';
import type { Bot, BotSetup } from './bot.ts';
import { botSeed } from './botSeed.ts';
import { createCommandScheduler } from './commandScheduler.ts';
import { nextGaussian } from './gaussian.ts';
import {
  centreOf,
  createCycleMemory,
  createFirmHold,
  createSilenceMemory,
  isPressable,
  responseOf,
  schedulePress,
} from './threatTiming.ts';

/**
 * A plausible attentive player. When it first sees a telegraph it plans one press at
 * `max(telegraph + reactionMs, centre + aimOffsetMs + jitterSdMs × N(0, 1))`, in whole ms: the
 * reaction time is a floor (nobody presses before having seen the telegraph), the jitter is the
 * spread around the instant it aims at. A press that lands outside the window is a gag, as for a
 * player. It finds the baby of a suspicious silence (story 1.21) `reactionMs` after the silence
 * started, once per silence.
 */
export function createHumanBot(setup: BotSetup): Bot {
  const { reactionMs, aimOffsetMs, jitterSdMs } = setup.settings.human;
  const rng = createRng(botSeed(setup.seed));
  const scheduler = createCommandScheduler();
  const cycles = createCycleMemory();
  const silences = createSilenceMemory();
  const firmHold = createFirmHold();
  // The tap that finds the baby, planned for one silence only: it is dropped if that silence ends first.
  let find: { startedAt: number; atMs: number } | null = null;
  return {
    id: 'human',
    act(world: Readonly<World>, out: SimCommand[]) {
      const now = world.time.sim;
      const { startedAt } = world.silence;
      if (startedAt !== null && silences.isNew(world.silence)) {
        find = { startedAt, atMs: Math.max(startedAt + reactionMs, now) };
      }
      if (find !== null) {
        if (startedAt !== find.startedAt) {
          find = null; // the silence ended (found, timed out, level over) before the bot got to it
        } else if (find.atMs < now + STEP_MS) {
          out.push({ type: 'TapBaby', t: asSimMs(find.atMs) });
          find = null;
        }
      }
      firmHold.update(world.threats, now, out);
      for (let i = 0; i < world.threats.length; i++) {
        const threat = world.threats[i] as Readonly<ThreatInstance>;
        // One finger: while a Firmness is held, no other threat is pressed (it keeps its turn).
        if (firmHold.isHolding) break;
        if (!isPressable(threat)) continue;
        const response = responseOf(setup.responses, threat.defId);
        if (response === undefined || !cycles.isNew(threat)) continue;
        const aim = centreOf(threat) + aimOffsetMs + jitterSdMs * nextGaussian(rng);
        const reacted = threat.enteredAt + reactionMs;
        // `now` is a floor too: a command never goes into the past.
        const pressAt = Math.max(Math.round(Math.max(reacted, aim)), now);
        schedulePress(scheduler, firmHold, threat, response, pressAt, setup.settings.tapMs);
      }
      scheduler.flush(now, out);
    },
  };
}
