import type { SequenceDef } from '@content/schemas/sequence';
import type { SimEvent } from '@sim';

/**
 * The cue a special-sequence event plays, named by the sequence's def (`feedback.started`,
 * `succeeded`, `failed`), or `null` when the event plays none (story 4.4): `SequenceStepStarted`
 * is silent, and so is `SequenceEnded{levelEnded}` (the level's own end has its cues). The table's
 * `events` never carry these, a def does, so the next sequence brings its own sounds by JSON alone.
 * The twin of `disruptionCueOf`. An event naming a sequence that is not loaded plays nothing.
 * Allocates nothing.
 */
export function sequenceCueOf(
  event: SimEvent,
  sequences: Readonly<Record<string, SequenceDef>>,
): string | null {
  if (event.type !== 'SequenceStarted' && event.type !== 'SequenceEnded') return null;
  if (!Object.hasOwn(sequences, event.id)) return null;
  const { feedback } = sequences[event.id] as SequenceDef;
  if (event.type === 'SequenceStarted') return feedback.started;
  if (event.outcome === 'succeeded') return feedback.succeeded;
  if (event.outcome === 'failed') return feedback.failed;
  return null;
}
