import { asSimMs } from '@shared/time';
import type { SimCommand, ThreatInstance, World } from '@sim';
import type { Bot, BotSetup } from './bot.ts';
import { createCommandScheduler } from './commandScheduler.ts';
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
 * Presses every threat at the centre of its window (offset 0, so `perfect` whatever the feel's
 * `perfectMs`) and lets go `tapMs` later. Created mid-window, it presses at once.
 */
export function createPerfectBot(setup: BotSetup): Bot {
  const scheduler = createCommandScheduler();
  const cycles = createCycleMemory();
  const silences = createSilenceMemory();
  const firmHold = createFirmHold();
  return {
    id: 'perfect',
    act(world: Readonly<World>, out: SimCommand[]) {
      const now = world.time.sim;
      firmHold.update(world.threats, now, out);
      if (silences.isNew(world.silence)) scheduler.schedule({ type: 'TapBaby', t: asSimMs(now) });
      for (let i = 0; i < world.threats.length; i++) {
        const threat = world.threats[i] as Readonly<ThreatInstance>;
        // One finger: while a Firmness is held, no other threat is pressed (it keeps its turn).
        if (firmHold.isHolding) break;
        if (!isPressable(threat)) continue;
        const response = responseOf(setup.responses, threat.defId);
        if (response === undefined || !cycles.isNew(threat)) continue;
        // Whole ms, as a client's commands are (and as the human bot's are).
        const pressAt = Math.max(Math.round(centreOf(threat)), now);
        schedulePress(scheduler, firmHold, threat, response, pressAt, setup.settings.tapMs);
      }
      scheduler.flush(now, out);
    },
  };
}
