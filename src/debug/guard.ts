import { log } from '@shared/log';

/**
 * Wraps a listener of the debug code so that a throw in it is logged (`warn`) and goes no further:
 * the game's loop and level start call these listeners, and a debug tool must never take the game
 * down (story 2.1 review). `what` names the listener in the log.
 */
export function guarded<Args extends unknown[]>(
  what: string,
  listener: (...args: Args) => void,
): (...args: Args) => void {
  return (...args) => {
    try {
      listener(...args);
    } catch (cause) {
      log.warn('debug', `${what} failed`, cause);
    }
  };
}
