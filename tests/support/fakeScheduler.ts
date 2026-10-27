import type { FrameScheduler } from '@client/loop';

export interface FakeScheduler extends FrameScheduler {
  /** True while a frame callback is waiting to be run. */
  readonly pending: boolean;
  /** How many frames were requested so far. */
  readonly requested: number;
  /**
   * Runs the pending frame callback once, as if the browser delivered a frame at `frameAtReal`.
   * Fails the test if no frame is pending (the loop stopped, or never started). The callback may
   * request the next frame while it runs.
   */
  tick(frameAtReal: number): void;
}

/** A frame scheduler for loop tests: the test chooses every frame timestamp. */
export function createFakeScheduler(): FakeScheduler {
  let callback: ((frameAtReal: number) => void) | null = null;
  let handle = 0;
  let requested = 0;

  return {
    get pending() {
      return callback !== null;
    },
    get requested() {
      return requested;
    },
    request(next) {
      if (callback !== null) throw new Error('a frame was requested while one is still pending');
      callback = next;
      requested++;
      handle++;
      return handle;
    },
    cancel(cancelled) {
      if (cancelled === handle) callback = null;
    },
    tick(frameAtReal) {
      if (callback === null) throw new Error('tick(): no frame is pending');
      const run = callback;
      callback = null;
      run(frameAtReal);
    },
  };
}
