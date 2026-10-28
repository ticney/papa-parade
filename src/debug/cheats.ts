import type { TestHost } from '@client/app/testHost';
import { DEBUG_SKIP_CHUNK_STEPS, GAUGE_MAX_POINTS, MIN_TIME_SCALE } from '@shared/constants';
import { log } from '@shared/log';
import { asSimMs } from '@shared/time';
import type { SimCommand, World } from '@sim';

/**
 * What a cheat may do: send a command to the running sim (stamped with its current time), or ask
 * the level session for something. Never write the world: a cheat that changes the game is a
 * command, so it is journaled and replays (story 2.1, D12).
 */
export interface CheatContext {
  readonly host: TestHost;
  /** Enqueues `command` at the running sim's current time; false when no level is running. */
  send(command: DistributiveOmitT<SimCommand>): boolean;
}

/** `Omit<T, 't'>` that keeps a union apart. */
type DistributiveOmitT<T> = T extends { t: unknown } ? Omit<T, 't'> : never;

/** One thing the overlay's cheat list offers. The list is data so that a story adds an entry (4.4: the sequence launcher). */
export interface Cheat {
  readonly id: string;
  readonly label: string;
  /** The cheat has a number to give: `[min, max]` and its starting value, or `null` for a plain button. */
  readonly input: { readonly min: number; readonly max: number; readonly start: number } | null;
  /** Whether it makes sense in this level now (« set fatigue » needs a fatigue gauge). */
  isAvailable(world: Readonly<World>, hasFatigue: boolean): boolean;
  run(context: CheatContext, value: number): void;
}

/** The threats of the running level that can be launched: `{ id, label }` per planned threat. */
export function launchableThreats(world: Readonly<World>): { id: number; label: string }[] {
  return world.threats.map((threat) => ({
    id: threat.id,
    label: `${threat.defId} @ ${threat.anchorId} (${threat.state})`,
  }));
}

/** The cheats that are not « launch a threat » (that one has a list: see {@link launchableThreats}). */
export const CHEATS: readonly Cheat[] = [
  {
    id: 'setFatigue',
    label: 'Set fatigue',
    input: { min: 0, max: GAUGE_MAX_POINTS, start: GAUGE_MAX_POINTS / 2 },
    isAvailable: (_world, hasFatigue) => hasFatigue,
    run: (context, value) => {
      context.send({ type: 'SetFatigue', points: value });
    },
  },
];

/** The scale a forced `timeScale` sends: the value held in the sim's own range. */
export function clampTimeScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(1, Math.max(MIN_TIME_SCALE, scale));
}

/**
 * The context a cheat runs in: commands go to the sim of the level now running, at its sim time.
 */
export function createCheatContext(host: TestHost): CheatContext {
  return {
    host,
    send(command) {
      const active = host.levelSession.active;
      if (active === null) return false;
      active.sim.enqueue({
        ...command,
        t: asSimMs(active.sim.world.time.sim),
      } as SimCommand);
      return true;
    },
  };
}

/** Sends `ForceThreat` for the threat `threatId`: the director picks it now (a hidden-zone one needs a free baby). */
export function launchThreat(context: CheatContext, threatId: number): boolean {
  return context.send({ type: 'ForceThreat', threatId });
}

export interface SkipToEnd {
  /** Starts running chunks of steps each frame until the level ends. A second call while running does nothing. */
  start(): void;
  /** Stops after the current chunk. */
  cancel(): void;
  readonly isRunning: boolean;
}

/**
 * « Skip to the end » (story 2.1, D12): runs the level through `levelSession.advance`, in chunks of
 * `DEBUG_SKIP_CHUNK_STEPS` steps per frame so the page stays alive, until the sim says the level has
 * ended (`world.flow.state`). The steps are real steps (the end is scored as played, the journal is
 * honest); nothing is written to the world. It stops by itself if the level goes away.
 * `requestFrame` is `requestAnimationFrame`, injected so that a test can step it.
 */
export function createSkipToEnd(
  host: TestHost,
  requestFrame: (callback: () => void) => unknown,
): SkipToEnd {
  let isRunning = false;
  let runId = 0;
  const frame = (mine: number): void => {
    if (!isRunning || mine !== runId) return;
    const active = host.levelSession.active;
    if (active === null || active.sim.world.flow.state === 'ended') {
      isRunning = false;
      return;
    }
    try {
      host.levelSession.advance(DEBUG_SKIP_CHUNK_STEPS);
    } catch (cause) {
      isRunning = false;
      log.warn('debug', 'skip to the end stopped: the level went away', cause);
      return;
    }
    requestFrame(() => frame(mine));
  };
  return {
    start() {
      if (isRunning) return;
      isRunning = true;
      const mine = ++runId;
      requestFrame(() => frame(mine));
    },
    cancel() {
      isRunning = false;
      runId++;
    },
    get isRunning() {
      return isRunning;
    },
  };
}
