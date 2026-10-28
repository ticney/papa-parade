import type { LevelStartOptions } from '@client/app/levelSession';
import type { TestHost } from '@client/app/testHost';
import { ADVANCE_MAX_STEPS, TEST_API_EVENT_LOG_MAX, UINT32_RANGE } from '@shared/constants';
import { cloneJson } from '@shared/hash';
import { log } from '@shared/log';
import { asSimMs } from '@shared/time';
import type { SimCommand, SimEvent, World } from '@sim';
import { applyFeelPatch, type FeelPatch } from './feelPatch.ts';

export type { FeelPatch } from './feelPatch.ts';

/** A {@link SimCommand} whose `t` may be left out: it then applies at the next step. */
export type TestCommand = SimCommand extends infer C
  ? C extends { t: unknown }
    ? Omit<C, 't'> & { t?: number }
    : never
  : never;

/**
 * `window.__PP__`: how an agent or a Playwright test drives and inspects the running game (the
 * architecture's `PPTestApi`). Dev always, a playtest build with `?debug=1`, never a store build.
 * Every method throws an `Error` that names it (a rejected `page.evaluate` carries the message).
 *
 * Variances from the architecture contract, stated in story 1.13: `state()` may be `null` and is a
 * copy; `events` returns a copy; `send` accepts a missing `t`; `setFeel` returns a promise (it
 * rejects on an invalid patch).
 */
export interface PPTestApi {
  /** A copy of the running level's world, or `null` when no level is running. */
  state(): World | null;
  /** The events of the current level from absolute index `since` (default 0), oldest first. */
  events(since?: number): SimEvent[];
  /** Enqueues a command to the running sim. A missing `t` is the current sim time. */
  send(cmd: TestCommand): void;
  /** Freezes the level and runs exactly `steps` steps now. */
  advance(steps: number): void;
  /** Freezes or unfreezes the level loop: it renders on but runs no step. */
  freeze(on: boolean): void;
  /**
   * Lays `patch` over the running level's effective feel: it checks the result with `FeelSchema`
   * (an invalid patch rejects, naming the paths, and nothing is sent), then enqueues the journaled
   * `SetFeel` command at the current sim time, so it applies at the next step and the level goes on
   * (story 2.1). It also becomes the feel the next start or restart uses. Resolves once enqueued.
   */
  setFeel(patch: FeelPatch): Promise<void>;
  /** Starts a level; resolves once it runs (its countdown over). */
  loadLevel(id: string, seed: number): Promise<void>;
}

declare global {
  interface Window {
    __PP__?: PPTestApi;
  }
}

export interface TestApiOptions {
  /** How many events the log keeps. Default `TEST_API_EVENT_LOG_MAX`. */
  eventLogMax?: number;
}

const isSeed = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < UINT32_RANGE;

export function createTestApi(host: TestHost, options: TestApiOptions = {}): PPTestApi {
  const logMax = options.eventLogMax ?? TEST_API_EVENT_LOG_MAX;
  // A copy of every event of the current level; `firstIndex` is the absolute index of entries[0].
  let entries: SimEvent[] = [];
  let firstIndex = 0;
  let hasWarnedCap = false;

  host.onLevelStarted(() => {
    entries = [];
    firstIndex = 0;
    hasWarnedCap = false;
  });
  host.onSimEvent((event) => {
    // The drained array and its events are reused by the sim: keep a copy.
    entries.push(cloneJson(event));
    if (entries.length <= logMax) return;
    const excess = entries.length - logMax;
    entries.splice(0, excess);
    firstIndex += excess;
    if (!hasWarnedCap) {
      hasWarnedCap = true;
      log.warn('debug', `__PP__.events keeps ${logMax} events: the oldest are dropped`);
    }
  });

  const requireActive = (method: string) => {
    const active = host.levelSession.active;
    if (active === null) throw new Error(`__PP__.${method}: no level is running`);
    return active;
  };

  /** Starts a level and waits for its countdown to end; anything but a started level is an error. */
  const startAndWait = async (method: string, startOptions: LevelStartOptions): Promise<void> => {
    const outcome = await host.levelSession.start(startOptions);
    if (outcome !== 'started') {
      throw new Error(
        `__PP__.${method}: the level "${String(startOptions.levelId)}" did not start (${outcome})`,
      );
    }
    if (host.pauseState() === 'running') return;
    await new Promise<void>((resolve) => {
      const off = host.onGameResumed(() => {
        off();
        resolve();
      });
    });
  };

  return {
    state() {
      const active = host.levelSession.active;
      return active === null ? null : cloneJson(active.sim.world as World);
    },

    events(since = 0) {
      if (!Number.isInteger(since) || since < 0) {
        throw new Error(`__PP__.events: since must be an integer >= 0, got ${since}`);
      }
      // Copies: a page that rewrites what it got must not rewrite the log.
      return entries
        .slice(Math.max(since, firstIndex) - firstIndex)
        .map((event) => cloneJson(event));
    },

    send(cmd) {
      const active = requireActive('send');
      if (typeof cmd !== 'object' || cmd === null) {
        throw new Error('__PP__.send: the command must be an object');
      }
      const t = cmd.t ?? active.sim.world.time.sim;
      try {
        active.sim.enqueue({ ...cmd, t: asSimMs(t) } as SimCommand);
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`__PP__.send: ${reason}`, { cause });
      }
    },

    advance(steps) {
      if (!Number.isInteger(steps) || steps < 0 || steps > ADVANCE_MAX_STEPS) {
        throw new Error(
          `__PP__.advance: steps must be an integer in [0, ${ADVANCE_MAX_STEPS}], got ${steps}`,
        );
      }
      requireActive('advance');
      host.levelSession.advance(steps);
    },

    freeze(on) {
      if (typeof on !== 'boolean')
        throw new Error(`__PP__.freeze: on must be a boolean, got ${on}`);
      host.levelSession.freeze(on);
    },

    async setFeel(patch) {
      const active = requireActive('setFeel');
      const { world } = active.sim;
      const merged = applyFeelPatch(world.feel, patch);
      if (!merged.ok) throw new Error(`__PP__.setFeel: ${merged.error.message}`);
      active.sim.enqueue({ type: 'SetFeel', t: world.time.sim, patch });
      // A restart keeps what was tuned (the level's own overrides are merged over it again there).
      const remembered = applyFeelPatch(host.levelSession.current.feel, patch);
      if (remembered.ok) host.levelSession.rememberFeel(remembered.value);
      else {
        log.warn('debug', '__PP__.setFeel: not kept for a restart', {
          reason: remembered.error.message,
        });
      }
    },

    async loadLevel(id, seed) {
      if (typeof id !== 'string' || id === '') {
        throw new Error(`__PP__.loadLevel: id must be a non-empty string, got ${String(id)}`);
      }
      if (!isSeed(seed)) {
        throw new Error(
          `__PP__.loadLevel: seed must be an integer in [0, ${UINT32_RANGE}), got ${seed}`,
        );
      }
      await startAndWait('loadLevel', { levelId: id, seed });
    },
  };
}

/** Puts the test API on `target` (`window`) once; a second call keeps the first and warns. */
export function installTestApi(
  target: { __PP__?: PPTestApi },
  host: TestHost,
  options: TestApiOptions = {},
): void {
  if (target.__PP__ !== undefined) {
    log.warn('debug', 'window.__PP__ is already installed: keeping the first');
    return;
  }
  target.__PP__ = createTestApi(host, options);
  log.info('debug', 'window.__PP__ ready');
}
