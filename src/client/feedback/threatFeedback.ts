import type { ThreatDef } from '@content/schemas/threat';
import type { SimEvent, World } from '@sim';

/**
 * The cue a threat event plays, named by the threat's def (`feedback.telegraph/success/perfect/gag`),
 * or `null` when the event plays none: the table's `events` never carry these (D3 of story 1.11), a
 * def does, so a second threat has its own sounds by JSON alone. A failed response plays nothing
 * here: its `GagTriggered` (same step, right after) plays the gag cue, so a miss sounds once.
 *
 * The def is found through the instance in `world.threats` (the id of the event) and `defs` by its
 * `defId`; an event naming a threat the world or the defs lack plays nothing. Allocates nothing.
 */
export function threatCueOf(
  event: SimEvent,
  world: Readonly<World>,
  defs: Readonly<Record<string, ThreatDef>>,
): string | null {
  let threatId: number;
  switch (event.type) {
    case 'ThreatTelegraphed':
    case 'WaitSignalGiven':
    case 'GagTriggered':
      threatId = event.threatId;
      break;
    case 'ResponseResolved':
      if (event.quality === 'fail') return null;
      threatId = event.threatId;
      break;
    default:
      return null;
  }
  let defId: string | null = null;
  for (const threat of world.threats) {
    if (threat.id === threatId) {
      defId = threat.defId;
      break;
    }
  }
  if (defId === null || !Object.hasOwn(defs, defId)) return null;
  const { feedback } = defs[defId] as ThreatDef;
  switch (event.type) {
    case 'ThreatTelegraphed':
      return feedback.telegraph;
    case 'WaitSignalGiven':
      return feedback.signal ?? null;
    case 'GagTriggered':
      return feedback.gag;
    case 'ResponseResolved':
      return event.quality === 'perfect' ? feedback.perfect : feedback.success;
    default:
      return null;
  }
}
