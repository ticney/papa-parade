import { MS_PER_S, STEP_MS } from '@shared/constants';
import { createRng, nextFloat, nextInt } from '@shared/rng';
import { asSimMs } from '@shared/time';
import type { SimCommand, World } from '@sim';
import type { Bot, BotSetup } from './bot.ts';
import { botSeed } from './botSeed.ts';
import { createCommandScheduler } from './commandScheduler.ts';

const TWO_PI = 2 * Math.PI;

/**
 * A fuzzer, not a player. Each step, with probability `actionsPerSec × STEP_MS / 1000`, it does one
 * action drawn uniformly: tap the floor near Papa, push in a random direction, stop, or press a
 * threat of any state (the sim ignores one that is idle) and let go after a random hold, up to
 * `maxHoldMs`, which is above `holdMinMs` so that it also produces Firmness. At most one finger
 * down at a time. It exercises every command with strict invariants on; it does not try to win.
 */
export function createRandomBot(setup: BotSetup): Bot {
  const { actionsPerSec, floorReachM, maxHoldMs } = setup.settings.random;
  const chancePerStep = (actionsPerSec * STEP_MS) / MS_PER_S;
  const rng = createRng(botSeed(setup.seed));
  const scheduler = createCommandScheduler();
  return {
    id: 'random',
    act(world: Readonly<World>, out: SimCommand[]) {
      const now = world.time.sim;
      // A planned command means a finger is down (or about to be): nothing new until it is up.
      if (scheduler.size === 0 && nextFloat(rng) < chancePerStep) {
        const kind = nextInt(rng, 0, 4);
        const t = asSimMs(now + nextInt(rng, 0, STEP_MS));
        if (kind === 0) {
          // Uniform in the disc around Papa; the sim snaps the point to the floor.
          const angle = nextFloat(rng) * TWO_PI;
          const radius = floorReachM * Math.sqrt(nextFloat(rng));
          scheduler.schedule({
            type: 'TapFloor',
            t,
            xM: world.papa.xM + radius * Math.cos(angle),
            zM: world.papa.zM + radius * Math.sin(angle),
          });
        } else if (kind === 1) {
          const angle = nextFloat(rng) * TWO_PI;
          const dirX = Math.cos(angle);
          const dirZ = Math.sin(angle);
          scheduler.schedule({ type: 'Move', t, dirX, dirZ });
        } else if (kind === 2) {
          scheduler.schedule({ type: 'MoveStop', t });
        } else if (world.threats.length > 0) {
          const threat = world.threats[nextInt(rng, 0, world.threats.length)];
          if (threat !== undefined) {
            const holdMs = Math.round(nextFloat(rng) * maxHoldMs);
            scheduler.schedule({ type: 'PressThreat', t, threatId: threat.id });
            scheduler.schedule({ type: 'Release', t: asSimMs(t + holdMs) });
          }
        }
      }
      scheduler.flush(now, out);
    },
  };
}
