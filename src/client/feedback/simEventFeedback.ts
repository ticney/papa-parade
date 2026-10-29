import type { LevelContent } from '@content/contentBundle';
import type { SimEvent, World } from '@sim';
import { disruptionCueOf } from './disruptionFeedback.ts';
import type { FeedbackDirector } from './feedbackDirector.ts';
import { threatCueOf } from './threatFeedback.ts';

/** What the routing reads of the level being played: its world and the defs that name the cues. */
export interface FeedbackSource {
  readonly sim: { readonly world: Readonly<World> };
  readonly level: Pick<LevelContent, 'threats' | 'level' | 'disruptions'>;
}

/**
 * Turns one sim event into its sounds, vibrations and rings, in the very call that receives it:
 * the generic `events` table first, then the cue the threat's def names, then the one the
 * disruption's def names (D3 of story 1.11, D10 of story 1.20). Nothing is deferred to a frame or
 * to Papa's arrival: the response sound and haptic fire at judgement (architecture P3), which is
 * why this routing is a pure function the tests can call and measure (story 2.3 D5).
 *
 * `active` is the level being played, `null` outside one: the table's events still play, with no
 * world to anchor a ring on. Allocates nothing beyond what the director does.
 */
export function playSimEventFeedback(
  event: SimEvent,
  active: FeedbackSource | null,
  director: FeedbackDirector,
): void {
  director.handle(event.type, active?.sim.world ?? null);
  if (active === null) return;
  // A threat's cues come from its def, not from the `events` table (D3).
  const cue = threatCueOf(event, active.sim.world, active.level.threats);
  if (cue !== null && 'threatId' in event) {
    director.playCue(cue, active.sim.world, event.threatId);
  }
  // A disruption's cues come from its def too (story 1.20 D10), anchored on its object.
  const disruptionCue = disruptionCueOf(event, active.level.level, active.level.disruptions);
  if (disruptionCue !== null && 'objectId' in event) {
    director.playCue(disruptionCue, active.sim.world, null, event.objectId);
  }
}
