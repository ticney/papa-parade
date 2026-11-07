import { MAMA_REACTIONS, type MamaReactionId } from '@shared/constants';
import type { LevelEndReason } from '../events.ts';
import type { MamaScore } from '../world.ts';

/** One of Mama's reactions on the Result screen and what it is worth (story 3.7). */
export interface MamaReaction {
  reaction: MamaReactionId;
  /** The points of its component in the note (the Laugh gives, the Sigh and the Scream take off); 0 shows no chip. */
  points: number;
}

/**
 * Which reactions Mama has to the game she is shown, in the order Laugh, Sigh, Scream (story 3.7, D4):
 * a reaction plays only when its component of the note has points, but a Mama woken by the noise
 * (`mamaWoke`) or come home early (`mamaHome`) always screams (GDD › Macro-boucle). With nothing at all she still
 * reacts: the Laugh, worth 0 (the loser still sees her photo and her reaction). The Calme and Maison rows have no
 * reaction. Pure: it reads the note and the end, draws nothing and emits nothing.
 */
export function mamaReactionsOf(
  score: Readonly<MamaScore>,
  reason: LevelEndReason,
): readonly MamaReaction[] {
  const points: Readonly<Record<MamaReactionId, number>> = {
    laugh: score.laughPoints,
    sigh: score.sighPoints,
    scream: score.screamPoints,
  };
  const isEarlyEnd = reason === 'mamaWoke' || reason === 'mamaHome';
  const reactions: MamaReaction[] = [];
  for (const reaction of MAMA_REACTIONS) {
    if (points[reaction] > 0 || (reaction === 'scream' && isEarlyEnd)) {
      reactions.push({ reaction, points: points[reaction] });
    }
  }
  if (reactions.length === 0) reactions.push({ reaction: 'laugh', points: score.laughPoints });
  return reactions;
}
