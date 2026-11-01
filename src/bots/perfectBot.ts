import { asSimMs } from '@shared/time';
import type { SimCommand, ThreatInstance, World } from '@sim';
import type { Bot, BotSetup } from './bot.ts';
import { createCommandScheduler } from './commandScheduler.ts';
import {
  centreOf,
  createCycleMemory,
  createFirmHold,
  createSilenceMemory,
  createStealthWalkMemory,
  isPressable,
  planStealthWalk,
  responseOf,
  scheduleDrop,
  schedulePress,
} from './threatTiming.ts';

/**
 * Presses every threat at the centre of its window (offset 0, so `perfect` whatever the feel's
 * `perfectMs`) and lets go `tapMs` later. Created mid-window, it presses at once. It is a bot that
 * knows the answer: on a `wait` threat (story 4.6) it reads the `windowOpenAt` the sim drew at the
 * telegraph, which no player can, and presses at the centre of the window after the signal, so
 * `perfect`. On a Firmness judged on its release (story 4.8) it presses at the first step of the
 * telegraph and lets go at the centre of the window. In a stealth step (story 4.9) it walks to the exit,
 * presses a real wake at its centre like any parry, never presses a false alarm, and holds its breath
 * from the first step of the false alarm's telegraph to the end of its window (no gasp, ever).
 */
export function createPerfectBot(setup: BotSetup): Bot {
  const scheduler = createCommandScheduler();
  const cycles = createCycleMemory();
  const silences = createSilenceMemory();
  const firmHold = createFirmHold();
  const releaseDefIds = new Set(setup.releaseDefIds);
  // The false alarms whose breath is planned (story 4.9): a cycle of its own, since a `nothing` is never pressed.
  const breaths = createCycleMemory();
  // Where the walk to the exit last set off from: no new tap while Papa waits at the nearest point.
  const stealthWalk = createStealthWalkMemory();
  // The beat tapped last: `nextBeatAt` is unique per beat, so one tap per beat whatever the step.
  let lastBeatAt: number | null = null;
  return {
    id: 'perfect',
    act(world: Readonly<World>, out: SimCommand[]) {
      const now = world.time.sim;
      const { beat } = world.sequence;
      if (beat.isRunning && beat.nextBeatAt !== null && beat.nextBeatAt !== lastBeatAt) {
        lastBeatAt = beat.nextBeatAt;
        // Whole ms, like a client's stamps.
        scheduler.schedule({
          type: 'TapBeat',
          t: asSimMs(Math.max(Math.round(beat.nextBeatAt), now)),
        });
      }
      firmHold.update(world.threats, now, out);
      if (silences.isNew(world.silence)) scheduler.schedule({ type: 'TapBaby', t: asSimMs(now) });
      for (let i = 0; i < world.threats.length; i++) {
        const threat = world.threats[i] as Readonly<ThreatInstance>;
        // One finger: while a Firmness is held, no other threat is pressed (it keeps its turn).
        if (firmHold.isHolding) break;
        if (!isPressable(threat)) continue;
        const response = responseOf(setup.responses, threat.defId);
        if (response === 'nothing') {
          // A false alarm (story 4.9): never pressed. The breath is held from the first step of its
          // telegraph and let go at the very end of its window, so no gasp, ever.
          if (breaths.isNew(threat) && threat.responseWindow !== null) {
            scheduler.schedule({ type: 'HoldAnywhere', t: asSimMs(now) });
            scheduler.schedule({
              type: 'ReleaseHold',
              t: asSimMs(
                Math.max(Math.round(threat.windowOpenAt + threat.responseWindow.windowMs), now),
              ),
            });
          }
          continue;
        }
        if (response === undefined || !cycles.isNew(threat)) continue;
        if (releaseDefIds.has(threat.defId)) {
          // The bomb drop (story 4.8): it presses at the first step of the telegraph (the centre is far
          // past `pressWithinMs`) and lets go at the centre of the window: offset 0, so `perfect`.
          scheduleDrop(scheduler, firmHold, threat, now, Math.round(centreOf(threat)));
          continue;
        }
        // Whole ms, as a client's commands are (and as the human bot's are).
        const pressAt = Math.max(Math.round(centreOf(threat)), now);
        schedulePress(scheduler, firmHold, threat, response, pressAt, setup.settings.tapMs);
      }
      scheduler.flush(now, out);
      planStealthWalk(world, setup.responses, out, stealthWalk);
    },
  };
}
