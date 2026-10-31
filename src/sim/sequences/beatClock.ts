import { MS_PER_MINUTE } from '@shared/constants';
import type { EffectiveWindow } from '../timing/effectiveWindow.ts';
import { judgePress } from '../timing/judge.ts';

// The beat timeline of a `beats` step (story 4.5): where every note falls, from the step's start.
// Pure arithmetic, no zod and no `@content` runtime import (the sim takes the step it is handed):
// the sim, the client's scheduler and ring, and the bots all call `beatTimelineOf`, so that they
// cannot disagree about when a beat is.

/** The part of a `beats` step the timeline needs (a `BeatsStep` of the content fits it). */
export interface BeatTimelineStep {
  readonly durationMs: number;
  readonly bpmStart: number;
  readonly bpmEnd: number;
  readonly leadInMs: number;
  readonly countInBeats: number;
  readonly windowMs: number;
  readonly decoyBeats: readonly number[];
}

/** What a timeline entry is: a beat only heard, a judged beat, or an off-beat decoy. */
export type BeatEntryKind = 'countIn' | 'beat' | 'decoy';

/** One note of the timeline. */
export interface BeatEntry {
  /** When it falls, in sim ms from the start of the step. A whole number. */
  readonly offsetMs: number;
  readonly kind: BeatEntryKind;
  /**
   * The judged-beat number (0-based, the count-in excluded) of a `beat`; of a `decoy`, the number of
   * the beat it follows (the one `decoyBeats` names); -1 for a `countIn`.
   */
  readonly judgedIndex: number;
}

/**
 * The tempo at `offsetMs` into the step: linear from `bpmStart` at the first beat (`leadInMs`, not
 * the step's start, so that the lullaby really starts at `bpmStart`) to `bpmEnd` at the end of the
 * step (`durationMs`). The timeline asks it at a beat to place the next one, so a beat's gap is the
 * tempo of the beat before it and `bpmEnd` itself is never played (the last beat falls earlier).
 */
function bpmAt(step: BeatTimelineStep, offsetMs: number): number {
  const spanMs = step.durationMs - step.leadInMs;
  const share = spanMs <= 0 ? 0 : Math.min(1, Math.max(0, (offsetMs - step.leadInMs) / spanMs));
  return step.bpmStart + (step.bpmEnd - step.bpmStart) * share;
}

/**
 * The notes of `step`, sorted by `offsetMs`. The first falls at `leadInMs`; the next is the
 * previous one plus `Math.round(MS_PER_MINUTE / bpmAt(previous))` (see {@link bpmAt}), at least 1 ms
 * so that the loop ends whatever the tempo, whole ms so that a journal and a
 * test read clean numbers. A beat exists only if its whole window fits in the step
 * (`offsetMs + windowMs <= durationMs`). The first `countInBeats` are `countIn`, the rest `beat`.
 * A decoy sits at the rounded middle of two judged beats; one named by `decoyBeats` that has no
 * next judged beat is left out (`content:check` refuses it).
 */
export function beatTimelineOf(step: BeatTimelineStep): readonly BeatEntry[] {
  const beatOffsetsMs: number[] = [];
  let offsetMs = step.leadInMs;
  while (offsetMs + step.windowMs <= step.durationMs) {
    beatOffsetsMs.push(offsetMs);
    offsetMs += Math.max(1, Math.round(MS_PER_MINUTE / bpmAt(step, offsetMs)));
  }
  const decoys = new Set(step.decoyBeats);
  const entries: BeatEntry[] = [];
  for (let i = 0; i < beatOffsetsMs.length; i++) {
    const at = beatOffsetsMs[i] as number;
    const judgedIndex = i - step.countInBeats;
    if (judgedIndex < 0) {
      entries.push({ offsetMs: at, kind: 'countIn', judgedIndex: -1 });
    } else {
      entries.push({ offsetMs: at, kind: 'beat', judgedIndex });
      const next = beatOffsetsMs[i + 1];
      if (decoys.has(judgedIndex) && next !== undefined) {
        entries.push({ offsetMs: Math.round((at + next) / 2), kind: 'decoy', judgedIndex });
      }
    }
  }
  return entries;
}

/** The number of judged beats in `timeline`. */
export function judgedBeatCountOf(timeline: readonly BeatEntry[]): number {
  let count = 0;
  for (let i = 0; i < timeline.length; i++) if (timeline[i]?.kind === 'beat') count += 1;
  return count;
}

/** The index of the first `beat` entry of `timeline` at or after `from`, or `timeline.length`. */
export function nextJudgedEntryIndex(timeline: readonly BeatEntry[], from: number): number {
  let index = from;
  while (index < timeline.length && timeline[index]?.kind !== 'beat') index += 1;
  return index;
}

/** What a tap is, once judged against the beat to settle and the decoy just before it. */
export type TapClass = 'free' | 'hit' | 'miss' | 'decoy' | 'stray';

function isOnWindow(quality: 'perfect' | 'success' | 'early' | 'late'): boolean {
  return quality === 'perfect' || quality === 'success';
}

/**
 * Judges a tap made at `tapT` (its own timestamp) against the beat at `beatAt`, and the decoy at
 * `decoyAt` (null: there is none before it, or it is spent). `response` is the beat's own window, in
 * which `bufferMs` is 0: a buffer keeps a press that is early, which in a rhythm would swallow the
 * off-beat. Every window is centred on its note, `judgePress(t, at - windowMs / 2, response)`.
 *
 * - on the beat: `hit`; on the decoy: `decoy`; on both (a wide tier makes the windows overlap): the
 *   nearer centre wins and a tie goes to the beat;
 * - late for the beat: `miss`, which settles it (one tap never pays twice);
 * - early for the first judged beat (`isFirstBeat`): `free`, tapping along in the lead-in and the
 *   count-in costs nothing;
 * - anything else: `stray`, which is what stops a player mashing through a window.
 */
export function classifyTap(
  tapT: number,
  beatAt: number,
  decoyAt: number | null,
  response: EffectiveWindow,
  isFirstBeat: boolean,
): TapClass {
  const half = response.windowMs / 2;
  const onBeat = judgePress(tapT, beatAt - half, response);
  const isOnBeat = isOnWindow(onBeat.quality);
  const isOnDecoy =
    decoyAt !== null && isOnWindow(judgePress(tapT, decoyAt - half, response).quality);
  if (isOnBeat && isOnDecoy) {
    return Math.abs(tapT - beatAt) <= Math.abs(tapT - (decoyAt as number)) ? 'hit' : 'decoy';
  }
  if (isOnBeat) return 'hit';
  if (isOnDecoy) return 'decoy';
  if (onBeat.quality === 'late') return 'miss';
  if (onBeat.quality === 'early' && isFirstBeat) return 'free';
  return 'stray';
}

/** The part of a sequence def {@link sequenceBeatProblems} reads (a `SequenceDef` of the content fits it). */
export interface BeatsDefShape {
  readonly steps: readonly (
    | { readonly kind: 'microSleeps' }
    | ({ readonly kind: 'beats'; readonly track: string } & BeatTimelineStep)
  )[];
  readonly failure: {
    readonly kind: string;
    readonly missWakePct?: number;
    readonly decoyWakePct?: number;
    readonly strayWakePct?: number;
  };
  readonly framing: { readonly bar: { readonly value: string } | null };
}

/** What decides how wide a beat's hit zone can get: the widest tier and the hidden tolerance (`feel.json`). */
export interface BeatWindowLimits {
  readonly maxWindowMultiplier: number;
  readonly toleranceMs: number;
}

/** The {@link BeatWindowLimits} of a feel (the shape `Feel` fits). */
export function beatWindowLimitsOf(feel: {
  readonly timing: { readonly toleranceMs: number };
  readonly difficulty: Readonly<Record<string, { readonly windowMultiplier: number }>>;
}): BeatWindowLimits {
  return {
    maxWindowMultiplier: Math.max(
      ...Object.values(feel.difficulty).map((tier) => tier.windowMultiplier),
    ),
    toleranceMs: feel.timing.toleranceMs,
  };
}

/**
 * What is wrong with the beats of a sequence def, each as a sentence that follows « the sequence
 * "<id>" »: `content:check` and `simLevelOf` both call it, so they refuse the same things with the
 * same words. `trackIds` are the keys of `feedback.json › beatTracks`; `limits` is the widest a window
 * gets. A `beats` step is the only step of its sequence: a step change clears the beat slice (a later
 * step would drop the open beat), and a micro-sleeps step beside it would have its gags ignored by the
 * `babyAwake` failure. 4.9 and 4.10 can lift it when a sequence needs more.
 */
export function sequenceBeatProblems(
  def: BeatsDefShape,
  trackIds: readonly string[],
  limits: BeatWindowLimits,
): string[] {
  const problems: string[] = [];
  const hasBeats = def.steps.some((step) => step.kind === 'beats');
  if (hasBeats && def.failure.kind !== 'babyAwake') {
    problems.push(
      `has a beats step, so its failure must be "babyAwake", not "${def.failure.kind}"`,
    );
  }
  if (!hasBeats && def.failure.kind === 'babyAwake') {
    problems.push('has a "babyAwake" failure, but no beats step to wake the baby');
  }
  if (hasBeats && def.steps.length > 1) {
    problems.push(
      `has a beats step among ${def.steps.length} steps, but a beats step must be the only step of its sequence`,
    );
  }
  if (def.framing.bar?.value === 'calmLeft' && def.failure.kind !== 'babyAwake') {
    problems.push(
      'has a bar that shows calmLeft, but no "babyAwake" failure (nothing wakes the baby)',
    );
  }
  const { missWakePct = 0, decoyWakePct = 0, strayWakePct = 0 } = def.failure;
  if (def.failure.kind === 'babyAwake' && missWakePct + decoyWakePct + strayWakePct <= 0) {
    problems.push(
      'has a "babyAwake" failure whose missWakePct, decoyWakePct and strayWakePct are all 0 (the baby could never wake)',
    );
  }
  for (const step of def.steps) {
    if (step.kind !== 'beats') continue;
    if (!trackIds.includes(step.track)) {
      problems.push(
        `has a beats step with the track "${step.track}", which feedback.json › beatTracks does not have`,
      );
    }
    const timeline = beatTimelineOf(step);
    const judgedCount = judgedBeatCountOf(timeline);
    if (judgedCount === 0) {
      problems.push(
        'has a beats step with no judged beat (the count-in and the step length leave none to tap)',
      );
    }
    for (const decoyBeat of step.decoyBeats) {
      if (decoyBeat + 1 >= judgedCount) {
        problems.push(
          `has a beats step with a decoy after judged beat ${decoyBeat}, which has no next judged beat (the step has ${judgedCount})`,
        );
      }
    }
    let shortestMs = Number.POSITIVE_INFINITY;
    let previous: BeatEntry | undefined;
    for (const entry of timeline) {
      if (entry.kind === 'decoy') continue;
      if (previous !== undefined) {
        shortestMs = Math.min(shortestMs, entry.offsetMs - previous.offsetMs);
      }
      previous = entry;
    }
    if (step.windowMs >= shortestMs) {
      problems.push(
        `has a beats step with a windowMs of ${step.windowMs} ms, which is not below its shortest beat interval of ${shortestMs} ms (two windows would overlap)`,
      );
    }
    // A hit zone is the window (at the widest tier) with the tolerance on each side, centred on its
    // note: a decoy halfway between two beats must keep its zone clear of both of theirs, or a
    // second tap after a hit would be billed as the decoy.
    const zoneMs = step.windowMs * limits.maxWindowMultiplier + 2 * limits.toleranceMs;
    for (let i = 1; i < timeline.length - 1; i++) {
      const entry = timeline[i] as BeatEntry;
      if (entry.kind !== 'decoy') continue;
      const spacingMs = Math.min(
        entry.offsetMs - (timeline[i - 1] as BeatEntry).offsetMs,
        (timeline[i + 1] as BeatEntry).offsetMs - entry.offsetMs,
      );
      if (zoneMs > spacingMs) {
        problems.push(
          `has a beats step whose decoy after judged beat ${entry.judgedIndex} sits ${spacingMs} ms from its nearest beat, but a hit zone is ${zoneMs} ms wide at the widest tier (windowMs ${step.windowMs} × ${limits.maxWindowMultiplier} + 2 × ${limits.toleranceMs} ms of tolerance): the zones would overlap`,
        );
      }
    }
  }
  return problems;
}
