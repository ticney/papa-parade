import type { FeedbackTable } from './schemas/feedback.ts';

/**
 * Every clip the table names, once, sorted: the loops' and the cues'. The client preloads this
 * list, `content:check` looks for each file, and the audio-assets test measures them.
 */
export function feedbackClips(table: FeedbackTable): string[] {
  const clips = new Set<string>([table.loops.babble.clip, table.loops.music.clip]);
  for (const cue of Object.values(table.cues)) {
    if (cue.audio !== undefined) clips.add(cue.audio.clip);
  }
  return [...clips].sort();
}
