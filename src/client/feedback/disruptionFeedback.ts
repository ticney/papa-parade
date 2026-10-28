import type { DisruptionDef } from '@content/schemas/disruption';
import type { Level } from '@content/schemas/level';
import type { SimEvent } from '@sim';

/**
 * The cue a disruption event plays, named by the disruption's def (`feedback.ring` for the start
 * of the ring and each second it goes on, `feedback.answer` for the pick-up), or `null` when the
 * event plays none: the table's `events` never carry these (story 1.20 D10), a def does, so the E6
 * dog brings its own sounds by JSON alone. The twin of `threatCueOf`.
 *
 * The def is found through the wave entry that rings at the event's object (`level.waves`) and
 * `defs` by its `def`; an event naming an object no wave plans, or a def that is not loaded, plays
 * nothing. Allocates nothing.
 */
export function disruptionCueOf(
  event: SimEvent,
  level: Pick<Level, 'waves'>,
  defs: Readonly<Record<string, DisruptionDef>>,
): string | null {
  let isAnswer: boolean;
  switch (event.type) {
    case 'PhoneRingStarted':
    case 'PhoneRinging':
      isAnswer = false;
      break;
    case 'PhoneAnswered':
      isAnswer = true;
      break;
    default:
      return null;
  }
  for (const wave of level.waves) {
    for (const entry of wave.disruptions) {
      if (entry.object !== event.objectId) continue;
      if (!Object.hasOwn(defs, entry.def)) return null;
      const { feedback } = defs[entry.def] as DisruptionDef;
      return isAnswer ? feedback.answer : feedback.ring;
    }
  }
  return null;
}
