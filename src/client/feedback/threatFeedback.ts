import type { ThreatDef } from '@content/schemas/threat';
import type { SimEvent, World } from '@sim';
import { hasChronoRing } from '../ui/world/chronoRing.ts';

/**
 * True when this event is the opening of a window the player must now hit with a chrono-ring lit on it
 * (story 2.11, D6): a `WindowOpened` of a threat whose def's response has a ring and which has no signal
 * cue of its own. `WindowOpened` cannot be mapped in `feedback.json › events` (it would vibrate for every
 * `wait` and `nothing` too), so the caller plays the client event `ChronoArcLit` when this is true. The
 * bomb drop's « LÂCHE ! » (`feedback.signal`) already vibrates at that very step: one moment, one
 * vibration. Allocates nothing.
 */
export function opensChronoArc(
  event: SimEvent,
  world: Readonly<World>,
  defs: Readonly<Record<string, ThreatDef>>,
): boolean {
  if (event.type !== 'WindowOpened') return false;
  for (const threat of world.threats) {
    if (threat.id !== event.threatId) continue;
    if (!Object.hasOwn(defs, threat.defId)) return false;
    const def = defs[threat.defId] as ThreatDef;
    return hasChronoRing(def.response) && def.feedback.signal === undefined;
  }
  return false;
}

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
    case 'WaitFeintGiven':
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
    case 'WaitFeintGiven':
      return feedback.feint ?? null;
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
