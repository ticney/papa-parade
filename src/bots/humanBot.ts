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
  createSilenceMemory,
  holdMsFor,
  isPressable,
  responseOf,
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
  return {
    id: 'human',
    act(world: Readonly<World>, out: SimCommand[]) {
      const now = world.time.sim;
      if (silences.isNew(world.silence)) {
        const foundAt = Math.max((world.silence.startedAt as number) + reactionMs, now);
        scheduler.schedule({ type: 'TapBaby', t: asSimMs(foundAt) });
      }
      for (let i = 0; i < world.threats.length; i++) {
        const threat = world.threats[i] as Readonly<ThreatInstance>;
        if (!isPressable(threat)) continue;
        const response = responseOf(setup.responses, threat.defId);
        if (response === undefined || !cycles.isNew(threat)) continue;
        const aim = centreOf(threat) + aimOffsetMs + jitterSdMs * nextGaussian(rng);
        const reacted = threat.enteredAt + reactionMs;
        // `now` is a floor too: a command never goes into the past.
        const pressAt = Math.max(Math.round(Math.max(reacted, aim)), now);
        scheduler.schedule({ type: 'PressThreat', t: asSimMs(pressAt), threatId: threat.id });
        scheduler.schedule({
          type: 'Release',
          t: asSimMs(pressAt + holdMsFor(response, setup.settings.tapMs)),
        });
      }
      scheduler.flush(now, out);
    },
  };
}
