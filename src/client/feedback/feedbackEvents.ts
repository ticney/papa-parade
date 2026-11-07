import type { SimEvent } from '@sim';

/**
 * The client events the feedback director listens to, next to the sim's (`SIM_EVENT_TYPES`). A key
 * of `content/feedback.json` `events` is one of these or one of those.
 */
export const FEEDBACK_CLIENT_EVENTS = [
  'CountdownTicked',
  'NoiseAlertReached',
  // The catastrophe crossed 70 % upwards (story 3.16): Mama is on her way, a sound, a visual and a vibration.
  'CatastropheAlertReached',
  // The chrono-ring's final arc lit (story 2.11): a short vibration at the opening of a window that has a ring.
  'ChronoArcLit',
  // The activity bubble (story 2.12): shaken by a refused tap on a busy Papa, popped when he is free again.
  'ActivityBubbleShaken',
  'ActivityBubblePopped',
  'InstinctVignetteShown',
  'PhotoTaken',
  'ResultStarStamped',
  'ResultLastStarStamped',
  'ResultMamaWokeShown',
  // The header after Mama came home early (story 3.16): the door slams, a visual and a heavy vibration.
  'ResultMamaHomeShown',
  'ResultStarLost',
] as const;

/** Every name the director's `handle` takes. */
export type FeedbackEventName = SimEvent['type'] | (typeof FEEDBACK_CLIENT_EVENTS)[number];
