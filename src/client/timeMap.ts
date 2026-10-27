import { TIME_MAP_CAPACITY, TIME_MAP_HISTORY_MS } from '@shared/constants';
import { invariant } from '@shared/invariant';
import { type Logger, log } from '@shared/log';
import { asSimMs, type RealMs, type SimMs } from '@shared/time';

export interface TimeMap {
  /**
   * At `realMs` the continuous sim clock read `simMs`; from there on it advances `simPerRealMs`
   * sim ms per real ms (`timeScale`; 0 when frozen or paused).
   */
  record(realMs: RealMs, simMs: SimMs, simPerRealMs: number): void;
  /**
   * Sim time at `realMs`. Inside the history: linear interpolation between the two surrounding
   * records. After the newest: extrapolated at the newest record's rate. Before the start of the
   * history (`TIME_MAP_HISTORY_MS` before the newest record, or the oldest kept record if the
   * ring is shorter): the sim time at that start, with a `warn`. An empty map answers `0`, with
   * a `warn`. Allocation-free, but meant for rare calls (one per input).
   */
  realToSim(realMs: RealMs): SimMs;
  reset(): void;
}

export interface TimeMapOptions {
  /** Where the clamping warnings go. Default: `log`. */
  logger?: Pick<Logger, 'warn'>;
}

/**
 * The real → sim time map of the architecture (P5). The loop records one point per frame, paused
 * or not, so a pause is a flat segment and a hitstop a short flat one: there is no special case.
 *
 * Storage is three preallocated arrays used as a ring: `record` never allocates. It keeps the
 * records of the last `TIME_MAP_HISTORY_MS`, plus the one just before that window so that the
 * start of the window can be interpolated.
 */
export function createTimeMap(options: TimeMapOptions = {}): TimeMap {
  const logger = options.logger ?? log;
  const recordRealMs = new Float64Array(TIME_MAP_CAPACITY);
  const recordSimMs = new Float64Array(TIME_MAP_CAPACITY);
  const recordSimPerRealMs = new Float64Array(TIME_MAP_CAPACITY);
  let head = 0; // slot of the oldest record
  let count = 0;

  const slot = (index: number): number => (head + index) % TIME_MAP_CAPACITY;

  return {
    record(realMs, simMs, simPerRealMs) {
      // Hot path (once per frame): each condition is tested first, so that the message strings
      // are only built when one fails (`invariant(cond, template)` would build them every call).
      if (!Number.isFinite(realMs)) {
        invariant(false, `timeMap.record: realMs is not finite (${realMs})`);
      }
      if (!Number.isFinite(simMs)) {
        invariant(false, `timeMap.record: simMs is not finite (${simMs})`);
      }
      if (!(Number.isFinite(simPerRealMs) && simPerRealMs >= 0)) {
        invariant(
          false,
          `timeMap.record: simPerRealMs must be a finite number >= 0 (${simPerRealMs})`,
        );
      }
      if (count > 0) {
        const newest = slot(count - 1);
        if (realMs < (recordRealMs[newest] as number)) {
          invariant(
            false,
            `timeMap.record: real time went back (${realMs} < ${recordRealMs[newest]})`,
          );
        }
        if (simMs < (recordSimMs[newest] as number)) {
          invariant(
            false,
            `timeMap.record: sim time went back (${simMs} < ${recordSimMs[newest]})`,
          );
        }
      }

      if (count === TIME_MAP_CAPACITY) {
        head = (head + 1) % TIME_MAP_CAPACITY;
        count--;
      }
      const target = slot(count);
      recordRealMs[target] = realMs;
      recordSimMs[target] = simMs;
      recordSimPerRealMs[target] = simPerRealMs;
      count++;

      // Drop what the history no longer needs: a record is useless once the one after it is at or
      // before the start of the window.
      const historyStartAtReal = realMs - TIME_MAP_HISTORY_MS;
      while (count > 1 && (recordRealMs[slot(1)] as number) <= historyStartAtReal) {
        head = (head + 1) % TIME_MAP_CAPACITY;
        count--;
      }
    },

    realToSim(realMs) {
      invariant(Number.isFinite(realMs), `timeMap.realToSim: realMs is not finite (${realMs})`);
      if (count === 0) {
        logger.warn('input', 'timeMap is empty: no frame has run yet, answering sim time 0');
        return asSimMs(0);
      }

      const newest = slot(count - 1);
      const newestAtReal = recordRealMs[newest] as number;
      const oldestAtReal = recordRealMs[head] as number;
      const historyStartAtReal = Math.max(newestAtReal - TIME_MAP_HISTORY_MS, oldestAtReal);
      let query: number = realMs;
      if (query < historyStartAtReal) {
        logger.warn('input', 'timestamp older than the time map history: clamped to its start', {
          realMs,
          historyStartAtReal,
        });
        query = historyStartAtReal;
      }

      if (query >= newestAtReal) {
        return asSimMs(
          (recordSimMs[newest] as number) +
            (query - newestAtReal) * (recordSimPerRealMs[newest] as number),
        );
      }

      // The latest record at or before `query` (so, with equal timestamps, the later record wins).
      let before = count - 2;
      while (before > 0 && (recordRealMs[slot(before)] as number) > query) before--;
      const from = slot(before);
      const to = slot(before + 1);
      const fromAtReal = recordRealMs[from] as number;
      const spanMs = (recordRealMs[to] as number) - fromAtReal;
      const fraction = spanMs > 0 ? (query - fromAtReal) / spanMs : 0;
      const fromSim = recordSimMs[from] as number;
      return asSimMs(fromSim + fraction * ((recordSimMs[to] as number) - fromSim));
    },

    reset() {
      head = 0;
      count = 0;
    },
  };
}
