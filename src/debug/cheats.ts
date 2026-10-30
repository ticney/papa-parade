import type { TestHost } from '@client/app/testHost';
import {
  DEBUG_SKIP_CHUNK_STEPS,
  GAUGE_MAX_POINTS,
  MIN_TIME_SCALE,
  UINT32_RANGE,
} from '@shared/constants';
import { log } from '@shared/log';
import { err, ok, type Result } from '@shared/result';
import { asSimMs } from '@shared/time';
import { type SequenceRefusal, type SimCommand, sequenceRefusal, type World } from '@sim';

/**
 * What a cheat may do: send a command to the running sim (stamped with its current time), or ask
 * the level session for something. Never write the world: a cheat that changes the game is a
 * command, so it is journaled and replays (story 2.1, D12).
 */
export interface CheatContext {
  readonly host: TestHost;
  /** Enqueues `command` at the running sim's current time; false (and a warning) when no level is running or it has ended. */
  send(command: DistributiveOmitT<SimCommand>): boolean;
}

/** `Omit<T, 't'>` that keeps a union apart. */
type DistributiveOmitT<T> = T extends { t: unknown } ? Omit<T, 't'> : never;

/**
 * One thing the overlay's cheat list offers. The list is data so that a story adds an entry (a
 * launcher with a list of its own, such as the threats' and the sequences', has its own row).
 */
export interface Cheat {
  readonly id: string;
  readonly label: string;
  /** The cheat has a number to give: `[min, max]` and its starting value, or `null` for a plain button. */
  readonly input: { readonly min: number; readonly max: number; readonly start: number } | null;
  /** Whether it makes sense in this level now (« set fatigue » needs a fatigue gauge). */
  isAvailable(world: Readonly<World>, hasFatigue: boolean): boolean;
  run(context: CheatContext, value: number): void;
}

/** Whether a level has the fatigue gauge (« set fatigue » needs it): the one derivation the overlay and the tests share. */
export function levelHasFatigue(level: { level: { gauges: { fatigue?: unknown } } }): boolean {
  return level.level.gauges.fatigue !== undefined;
}

/**
 * Why a command sent to the running sim would be lost, or `null` when it would be taken: no level
 * is running, or the level has ended (the sim drops commands once `flow.state` is `ended`, so
 * « sent » would be a lie). The overlay shows it in its status line.
 */
export function refusalReason(host: TestHost): string | null {
  const active = host.levelSession.active;
  if (active === null) return 'no level is running';
  if (active.sim.world.flow.state === 'ended') return 'the level has ended';
  return null;
}

/**
 * The seed typed in the overlay: a whole number in `[0, 2**32)` (`createRng` throws on anything
 * else, and the app would go to its error screen). A blank field is refused, not read as 0.
 */
export function parseSeed(text: string): Result<number, string> {
  if (text.trim() === '') return err('the seed is empty');
  const seed = Number(text);
  if (!Number.isInteger(seed) || seed < 0 || seed >= UINT32_RANGE) {
    return err(`the seed must be a whole number from 0 to ${UINT32_RANGE - 1}`);
  }
  return ok(seed);
}

/** The number typed for a cheat, held in the cheat's own `[min, max]`; a blank or non-numeric field is refused. */
export function parseCheatNumber(
  text: string,
  input: { readonly min: number; readonly max: number },
): Result<number, string> {
  if (text.trim() === '') return err('the value is empty');
  const value = Number(text);
  if (!Number.isFinite(value)) return err('the value is not a number');
  return ok(Math.min(input.max, Math.max(input.min, value)));
}

/** The threats of the running level that can be launched: `{ id, label }` per planned threat. */
export function launchableThreats(world: Readonly<World>): { id: number; label: string }[] {
  return world.threats.map((threat) => ({
    id: threat.id,
    label: `${threat.defId} @ ${threat.anchorId} (${threat.state})`,
  }));
}

/** The ids of the special sequences the level can run (story 4.4): what the overlay's « Start » picks from. */
export function launchableSequences(level: { level: { sequences: readonly string[] } }): string[] {
  return [...level.level.sequences];
}

/** Why a sequence cannot start now, in plain English for the overlay's status line, or `null`. */
export function sequenceRefusalText(world: Readonly<World>): string | null {
  const reason: SequenceRefusal | null = sequenceRefusal(world as World);
  if (reason === null) return null;
  const texts: Record<SequenceRefusal, string> = {
    running: 'a sequence is already running',
    ended: 'the level has ended',
    papaBusy: 'Papa is busy (coffee, nap, call or toilet)',
    silence: 'the baby is hiding (a silence is under way)',
  };
  return texts[reason];
}

/** Sends `StartSequence` for `sequenceId`: journaled, ignored by the sim with no event when it is refused. */
export function startSequence(context: CheatContext, sequenceId: string): boolean {
  return context.send({ type: 'StartSequence', sequenceId });
}

/** The cheats that are not « launch a threat » or « start a sequence » (those have a list: see {@link launchableThreats}). */
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
  {
    // The same `TapBaby` as a finger on him (story 4.1): takes the baby, or puts him down. A tester or
    // Playwright can carry without aiming at a moving baby.
    id: 'takePutDownBaby',
    label: 'Take / put down the baby',
    input: null,
    isAvailable: () => true,
    run: (context) => {
      context.send({ type: 'TapBaby' });
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
      const reason = refusalReason(host);
      const active = host.levelSession.active;
      if (reason !== null || active === null) {
        log.warn('debug', `cheat refused: ${reason ?? 'no level is running'}`, command);
        return false;
      }
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
  /** Stops after the current chunk and puts the freeze back as it was at `start()`. */
  cancel(): void;
  readonly isRunning: boolean;
}

/**
 * « Skip to the end » (story 2.1, D12): runs the level through `levelSession.advance`, in chunks of
 * `DEBUG_SKIP_CHUNK_STEPS` steps per frame so the page stays alive, until the sim says the level has
 * ended (`world.flow.state`). The steps are real steps (the end is scored as played, the journal is
 * honest); nothing is written to the world. `advance` freezes the level: when the skip ends, is
 * cancelled, or the level goes away, the freeze is put back as it was at `start()`, so a skip never
 * leaves the next level frozen. It stops by itself, with a warning, if the level goes away.
 * `requestFrame` is `requestAnimationFrame`, injected so that a test can step it.
 */
export function createSkipToEnd(
  host: TestHost,
  requestFrame: (callback: () => void) => unknown,
): SkipToEnd {
  let isRunning = false;
  let runId = 0;
  let wasFrozen = false;
  const stop = (): void => {
    isRunning = false;
    host.levelSession.freeze(wasFrozen);
  };
  const frame = (mine: number): void => {
    if (!isRunning || mine !== runId) return;
    const active = host.levelSession.active;
    if (active === null) {
      log.warn('debug', 'skip to the end stopped: no level is running');
      stop();
      return;
    }
    if (active.sim.world.flow.state === 'ended') {
      stop();
      return;
    }
    try {
      host.levelSession.advance(DEBUG_SKIP_CHUNK_STEPS);
    } catch (cause) {
      log.warn('debug', 'skip to the end stopped: the level went away', cause);
      stop();
      return;
    }
    requestFrame(() => frame(mine));
  };
  return {
    start() {
      if (isRunning) return;
      isRunning = true;
      wasFrozen = host.levelSession.isFrozen;
      const mine = ++runId;
      requestFrame(() => frame(mine));
    },
    cancel() {
      if (!isRunning) return;
      runId++;
      stop();
    },
    get isRunning() {
      return isRunning;
    },
  };
}
