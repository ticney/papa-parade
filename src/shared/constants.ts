/** Number of log entries (level `info` and above) kept by the logger's ring buffer. */
export const LOG_BUFFER_SIZE = 200;

/** Length of one simulation step, in sim ms. Every `sim.step()` advances exactly this much. */
export const STEP_MS = 10;

/**
 * Technical floor of `timeScale`: pause is never `timeScale = 0`, and a scale near 0 would stall
 * the client loop. Not a GDD value (the slowest one is far above).
 */
export const MIN_TIME_SCALE = 0.05;

/** sfc32 outputs discarded after seeding, so that close seeds do not give close first outputs. */
export const RNG_WARMUP_ROUNDS = 15;

/** 2**32: the number of distinct `uint32` values. */
export const UINT32_RANGE = 4294967296;
