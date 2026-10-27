import { asSimMs } from '@shared/time';
import type { SimCommand, ThreatInstance, World } from '@sim';
import type { Bot, BotSetup } from './bot.ts';
import { createCommandScheduler } from './commandScheduler.ts';
import { centreOf, createCycleMemory, holdMsFor, isPressable, responseOf } from './threatTiming.ts';

/**
 * Presses every threat at the centre of its window (offset 0, so `perfect` whatever the feel's
 * `perfectMs`) and lets go `tapMs` later. Created mid-window, it presses at once.
 */
export function createPerfectBot(setup: BotSetup): Bot {
  const scheduler = createCommandScheduler();
  const cycles = createCycleMemory();
  return {
    id: 'perfect',
    act(world: Readonly<World>, out: SimCommand[]) {
      const now = world.time.sim;
      for (let i = 0; i < world.threats.length; i++) {
        const threat = world.threats[i] as Readonly<ThreatInstance>;
        if (!isPressable(threat)) continue;
        const response = responseOf(setup.responses, threat.defId);
        if (response === undefined || !cycles.isNew(threat)) continue;
        const pressAt = Math.max(centreOf(threat), now);
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
