import { CHORE_BEAT_STATES, CHORE_STATES, type ChoreInstance } from '@sim';

/**
 * The debug mirror `data-pp-chore` (story 9.4, AC 14): the level's chores, by index,
 * `<index>:<state>:<beatsDone>/<beatCount>:<beatState>` joined by `;`, empty when the level has none (`boot.ts`
 * writes the empty text itself at the start of such a level: `update` is only called for a level with chores).
 * `update` is called every frame and returns the new text only when it changed (a chore's state, its
 * beats done or its beat's state), so the caller writes the DOM on change and the frame allocates nothing
 * while nothing happens. Mirrored builds only: a test reads it instead of polling the world.
 */
export interface ChoreMirror {
  /** The text to write now, or null when it is the one already returned. */
  update(chores: readonly Readonly<ChoreInstance>[], beatCounts: readonly number[]): string | null;
  /** Forgets what was returned: the next `update` returns the text again (a new level). */
  reset(): void;
}

export function createChoreMirror(): ChoreMirror {
  let signatures: number[] = [];
  let isFirst = true;
  return {
    update(chores, beatCounts) {
      let isChanged = isFirst || signatures.length !== chores.length;
      if (!isChanged) {
        for (let i = 0; i < chores.length; i++) {
          const chore = chores[i] as Readonly<ChoreInstance>;
          const signature =
            (CHORE_STATES.indexOf(chore.state) * 1000 + chore.beatsDone) * 10 +
            CHORE_BEAT_STATES.indexOf(chore.beatState);
          if (signature !== signatures[i]) {
            isChanged = true;
            break;
          }
        }
      }
      if (!isChanged) return null;
      isFirst = false;
      signatures = chores.map(
        (chore) =>
          (CHORE_STATES.indexOf(chore.state) * 1000 + chore.beatsDone) * 10 +
          CHORE_BEAT_STATES.indexOf(chore.beatState),
      );
      return chores
        .map(
          (chore, i) =>
            `${i}:${chore.state}:${chore.beatsDone}/${beatCounts[i] ?? 0}:${chore.beatState}`,
        )
        .join(';');
    },
    reset() {
      signatures = [];
      isFirst = true;
    },
  };
}
