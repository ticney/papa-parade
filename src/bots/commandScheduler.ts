import { STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import type { SimCommand } from '@sim';

/**
 * The commands a bot has planned for later (a release after a press). `flush` hands over the ones
 * whose `t` falls in the coming step, in `t` order (ties keep the order they were planned in).
 * Allocates only when something is planned.
 */
export interface CommandScheduler {
  schedule(command: SimCommand): void;
  /** Pushes into `out` the planned commands with `t < now + STEP_MS`; one planned in the past is moved to `now`. */
  flush(now: number, out: SimCommand[]): void;
  readonly size: number;
}

export function createCommandScheduler(): CommandScheduler {
  const pending: SimCommand[] = [];
  return {
    schedule(command) {
      pending.push(command);
    },
    flush(now, out) {
      if (pending.length === 0) return;
      const start = out.length;
      let kept = 0;
      for (let i = 0; i < pending.length; i++) {
        const command = pending[i] as SimCommand;
        if (command.t >= now + STEP_MS) {
          pending[kept++] = command;
          continue;
        }
        const due = command.t < now ? ({ ...command, t: asSimMs(now) } as SimCommand) : command;
        // Insertion sort by `t`, stable: a handful of commands at most.
        let at = out.length;
        out.push(due);
        while (at > start && (out[at - 1] as SimCommand).t > due.t) {
          out[at] = out[at - 1] as SimCommand;
          at--;
        }
        out[at] = due;
      }
      pending.length = kept;
    },
    get size() {
      return pending.length;
    },
  };
}
