import type { AudioBus, BeatTrack } from '@content/schemas/feedback';
import { log } from '@shared/log';
import type { BeatEntry } from '@sim';

// The beat scheduler (story 4.5, AC 13-14): the notes of a `beats` step are planned one by one on
// the audio clock, never looped (a stem cannot slow from 90 to 60 BPM and stay on the sim's
// instants; `playbackRate` would bend the pitch). Once per frame it maps each coming beat of the
// sim's clock onto the audio clock and (re)plans it with `playOneShotAt`. One rule covers a slow-mo,
// a hitstop, a pause and a debug time scale: **a planned note that has not sounded is recomputed
// every frame; off by more than `replanToleranceMs`, it is cancelled and planned again.**

const MS_PER_S = 1000;
/** Notes that can be planned and unsounded at once: scheduleAhead is a fraction of a beat, so a few are plenty. */
const POOL_SIZE = 16;

/**
 * Where a beat that falls at sim time `beatAt` sounds on the audio clock, in seconds: now, plus the
 * real time until the continuous game clock reaches `beatAt`, minus the lead. `clockMs` and
 * `simPerRealMs` are what the loop records in its time map (the continuous clock, never
 * `world.time.sim`, which moves in 10 ms stairs); `leadMs` is the correction of D1,
 * `audioOffsetMs − visualOffsetMs`. Never call it with `simPerRealMs <= 0`: the beat has no
 * real-time position while the clock is frozen.
 */
export function audioAtS(
  beatAt: number,
  clockMs: number,
  simPerRealMs: number,
  audioNowS: number,
  leadMs: number,
): number {
  return audioNowS + (beatAt - clockMs) / simPerRealMs / MS_PER_S - leadMs / MS_PER_S;
}

/**
 * The lead of D1, in ms: the notes play `audioOffsetMs − visualOffsetMs` earlier than their beat, and
 * the input mapper keeps `visualOffsetMs` alone on the taps, so the latency is corrected once. 0 with
 * no calibration (a skipped audio phase gives two equal offsets and the same 0).
 */
export function beatLeadMs(
  calibration: Readonly<{ audioOffsetMs: number; visualOffsetMs: number }> | null,
): number {
  return calibration === null ? 0 : calibration.audioOffsetMs - calibration.visualOffsetMs;
}

/** What the scheduler needs to know of the world and the loop, written by `boot.ts` each frame. */
export interface BeatSchedulerFrame {
  /** The timeline of the running `beats` step, or null when none runs (cancels everything). */
  timeline: readonly BeatEntry[] | null;
  /** The sounds of the step's track, or null with no timeline. */
  track: BeatTrack | null;
  /** When the step started, in sim time: an entry falls at `stepStartAt + offsetMs`. */
  stepStartAt: number;
  /** The world's cue cursor: the notes before it were announced already. */
  cueIndex: number;
  /** The loop's continuous game clock, in sim ms. */
  clockMs: number;
  /** Sim ms per real ms: 0 while frozen or paused. */
  simPerRealMs: number;
  /** `audioOffsetMs − visualOffsetMs`, in ms: the notes play this much earlier (0 with no calibration). */
  leadMs: number;
  /**
   * Real ms since the loop recorded `clockMs` (the frame's timestamp) and the scheduler runs: the
   * audio clock is read now, the game clock is as of then, and the pair is only a pair once this is
   * taken out. 0 when they were read together.
   */
  clockAgeMs: number;
}

/** A note that has sounded: what `__PP__.beatLog()` reports. */
export interface SoundedNote {
  readonly entryIndex: number;
  readonly beatAt: number;
  /** The audio time it was planned for, lead included. */
  readonly plannedAtS: number;
  /** How many times it was cancelled and planned again before it sounded. */
  readonly replans: number;
}

export interface BeatSchedulerOptions {
  /** The slice of the engine it uses (a fake in the tests). */
  audio: {
    playOneShotAt(
      clip: string,
      bus: AudioBus,
      gainPct: number,
      atS: number,
    ): { cancel(): void } | null;
    readonly currentTimeS: number | null;
  };
  /** `feedback.json › beatScheduler.scheduleAheadMs`, in real ms. */
  scheduleAheadMs: number;
  /** `feedback.json › beatScheduler.replanToleranceMs`, in real ms. */
  replanToleranceMs: number;
  /** Called once per note when it has sounded (dev and debug builds only). */
  onSounded?: (note: SoundedNote) => void;
}

export interface BeatScheduler {
  /** Once per frame. Allocation-free apart from the audio nodes a plan creates. */
  update(frame: BeatSchedulerFrame): void;
  /** Cancels every note that has not sounded and forgets the step. */
  reset(): void;
  /** Notes planned and not sounded yet (for the tests and the debug overlay). */
  readonly pendingCount: number;
}

interface Slot {
  isUsed: boolean;
  entryIndex: number;
  beatAt: number;
  plannedAtS: number;
  replans: number;
  handle: { cancel(): void } | null;
}

export function createBeatScheduler(options: BeatSchedulerOptions): BeatScheduler {
  const { audio, scheduleAheadMs, replanToleranceMs, onSounded } = options;
  const slots: Slot[] = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    slots.push({
      isUsed: false,
      entryIndex: 0,
      beatAt: 0,
      plannedAtS: 0,
      replans: 0,
      handle: null,
    });
  }
  /** Entries before this one have sounded, or were dropped. */
  let doneUpTo = 0;
  /** The step this state belongs to (`stepStartAt`), NaN when none: a new step starts afresh. */
  let runStartAt = Number.NaN;
  let pendingCount = 0;

  const free = (slot: Slot): void => {
    slot.isUsed = false;
    slot.handle = null;
    pendingCount -= 1;
  };

  const cancelUnsounded = (): number => {
    let lowest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < POOL_SIZE; i++) {
      const slot = slots[i] as Slot;
      if (!slot.isUsed) continue;
      slot.handle?.cancel();
      lowest = Math.min(lowest, slot.entryIndex);
      free(slot);
    }
    return lowest;
  };

  /** Cancels the unsounded notes of the entries from `entryIndex` on. */
  const cancelFrom = (entryIndex: number): void => {
    for (let i = 0; i < POOL_SIZE; i++) {
      const slot = slots[i] as Slot;
      if (!slot.isUsed || slot.entryIndex < entryIndex) continue;
      slot.handle?.cancel();
      free(slot);
    }
  };

  const slotOf = (entryIndex: number): Slot | null => {
    for (let i = 0; i < POOL_SIZE; i++) {
      const slot = slots[i] as Slot;
      if (slot.isUsed && slot.entryIndex === entryIndex) return slot;
    }
    return null;
  };

  const freeSlot = (): Slot | null => {
    for (let i = 0; i < POOL_SIZE; i++) {
      const slot = slots[i] as Slot;
      if (!slot.isUsed) return slot;
    }
    return null;
  };

  /** Plays the note of `entry` at `atS`; null when the engine could not (a suspended context). */
  const plan = (entry: BeatEntry, track: BeatTrack, atS: number): { cancel(): void } | null => {
    if (entry.kind === 'decoy')
      return audio.playOneShotAt(track.decoy, track.bus, track.gainPct, atS);
    if (entry.kind === 'countIn') {
      return audio.playOneShotAt(track.countIn, track.bus, track.gainPct, atS);
    }
    const clip = track.notes[entry.judgedIndex % track.notes.length] as string;
    return audio.playOneShotAt(clip, track.bus, track.gainPct, atS);
  };

  const reset = (): void => {
    cancelUnsounded();
    doneUpTo = 0;
    runStartAt = Number.NaN;
  };

  return {
    get pendingCount() {
      return pendingCount;
    },
    reset,
    update(frame) {
      const { timeline, track } = frame;
      if (timeline === null || track === null) {
        if (pendingCount > 0 || !Number.isNaN(runStartAt)) reset();
        return;
      }
      if (frame.stepStartAt !== runStartAt) {
        // A new step (or a restart that came back to the same state): nothing of the old one stays.
        cancelUnsounded();
        runStartAt = frame.stepStartAt;
        doneUpTo = frame.cueIndex;
      }
      const nowS = audio.currentTimeS;
      if (nowS === null) return;
      // `clockMs` is the game clock as the loop recorded it, `frame.clockAgeMs` ago: the audio time
      // that goes with it is the audio time of that instant, not of this one.
      const clockNowS = nowS - frame.clockAgeMs / MS_PER_S;

      // Notes whose planned time has come have sounded: free them, oldest entry first (a slot is
      // reused, so the slot order is not the order they were planned in).
      for (;;) {
        let due: Slot | null = null;
        for (let i = 0; i < POOL_SIZE; i++) {
          const slot = slots[i] as Slot;
          if (!slot.isUsed || slot.plannedAtS > nowS) continue;
          if (due === null || slot.entryIndex < due.entryIndex) due = slot;
        }
        if (due === null) break;
        onSounded?.({
          entryIndex: due.entryIndex,
          beatAt: due.beatAt,
          plannedAtS: due.plannedAtS,
          replans: due.replans,
        });
        doneUpTo = Math.max(doneUpTo, due.entryIndex + 1);
        free(due);
      }

      // Frozen (hitstop, pause, a debug freeze): a beat has no real-time position. Whatever has not
      // sounded is cancelled, and planned again when the clock moves. Dividing by 0 is the bug.
      if (frame.simPerRealMs <= 0) {
        const lowest = cancelUnsounded();
        if (lowest !== Number.POSITIVE_INFINITY) doneUpTo = Math.min(doneUpTo, lowest);
        return;
      }

      const lateLimitS = -scheduleAheadMs / MS_PER_S;
      // A note that leads its beat by `leadMs` is due that much earlier: the horizon opens that much
      // earlier too, or the note would be planned already late (and dropped from a lead of
      // `scheduleAheadMs` on). A note that trails its beat (a negative lead) is planned as before.
      const leadAheadMs = Math.max(0, frame.leadMs);
      for (let index = doneUpTo; index < timeline.length; index++) {
        const entry = timeline[index] as BeatEntry;
        const beatAt = frame.stepStartAt + entry.offsetMs;
        const aheadRealMs = (beatAt - frame.clockMs) / frame.simPerRealMs;
        if (aheadRealMs - leadAheadMs > scheduleAheadMs) {
          // The mapping moved (a slow-mo slowed the clock): a note planned for its old time is now
          // beyond the horizon. Cancelled, it is planned again when it comes back inside it.
          cancelFrom(index);
          break;
        }
        const atS = audioAtS(beatAt, frame.clockMs, frame.simPerRealMs, clockNowS, frame.leadMs);
        const slot = slotOf(index);
        if (slot !== null) {
          if (Math.abs(atS - slot.plannedAtS) * MS_PER_S <= replanToleranceMs) continue;
          // The mapping moved (a slow-mo, a hitstop, a new offset): plan it again where it belongs.
          slot.handle?.cancel();
          const handle = plan(entry, track, atS);
          if (handle === null) {
            free(slot);
            continue;
          }
          slot.handle = handle;
          slot.plannedAtS = atS;
          slot.replans += 1;
          continue;
        }
        if (atS - nowS < lateLimitS) {
          // Its moment is gone by more than the planning horizon: playing it now would be a late
          // click on top of the next note, so the note is dropped.
          if (log.enabled('debug')) {
            log.debug(
              'audio',
              `beat ${index} dropped: ${Math.round((nowS - atS) * MS_PER_S)} ms late`,
            );
          }
          doneUpTo = index + 1;
          continue;
        }
        const target = freeSlot();
        if (target === null) break;
        const handle = plan(entry, track, atS);
        // A suspended context plays nothing: it is retried next frame, it is not a played note.
        if (handle === null) break;
        target.isUsed = true;
        target.entryIndex = index;
        target.beatAt = beatAt;
        target.plannedAtS = atS;
        target.replans = 0;
        target.handle = handle;
        pendingCount += 1;
      }
    },
  };
}
