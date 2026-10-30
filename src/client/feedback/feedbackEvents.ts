import type { SimEvent } from '@sim';

/**
 * The client events the feedback director listens to, next to the sim's (`SIM_EVENT_TYPES`). A key
 * of `content/feedback.json` `events` is one of these or one of those.
 */
export const FEEDBACK_CLIENT_EVENTS = [
  'CountdownTicked',
  'NoiseAlertReached',
  'InstinctVignetteShown',
  'ResultStarStamped',
  'ResultLastStarStamped',
  'ResultMamaWokeShown',
  'ResultStarLost',
] as const;

/** Every name the director's `handle` takes. */
export type FeedbackEventName = SimEvent['type'] | (typeof FEEDBACK_CLIENT_EVENTS)[number];
