/** Simulation time (or a duration of it), in ms. The sim never sees any other clock. */
export type SimMs = number & { readonly __unit: 'SimMs' };

/** Real (wall-clock) time, in ms. Only the client deals with it. */
export type RealMs = number & { readonly __unit: 'RealMs' };

export function asSimMs(ms: number): SimMs {
  return ms as SimMs;
}

export function asRealMs(ms: number): RealMs {
  return ms as RealMs;
}
