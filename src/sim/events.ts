import type { InvariantViolation } from '@shared/invariant';
import type { SimMs } from '@shared/time';

/** Domain events pushed by the systems into `ctx.events`; `t` is sim time. */
export type SimEvent =
  | { type: 'TimeScaleChanged'; t: SimMs; from: number; to: number }
  | InvariantViolation;
