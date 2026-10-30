import type { BeatTrack } from '@content/schemas/feedback';
import { beatTimelineOf } from '@sim';
import { describe, expect, it } from 'vitest';
import {
  audioAtS,
  type BeatSchedulerFrame,
  createBeatScheduler,
  type SoundedNote,
} from './beatScheduler.ts';

// The beat scheduler (story 4.5, AC 13, 14, 22): deterministic, a fake audio clock and fake frames.
// The truth is the audio time at which the continuous game clock reaches a beat; a note must sound
// within 10 ms of it (minus the lead).

const FRAME_MS = 1000 / 60;
const TOLERANCE_MS = 10;
const AHEAD_MS = 150;
const REPLAN_MS = 5;
const TIMELINE = beatTimelineOf({
  durationMs: 20_000,
  bpmStart: 90,
  bpmEnd: 60,
  leadInMs: 1200,
  countInBeats: 4,
  windowMs: 180,
  decoyBeats: [7, 15],
});
const TRACK: BeatTrack = {
  notes: ['music_lullaby_note_1', 'music_lullaby_note_2'],
  countIn: 'music_lullaby_tick',
  decoy: 'baby_lullaby_coo',
  bus: 'music',
  gainPct: 100,
};

interface Plan {
  clip: string;
  atS: number;
  isCancelled: boolean;
}

/** A fake engine: every plan is recorded, `cancel` marks it; `null` while `isRunning` is false. */
function createFakeAudio() {
  const plans: Plan[] = [];
  const audio = {
    nowS: 0 as number | null,
    isRunning: true,
    get currentTimeS() {
      return audio.nowS;
    },
    playOneShotAt(clip: string, _bus: string, _gainPct: number, atS: number) {
      if (!audio.isRunning) return null;
      const plan: Plan = { clip, atS, isCancelled: false };
      plans.push(plan);
      return {
        cancel() {
          plan.isCancelled = true;
        },
      };
    },
  };
  return { audio, plans };
}

/** A change of the clock's rate (sim ms per audio ms) at an audio time. */
interface RateChange {
  atS: number;
  rate: number;
}

/** The game clock at audio time `atS`: piecewise linear, from 0 ms at 0 s, at the rate of `changes`. */
function clockAt(changes: readonly RateChange[], atS: number): number {
  let clock = 0;
  let from = 0;
  let rate = changes[0]?.atS === 0 ? (changes[0]?.rate ?? 1) : 1;
  for (const change of changes) {
    if (change.atS > atS) break;
    clock += (change.atS - from) * 1000 * rate;
    from = change.atS;
    rate = change.rate;
  }
  return clock + (atS - from) * 1000 * rate;
}

/** The audio time at which the game clock reaches `target` (it never goes back, so it is unique). */
function audioWhenClockIs(changes: readonly RateChange[], target: number): number {
  let lowS = 0;
  let highS = 600;
  for (let i = 0; i < 60; i++) {
    const midS = (lowS + highS) / 2;
    if (clockAt(changes, midS) < target) lowS = midS;
    else highS = midS;
  }
  return highS;
}

interface Scenario {
  /** Rate changes at audio times (rate 0 is a hitstop: the audio goes on, the clock stands). */
  changes?: readonly RateChange[];
  leadMs?: number;
  /** Frame length in ms (16.67 by default). */
  frameMs?: number;
  /** Audio seconds to play. */
  untilS?: number;
  /** Pauses: the audio context is suspended, so both clocks freeze, for these many frames. */
  pauses?: readonly { atS: number; frames: number }[];
}

interface Outcome {
  notes: SoundedNote[];
  plans: Plan[];
  /** Per sounded note: the gap to the truth, in ms. */
  gapsMs: { entryIndex: number; gapMs: number; plannedAtS: number }[];
  maxPending: number;
}

function simulate({
  changes = [{ atS: 0, rate: 1 }],
  leadMs = 0,
  frameMs = FRAME_MS,
  untilS = 14,
  pauses = [],
}: Scenario = {}): Outcome {
  const { audio, plans } = createFakeAudio();
  const notes: SoundedNote[] = [];
  const scheduler = createBeatScheduler({
    audio,
    scheduleAheadMs: AHEAD_MS,
    replanToleranceMs: REPLAN_MS,
    onSounded: (note) => notes.push(note),
  });
  const frame: BeatSchedulerFrame = {
    timeline: TIMELINE,
    track: TRACK,
    stepStartAt: 0,
    cueIndex: 0,
    clockMs: 0,
    simPerRealMs: 1,
    leadMs,
  };
  const rateAt = (atS: number): number => {
    let rate = 1;
    for (const change of changes) if (change.atS <= atS) rate = change.rate;
    return rate;
  };
  let maxPending = 0;
  const pending = [...pauses];
  let atS = 0;
  while (atS < untilS) {
    const pause = pending[0];
    if (pause !== undefined && atS >= pause.atS) {
      pending.shift();
      // Suspended: the audio clock and the game clock stand still; the loop reports a rate of 0.
      for (let i = 0; i < pause.frames; i++) {
        audio.nowS = atS;
        frame.clockMs = clockAt(changes, atS);
        frame.simPerRealMs = 0;
        scheduler.update(frame);
        maxPending = Math.max(maxPending, scheduler.pendingCount);
      }
    }
    audio.nowS = atS;
    frame.clockMs = clockAt(changes, atS);
    frame.simPerRealMs = rateAt(atS);
    scheduler.update(frame);
    maxPending = Math.max(maxPending, scheduler.pendingCount);
    atS += frameMs / 1000;
  }
  const gapsMs = notes.map((note) => {
    const truthS = audioWhenClockIs(changes, note.beatAt) - leadMs / 1000;
    return {
      entryIndex: note.entryIndex,
      gapMs: Math.abs(note.plannedAtS - truthS) * 1000,
      plannedAtS: note.plannedAtS,
    };
  });
  return { notes, plans, gapsMs, maxPending };
}

/** The frame (audio time of its start and end) a given audio time falls in. */
const frameOf = (atS: number, frameMs: number) => {
  const startS = Math.floor((atS * 1000) / frameMs) * (frameMs / 1000);
  return { startS, endS: startS + frameMs / 1000 };
};

describe('audioAtS', () => {
  it('is now plus the real time until the game clock reaches the beat, minus the lead', () => {
    expect(audioAtS(1500, 1000, 1, 10, 0)).toBeCloseTo(10.5, 9);
    expect(audioAtS(1500, 1000, 0.5, 10, 0)).toBeCloseTo(11, 9);
    expect(audioAtS(1500, 1000, 1, 10, 40)).toBeCloseTo(10.46, 9);
    expect(audioAtS(1500, 1000, 1, 10, -40)).toBeCloseTo(10.54, 9);
  });

  it('divides by the rate: a frozen clock is a bug the caller must catch (it gives Infinity)', () => {
    expect(audioAtS(1500, 1000, 0, 10, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('the beat scheduler: every note within 10 ms of the game clock (AC 22)', () => {
  it('plays every note, in order, once, when nothing changes', () => {
    const { notes, plans, gapsMs } = simulate();
    expect(notes.length).toBeGreaterThan(15);
    expect(notes.map((note) => note.entryIndex)).toEqual(notes.map((_, i) => i));
    expect(plans.filter((plan) => !plan.isCancelled)).toHaveLength(notes.length);
    for (const { gapMs, entryIndex } of gapsMs) {
      expect(gapMs, `note ${entryIndex}`).toBeLessThanOrEqual(TOLERANCE_MS);
    }
    expect(notes.every((note) => note.replans === 0)).toBe(true);
  });

  it('plays the right sound for each entry: the tick, the numbered notes, the decoy', () => {
    const { plans } = simulate();
    const played = plans.filter((plan) => !plan.isCancelled).map((plan) => plan.clip);
    TIMELINE.forEach((entry, i) => {
      if (played[i] === undefined) return;
      if (entry.kind === 'countIn') expect(played[i]).toBe(TRACK.countIn);
      else if (entry.kind === 'decoy') expect(played[i]).toBe(TRACK.decoy);
      else expect(played[i]).toBe(TRACK.notes[entry.judgedIndex % TRACK.notes.length]);
    });
    expect(played).toContain(TRACK.decoy);
  });

  it('keeps every gap within 10 ms with frames at 33 ms', () => {
    const { gapsMs } = simulate({ frameMs: 33 });
    expect(gapsMs.length).toBeGreaterThan(15);
    for (const { gapMs, entryIndex } of gapsMs) {
      expect(gapMs, `note ${entryIndex}`).toBeLessThanOrEqual(TOLERANCE_MS);
    }
  });

  it('plays each note earlier by the lead, with both offsets set (AC 14)', () => {
    const none = simulate({ leadMs: 0 });
    const led = simulate({ leadMs: 60 });
    expect(led.notes.length).toBe(none.notes.length);
    led.notes.forEach((note, i) => {
      expect((none.notes[i]?.plannedAtS ?? 0) - note.plannedAtS).toBeCloseTo(0.06, 2);
    });
    for (const { gapMs } of led.gapsMs) expect(gapMs).toBeLessThanOrEqual(TOLERANCE_MS);
    // A negative lead (the screen is later than the speaker) plays them later.
    const late = simulate({ leadMs: -50 });
    late.notes.forEach((note, i) => {
      expect(note.plannedAtS - (none.notes[i]?.plannedAtS ?? 0)).toBeCloseTo(0.05, 2);
    });
    for (const { gapMs } of late.gapsMs) expect(gapMs).toBeLessThanOrEqual(TOLERANCE_MS);
  });

  it('follows a slow-mo (×0.3) that starts and ends mid-sequence, on frame boundaries', () => {
    // Frame-aligned changes, the first one 100 ms before a beat so that a note is planned and waiting.
    const frameS = FRAME_MS / 1000;
    const alignedS = (ms: number) => Math.round(ms / FRAME_MS) * frameS;
    const beatMs = TIMELINE[8]?.offsetMs ?? 0;
    const changes: RateChange[] = [
      { atS: 0, rate: 1 },
      { atS: alignedS(beatMs - 100), rate: 0.3 },
      { atS: alignedS(beatMs - 100) + 240 * frameS, rate: 1 },
    ];
    const { gapsMs, plans } = simulate({ changes, untilS: 18 });
    // A note was already planned when the clock slowed: it was cancelled, and sounds later.
    expect(plans.some((plan) => plan.isCancelled)).toBe(true);
    for (const { gapMs, entryIndex } of gapsMs) {
      expect(gapMs, `note ${entryIndex}`).toBeLessThanOrEqual(TOLERANCE_MS);
    }
  });

  it('follows a slow-mo that starts and ends inside a frame, with the one honest exception', () => {
    // A change of rate inside the frame just before a note sounds cannot be undone: that note is
    // already out. Only a note within one frame after a change is excluded, and it is pinned by the
    // bound `frame × |old − new| / new` (the gap a rate change `u` before the sound creates).
    const changes: RateChange[] = [
      { atS: 0, rate: 1 },
      { atS: 3.4037, rate: 0.3 },
      { atS: 7.1121, rate: 1 },
    ];
    const { gapsMs } = simulate({ changes, untilS: 20 });
    let excluded = 0;
    for (const { gapMs, plannedAtS, entryIndex } of gapsMs) {
      const near = changes.find((change) => {
        const { startS, endS } = frameOf(change.atS, FRAME_MS);
        return plannedAtS > change.atS && plannedAtS <= endS && startS <= change.atS;
      });
      if (near === undefined) {
        expect(gapMs, `note ${entryIndex}`).toBeLessThanOrEqual(TOLERANCE_MS);
        continue;
      }
      excluded += 1;
      const before = changes[changes.indexOf(near) - 1]?.rate ?? 1;
      expect(gapMs, `note ${entryIndex} (excluded)`).toBeLessThanOrEqual(
        (FRAME_MS * Math.abs(before - near.rate)) / near.rate + 0.5,
      );
    }
    // The exception is rare: it never swallows the rule.
    expect(excluded).toBeLessThanOrEqual(2);
  });

  it('follows a 10 s pause and its resume: the notes wait and none is lost or doubled', () => {
    const { gapsMs, notes, plans } = simulate({
      pauses: [{ atS: 5, frames: 600 }],
      untilS: 12,
    });
    expect(notes.map((note) => note.entryIndex)).toEqual(notes.map((_, i) => i));
    for (const { gapMs, entryIndex } of gapsMs) {
      expect(gapMs, `note ${entryIndex}`).toBeLessThanOrEqual(TOLERANCE_MS);
    }
    // Every plan made for a frozen clock was cancelled before it could sound.
    expect(plans.filter((plan) => !plan.isCancelled)).toHaveLength(notes.length);
  });

  it('follows a hitstop: the clock stands for 80 ms while the audio goes on', () => {
    const startS = 6.0;
    const { gapsMs } = simulate({
      changes: [
        { atS: 0, rate: 1 },
        { atS: Math.round(startS * 60) / 60, rate: 0 },
        { atS: Math.round(startS * 60) / 60 + 0.08, rate: 1 },
      ],
      untilS: 14,
    });
    expect(gapsMs.length).toBeGreaterThan(8);
    for (const { gapMs, entryIndex } of gapsMs) {
      expect(gapMs, `note ${entryIndex}`).toBeLessThanOrEqual(TOLERANCE_MS);
    }
  });
});

describe('the beat scheduler: the rules of planning (AC 13)', () => {
  function setup() {
    const { audio, plans } = createFakeAudio();
    const notes: SoundedNote[] = [];
    const scheduler = createBeatScheduler({
      audio,
      scheduleAheadMs: AHEAD_MS,
      replanToleranceMs: REPLAN_MS,
      onSounded: (note) => notes.push(note),
    });
    const frame: BeatSchedulerFrame = {
      timeline: TIMELINE,
      track: TRACK,
      stepStartAt: 0,
      cueIndex: 0,
      clockMs: 0,
      simPerRealMs: 1,
      leadMs: 0,
    };
    return { audio, plans, notes, scheduler, frame };
  }

  it('plans only what is within scheduleAheadMs of real time', () => {
    const { audio, plans, scheduler, frame } = setup();
    audio.nowS = 0;
    frame.clockMs = 0;
    scheduler.update(frame);
    // The first beat falls at 1200 ms: far beyond 150 ms.
    expect(plans).toHaveLength(0);
    frame.clockMs = 1100;
    audio.nowS = 1.1;
    scheduler.update(frame);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.atS).toBeCloseTo(1.2, 9);
  });

  it('plans a note once, and does not plan it again while the mapping holds', () => {
    const { audio, plans, scheduler, frame } = setup();
    for (let i = 0; i < 5; i++) {
      audio.nowS = 1.1 + i * 0.001;
      frame.clockMs = 1100 + i;
      scheduler.update(frame);
    }
    expect(plans).toHaveLength(1);
  });

  it('never divides by a rate of 0: it cancels what has not sounded, then plans again when the clock moves', () => {
    const { audio, plans, scheduler, frame } = setup();
    audio.nowS = 1.1;
    frame.clockMs = 1100;
    scheduler.update(frame);
    expect(scheduler.pendingCount).toBe(1);
    frame.simPerRealMs = 0;
    audio.nowS = 1.11;
    scheduler.update(frame);
    expect(plans[0]?.isCancelled).toBe(true);
    expect(scheduler.pendingCount).toBe(0);
    expect(plans.every((plan) => Number.isFinite(plan.atS))).toBe(true);
    frame.simPerRealMs = 1;
    audio.nowS = 1.12;
    scheduler.update(frame);
    expect(plans).toHaveLength(2);
    expect(plans[1]?.isCancelled).toBe(false);
    expect(plans[1]?.atS).toBeCloseTo(1.2 + 0.02, 6);
  });

  it('re-plans a note whose time moved by more than replanToleranceMs, not by less', () => {
    const { audio, plans, scheduler, frame, notes } = setup();
    audio.nowS = 1.1;
    frame.clockMs = 1100;
    scheduler.update(frame);
    // 3 ms off: kept.
    frame.clockMs = 1103;
    audio.nowS = 1.1;
    scheduler.update(frame);
    expect(plans).toHaveLength(1);
    // 8 ms off: cancelled and planned again, and the count says so.
    frame.clockMs = 1108;
    scheduler.update(frame);
    expect(plans.map((plan) => plan.isCancelled)).toEqual([true, false]);
    // It sounds at its new time, and says it was planned twice.
    audio.nowS = 1.3;
    frame.clockMs = 1300;
    scheduler.update(frame);
    expect(notes.map((note) => note.replans)).toEqual([1]);
  });

  it('retries a note the engine refused (a suspended context), and does not count it played', () => {
    const { audio, plans, scheduler, frame, notes } = setup();
    audio.isRunning = false;
    audio.nowS = 1.1;
    frame.clockMs = 1100;
    scheduler.update(frame);
    scheduler.update(frame);
    expect(plans).toHaveLength(0);
    expect(scheduler.pendingCount).toBe(0);
    audio.isRunning = true;
    scheduler.update(frame);
    expect(plans).toHaveLength(1);
    expect(notes).toEqual([]);
  });

  it('drops a note whose time has passed by more than scheduleAheadMs, and plays one a little late', () => {
    const { audio, plans, scheduler, frame } = setup();
    // The context came back 600 ms after the first beats: the old ones are dropped, not stacked.
    audio.nowS = 5;
    frame.clockMs = 3000;
    scheduler.update(frame);
    const atS = plans.map((plan) => plan.atS);
    expect(atS.every((value) => value >= 5 - AHEAD_MS / 1000)).toBe(true);
    expect(plans.length).toBeLessThan(3);
    // 100 ms late (within the horizon): played at once, not dropped.
    const fresh = setup();
    fresh.audio.nowS = 1.3;
    fresh.frame.clockMs = 1300;
    fresh.scheduler.update(fresh.frame);
    expect(fresh.plans.length).toBeGreaterThan(0);
  });

  it('cancels everything and forgets the step when the sequence ends, restarts or the level ends', () => {
    const { audio, plans, scheduler, frame } = setup();
    audio.nowS = 1.1;
    frame.clockMs = 1100;
    scheduler.update(frame);
    expect(scheduler.pendingCount).toBe(1);
    // The sequence ended: no timeline.
    scheduler.update({ ...frame, timeline: null, track: null });
    expect(plans[0]?.isCancelled).toBe(true);
    expect(scheduler.pendingCount).toBe(0);
    // A new run with the same cue cursor starts afresh (the restart mid-sequence).
    scheduler.update(frame);
    expect(plans).toHaveLength(2);
    scheduler.update({ ...frame, stepStartAt: 7000 });
    expect(plans[1]?.isCancelled).toBe(true);
    // And an explicit reset (level end) leaves nothing planned.
    scheduler.reset();
    expect(scheduler.pendingCount).toBe(0);
    expect(plans.every((plan) => plan.isCancelled)).toBe(true);
  });

  it('does nothing while there is no audio context', () => {
    const { audio, plans, scheduler, frame } = setup();
    audio.nowS = null;
    frame.clockMs = 1100;
    scheduler.update(frame);
    expect(plans).toHaveLength(0);
  });

  it('never holds more notes than its fixed pool, at the fastest autoplay speed', () => {
    const { maxPending } = simulate({
      changes: [{ atS: 0, rate: 4 }],
      untilS: 6,
    });
    expect(maxPending).toBeLessThanOrEqual(16);
  });
});

describe('audioOffsetMs is one correction, not two (AC 14, D1)', () => {
  it('reads exactly beatAt in the sim for a player calibrated on both offsets', () => {
    // The calibration measures `tap − beep`: a player taps `audioOffsetMs` after the sound they hear.
    // The input mapper then corrects the stamp by `visualOffsetMs`. The note leads by the difference.
    const audioOffsetMs = 110;
    const visualOffsetMs = 70;
    const leadMs = audioOffsetMs - visualOffsetMs;
    const beatAt = 5000;
    const clockMs = 4900;
    const simPerRealMs = 1;
    const audioNowS = 20;
    const noteAtS = audioAtS(beatAt, clockMs, simPerRealMs, audioNowS, leadMs);
    // The player hears the note at `noteAtS` and answers `audioOffsetMs` later (their reaction);
    const tapAtRealMs = noteAtS * 1000 + audioOffsetMs;
    // the mapper subtracts `visualOffsetMs` from the stamp, and the time map turns it into sim time.
    const stampRealMs = tapAtRealMs - visualOffsetMs;
    const simStamp = clockMs + (stampRealMs - audioNowS * 1000) * simPerRealMs;
    expect(simStamp).toBeCloseTo(beatAt, 9);
  });

  it('reads beatAt too for a skipped audio phase, where the two offsets are equal (lead 0)', () => {
    const offsetMs = 80;
    const noteAtS = audioAtS(5000, 4900, 1, 20, offsetMs - offsetMs);
    const stampRealMs = noteAtS * 1000 + offsetMs - offsetMs;
    expect(4900 + (stampRealMs - 20_000)).toBeCloseTo(5000, 9);
  });

  it('would be wrong if the lead and a second correction on the taps were both applied', () => {
    const audioOffsetMs = 110;
    const visualOffsetMs = 70;
    const noteAtS = audioAtS(5000, 4900, 1, 20, audioOffsetMs - visualOffsetMs);
    // The trap: subtracting `audioOffsetMs` from the stamp as well counts the latency twice.
    const doubled =
      4900 + (noteAtS * 1000 + audioOffsetMs - visualOffsetMs - audioOffsetMs - 20_000);
    expect(Math.abs(doubled - 5000)).toBeCloseTo(audioOffsetMs, 6);
  });
});
