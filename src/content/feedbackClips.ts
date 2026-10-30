import type { FeedbackTable } from './schemas/feedback.ts';

/**
 * Every clip the table names, once, sorted: the loops' (the sequences' music too), the cues' and each cue's layers'. The
 * client preloads this list, `content:check` looks for each file, and the audio-assets test
 * measures them.
 */
export function feedbackClips(table: FeedbackTable): string[] {
  const clips = new Set<string>([
    table.loops.babble.clip,
    table.loops.music.stems.calm,
    table.loops.music.stems.tense,
    table.calibration.beep.clip,
  ]);
  for (const loop of Object.values(table.loops.sequenceMusic)) clips.add(loop.clip);
  for (const cue of Object.values(table.cues)) {
    if (cue.audio !== undefined) clips.add(cue.audio.clip);
    for (const layer of cue.layers ?? []) clips.add(layer.clip);
  }
  return [...clips].sort();
}
