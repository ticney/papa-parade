import type { LevelContent } from '@content/contentBundle';
import type { ChoreDef } from '@content/schemas/chore';
import { isPapaBusy, type SimEvent, type World } from '@sim';
import { choreCueOf } from './choreFeedback.ts';
import { disruptionCueOf } from './disruptionFeedback.ts';
import type { FeedbackDirector } from './feedbackDirector.ts';
import { sequenceCueOf } from './sequenceFeedback.ts';
import { opensChronoArc, threatCueOf } from './threatFeedback.ts';

/** What the routing reads of the level being played: its world and the defs that name the cues. */
export interface FeedbackSource {
  readonly sim: {
    readonly world: Readonly<World>;
    /**
     * The level's chores (story 9.4, `Sim.chores`: the def and the station of each, index-aligned with
     * `world.chores`). Absent or empty: a level with no station.
     */
    readonly chores?: readonly { readonly def: ChoreDef; readonly objectId: string }[];
  };
  readonly level: Pick<LevelContent, 'threats' | 'level' | 'disruptions' | 'sequences'>;
}

/**
 * Turns one sim event into its sounds, vibrations and rings, in the very call that receives it:
 * the generic `events` table first, then the cue the threat's def names, then the one the
 * disruption's def names (D3 of story 1.11, D10 of story 1.20), then the one the special
 * sequence's def names (story 4.4). Nothing is deferred to a frame or
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
  // The lit arc of the chrono-ring vibrates once, at the opening of a window that has one (story 2.11).
  if (opensChronoArc(event, active.sim.world, active.level.threats)) {
    director.handle('ChronoArcLit', null);
  }
  // The activity bubble (story 2.12): a tap on a threat that a busy Papa refused shakes it; the end of every busy
  // state pops it (a busy → busy change is a swap, not an end). Both cues are `uiElement`: the bubble is their visual.
  if (event.type === 'TapRefused') director.handle('ActivityBubbleShaken', null);
  if (
    event.type === 'PapaStateChanged' &&
    isPapaBusy({ state: event.from }) &&
    !isPapaBusy({ state: event.to })
  ) {
    director.handle('ActivityBubblePopped', null);
  }
  // A disruption's cues come from its def too (story 1.20 D10), anchored on its object.
  const disruptionCue = disruptionCueOf(event, active.level.level, active.level.disruptions);
  if (disruptionCue !== null && 'objectId' in event) {
    director.playCue(disruptionCue, active.sim.world, null, event.objectId);
  }
  // A house chore's cues come from its def too (story 9.4), anchored on its station.
  const { chores } = active.sim;
  if (chores !== undefined && chores.length > 0) {
    const choreCue = choreCueOf(event, chores);
    if (choreCue !== null && 'choreIndex' in event) {
      director.playCue(choreCue, active.sim.world, null, chores[event.choreIndex]?.objectId);
    }
  }
  // A special sequence's cues come from its def too (story 4.4), anchored on Papa (`content:check`).
  const sequenceCue = sequenceCueOf(event, active.level.sequences);
  if (sequenceCue !== null) director.playCue(sequenceCue, active.sim.world, null);
}
