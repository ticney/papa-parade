import type { Feel } from '@content/schemas/feel';
import { decodeBase64, encodeBase64 } from '@shared/base64';
import {
  DIFFICULTY_TIER_IDS,
  GAUGE_MAX_POINTS,
  MAMA_SCORE_MAX_POINTS,
  MIN_TIME_SCALE,
  PHONE_RINGING_EVERY_MS,
  QUATERNION_LENGTH_TOLERANCE,
  STAR_COUNT_MAX,
  STEP_MS,
} from '@shared/constants';
import { cloneJson } from '@shared/hash';
import { invariant } from '@shared/invariant';
import { CHORE_BEAT_STATES, CHORE_STATES } from './chores/choreFsm.ts';
import { DISRUPTION_STATES } from './disruptions/disruptionFsm.ts';
import { LEVEL_END_REASONS, type LevelEndReason } from './events.ts';
import { feelShapeProblem } from './feel/applyFeelPatch.ts';
import { FLOW_STATES, type FlowState } from './flow/flowFsm.ts';
import { isPapaBusy, PAPA_INTENTS, PAPA_STATES, type PapaState } from './papa/papaFsm.ts';
import { GAG_IDS } from './threats/gags.ts';
import { THREAT_STATES } from './threats/threatFsm.ts';
import {
  INSTINCT_STATES,
  type InstinctState,
  type PropSlice,
  SLOW_MO_SOURCES,
  type SlowMoSource,
  type ThreatInstance,
  type World,
} from './world.ts';

/**
 * The restorable state: `World` and the Rapier world beside it, plus the identity of the sim it
 * came from (a snapshot of another seed, feel, level geometry or level is refused on restore).
 * Pending commands are rebuilt from the journal, and freeze is a real-time artefact.
 */
export interface SimSnapshot {
  /**
   * 33 since story 9.6: `ChoreInstance.beatsMissed` (the beats a chore has missed, for the broken plates of Mama's Soupir) and `ChoreInstance.isOpen` (the station's door, open while a dishwasher waits to be emptied). 32 since story 9.4: `world.chores` (one instance per house chore of the level: its state, the beats done and the beat under way with its frozen window), the `chore` Papa state, and a glide with a null `threatId` (to a station). 31 since story 3.16: `gauges.catastrophePct` (the catastrophe gauge, in every level), `flow.endReason` (why the level ended, null while it is live), and the `mamaHome` end reason with its `CatastropheChanged` event. 30 since story 3.15: `world.afterEffects` (the pénombre, the debris Papa stands on, the marks of a silence's mischief), `PropSlice.debrisPickUpMs`, `BabySlice.downstairsUntil`, the `electrified` / `carryingUp` / `pickingUp` Papa states, the `downstairs` / `carriedUp` baby states, the `fetchBaby` intent, and `feel.fatigue.asleepMs` gone (the nap's length is the micro-sleep's `afterEffect`). 29 since story 3.12: `score.successes` and `score.calmMs`, and Mama's note has five rows (`calmPoints` and `homePoints` replace `babyStatePoints`). 28 since story 3.5: `world.flow.finalRushAt`, the `finalRush` and `photo` flow states, `PropSlice.isMess` and `score.propsTidied`. 27 since story 4.10: `world.cycle` (the bedtime cycle: the entry, when it is due and when the cycle was completed), and the `CycleCompleted` event. 26 since story 4.9: `world.sequence.stealth` (the running `stealth` step: the exit, the next alert, the breath and the board Papa stands on). 25 since story 4.8: the `sequence` slow-mo source (a duel step's own slow motion); no new field. 24 since story 4.7: `ThreatInstance.feintAt` / `isFeintGiven` (the feint of a fake sleep, before its signal). 23 since story 4.6: `world.sequence.duel` (the running `duel` step: whether it runs, the instant of the next round and the retreats so far). 22 since story 4.5 (merged after 2.9): `world.sequence.beat` (the running `beats` step: its cursors, the wake of the baby and the window of the beat). 21 since story 2.9 (merged after 4.4): `world.instinct` (Fatherly Instinct) and the `instinct` slow-mo source. 20 since story 4.4 (merged after 2.8): `world.sequence` (the special sequence) and the `sequence` flow state. 19 since story 2.8 (merged after 4.3): `difficultyTier` (`SetDifficultyTier`). 18 since story 4.3 (merged after 2.7): `gauges.bladderPct` / `isBladderFull` and the `onToilet` Papa state. 17 since story 2.7: `input.lagMs` (`SetInputLag`). 16 since story 4.2: `world.combo`, `score.comboPoints`, the `comboCashIn` slow-mo. 15 since story 4.1: `world.carry`, `papa.intent`, the `carried` baby state. 14 since story 3.2: `score.final.lostStars`. 13 since story 2.1: `feel`, the effective feel (a `SetFeel` changes it). 12 since story 3.1: `gauges.noisePct` / `propNoiseAt` and `baby.cryStartedAt` / `cryEndsAt`. 11 since story 1.23: `PendingPress.heldAt` (the hold-ring closed). 10 since story 1.22: `score` (Mama's counters and, once the level has ended, her note). 9 since story 1.21: `silence` (the suspicious silence), `mess.mischiefs`, the `hidden` threat
   * state and the `mischiefSilent` baby state. 8 since story 1.20: `disruptions` (one instance per planned disruption) and the `onPhone`
   * state. 7 added `gauges`, `PapaSlice.objectId` / `busyUntil` and the `drink` / `asleep`
   * states. 6 added `director`, `flow` and `ThreatInstance.waveIndex` (story 1.18). 5 added the
   * Rapier world, base64 (4 carried the base scale and the slow-mos in `World.time`, since story
   * 1.14; 3 named the level).
   */
  version: 33;
  seed: number;
  feelHash: string;
  geometryHash: string;
  levelHash: string;
  world: World;
  /** Rapier's own snapshot of the props' bodies, base64 of its bytes: a snapshot stays JSON. */
  physics: string;
}

export function takeSnapshot(
  world: World,
  seed: number,
  feelHash: string,
  geometryHash: string,
  levelHash: string,
  physics: Uint8Array,
): SimSnapshot {
  return {
    version: 33,
    seed,
    feelHash,
    geometryHash,
    levelHash,
    world: cloneJson(world),
    physics: encodeBase64(physics),
  };
}

function papaProblem(
  papa: unknown,
  // The ids Papa's walk may go to: the level's objects and, in the final rush, its props (story 3.5).
  objectIds: readonly string[],
  babyState: unknown,
  hasBladder: boolean,
  // The objects that are a chore's station: a glide with no threat goes to one of them (story 9.4).
  stationIds: readonly string[],
): string | null {
  if (typeof papa !== 'object' || papa === null) return 'world.papa is missing';
  const slice = papa as Record<string, unknown>;
  if (!PAPA_STATES.includes(slice.state as (typeof PAPA_STATES)[number])) {
    return 'world.papa.state';
  }
  for (const key of [
    'enteredAt',
    'xM',
    'zM',
    'prevXM',
    'prevZM',
    'headingX',
    'headingZ',
    'dirX',
    'dirZ',
  ]) {
    if (typeof slice[key] !== 'number' || !Number.isFinite(slice[key])) {
      return `world.papa.${key}`;
    }
  }
  const { path } = slice;
  if (!Array.isArray(path) || path.length % 2 !== 0) return 'world.papa.path';
  if (!path.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return 'world.papa.path';
  }
  if (
    !Number.isInteger(slice.pathIndex) ||
    (slice.pathIndex as number) < 0 ||
    (slice.pathIndex as number) * 2 > path.length
  ) {
    return 'world.papa.pathIndex';
  }
  if (typeof slice.isBlocked !== 'boolean') return 'world.papa.isBlocked';
  // The object of the current walk: only a tapped path goes to one, and the level has it.
  if (slice.objectId !== null) {
    if (typeof slice.objectId !== 'string' || !objectIds.includes(slice.objectId)) {
      return 'world.papa.objectId';
    }
    // A glide goes to an object only when it is to a chore's station (story 9.4, `threatId` null).
    if (slice.state !== 'walkPath' && slice.state !== 'pickingUp' && slice.state !== 'glide') {
      return 'world.papa.objectId';
    }
  }
  if (slice.state === 'pickingUp' && slice.objectId === null) return 'world.papa.objectId';
  // What the walk does on arrival (story 4.1): only a tapped path has one, never with an object, and
  // it agrees with the baby: a put-down needs him in the arms, a take needs him out of them.
  if (!PAPA_INTENTS.includes(slice.intent as (typeof PAPA_INTENTS)[number])) {
    return 'world.papa.intent';
  }
  if (slice.intent !== 'none') {
    if (slice.state !== 'walkPath' || slice.objectId !== null) return 'world.papa.intent';
    if ((slice.intent === 'putDownBaby') !== (babyState === 'carried')) return 'world.papa.intent';
  }
  // A busy Papa has an end (`busyUntil` > 0); any other state has none. Busy states have no path,
  // no direction and no glide: the checks below hold them to it.
  if (!isFiniteNumber(slice.busyUntil) || (slice.busyUntil as number) < 0) {
    return 'world.papa.busyUntil';
  }
  const isBusy = isPapaBusy({ state: slice.state as PapaState });
  if (isBusy !== (slice.busyUntil !== 0)) return 'world.papa.busyUntil';
  // The toilet is no place for a baby in the arms (story 4.3): `tapObject` refuses, `takeBaby` is
  // ignored while Papa is busy, so the two never meet.
  if (slice.state === 'onToilet' && babyState === 'carried') return 'world.papa.state';
  // And no toilet without the need gauge: the level has no door (`content:check`).
  if (slice.state === 'onToilet' && !hasBladder) return 'world.papa.state';

  // The state and the data it walks on must agree.
  const dirLength = Math.sqrt((slice.dirX as number) ** 2 + (slice.dirZ as number) ** 2);
  if (slice.state === 'walkDir') {
    if (Math.abs(dirLength - 1) > 1e-6) return 'world.papa.dir';
  } else if (dirLength !== 0) {
    return 'world.papa.dir';
  }
  if (slice.state === 'walkPath') {
    if (path.length === 0 || (slice.pathIndex as number) * 2 >= path.length) {
      return 'world.papa.path';
    }
  } else if (slice.state !== 'glide' && path.length !== 0) {
    return 'world.papa.path';
  }
  // A glide state has a glide, any other does not; a glide has a path (it is fully walked at the step
  // of the arrival, before the state goes back to idle).
  const hasGlide = slice.glide !== null;
  if (hasGlide !== (slice.state === 'glide')) return 'world.papa.glide';
  if (hasGlide) {
    const glide = slice.glide as Record<string, unknown> | undefined;
    if (typeof glide !== 'object' || glide === null) return 'world.papa.glide';
    // A glide to a threat has an integer id and no object; one to a station (story 9.4) has no id and an object.
    if (glide.threatId !== null && !Number.isInteger(glide.threatId)) {
      return 'world.papa.glide.threatId';
    }
    if ((glide.threatId === null) !== (slice.objectId !== null)) return 'world.papa.objectId';
    if (glide.threatId === null && !stationIds.includes(slice.objectId as string)) {
      return 'world.papa.objectId';
    }
    for (const key of ['toXM', 'toZM', 'startedAt', 'arriveAt', 'speedMps']) {
      if (typeof glide[key] !== 'number' || !Number.isFinite(glide[key])) {
        return `world.papa.glide.${key}`;
      }
    }
    // A glide that cannot end would leave Papa stuck in it (`MoveStop` is ignored while it lasts).
    if ((glide.speedMps as number) <= 0) return 'world.papa.glide.speedMps';
    if ((glide.arriveAt as number) < (glide.startedAt as number))
      return 'world.papa.glide.arriveAt';
    if (path.length === 0) return 'world.papa.path';
  }
  const headingLength = Math.sqrt(
    (slice.headingX as number) ** 2 + (slice.headingZ as number) ** 2,
  );
  if (Math.abs(headingLength - 1) > 1e-6) return 'world.papa.heading';
  return null;
}

const BABY_STATES: readonly unknown[] = [
  'wander',
  'babble',
  'targetLocked',
  'approach',
  'act',
  'mischiefSilent',
  'carried',
  'downstairs',
  'carriedUp',
];

function isUnitVector(x: unknown, z: unknown): boolean {
  if (typeof x !== 'number' || typeof z !== 'number') return false;
  return Math.abs(Math.sqrt(x * x + z * z) - 1) <= 1e-6;
}

function babyProblem(
  baby: unknown,
  papa: unknown,
  threats: readonly { id: number }[],
  nowMs: number,
): string | null {
  if (typeof baby !== 'object' || baby === null) return 'world.baby is missing';
  const slice = baby as Record<string, unknown>;
  if (!BABY_STATES.includes(slice.state)) return 'world.baby.state';
  for (const key of [
    'enteredAt',
    'xM',
    'zM',
    'prevXM',
    'prevZM',
    'headingX',
    'headingZ',
    'gazeX',
    'gazeZ',
    'wanderAt',
  ]) {
    if (typeof slice[key] !== 'number' || !Number.isFinite(slice[key])) {
      return `world.baby.${key}`;
    }
  }
  const { path } = slice;
  if (!Array.isArray(path) || path.length % 2 !== 0) return 'world.baby.path';
  if (!path.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return 'world.baby.path';
  }
  if (
    !Number.isInteger(slice.pathIndex) ||
    (slice.pathIndex as number) < 0 ||
    (slice.pathIndex as number) * 2 > path.length
  ) {
    return 'world.baby.pathIndex';
  }
  if (typeof slice.babbling !== 'boolean') return 'world.baby.babbling';
  if (slice.targetThreatId !== null && !Number.isInteger(slice.targetThreatId)) {
    return 'world.baby.targetThreatId';
  }
  if (
    typeof slice.approachSpeedMps !== 'number' ||
    !Number.isFinite(slice.approachSpeedMps) ||
    slice.approachSpeedMps < 0
  ) {
    return 'world.baby.approachSpeedMps';
  }

  // The state and the data it crawls on must agree. An approach may have no path (nowhere to go,
  // or already there).
  if (slice.state === 'wander') {
    if (path.length === 0 || (slice.pathIndex as number) * 2 >= path.length) {
      return 'world.baby.path';
    }
  } else if (slice.state === 'mischiefSilent') {
    // Crawling to the zone (a path left to walk) or sitting in it (none).
    if (path.length !== 0 && (slice.pathIndex as number) * 2 >= path.length) {
      return 'world.baby.path';
    }
  } else if (slice.state !== 'approach' && path.length !== 0) {
    return 'world.baby.path';
  }
  // The baby stares at, crawls to or plays out a target: it has one.
  const needsTarget =
    slice.state === 'targetLocked' ||
    slice.state === 'approach' ||
    slice.state === 'act' ||
    slice.state === 'mischiefSilent';
  if (needsTarget !== (slice.targetThreatId !== null)) return 'world.baby.targetThreatId';
  if (slice.targetThreatId !== null && !threats.some((t) => t.id === slice.targetThreatId)) {
    return 'world.baby.targetThreatId';
  }
  // Only an approach crawls to a threat.
  if (slice.state !== 'approach' && slice.approachSpeedMps !== 0) {
    return 'world.baby.approachSpeedMps';
  }
  if (!isUnitVector(slice.headingX, slice.headingZ)) return 'world.baby.heading';
  if (!isUnitVector(slice.gazeX, slice.gazeZ)) return 'world.baby.gaze';
  // Left at the bottom of the stairs (story 3.15): he climbs back at `downstairsUntil`, later than now
  // (`runAfterEffects` ends it in the step it is reached). Carried back up, Papa is carrying him.
  const { downstairsUntil } = slice;
  if ((slice.state === 'downstairs') !== (downstairsUntil !== null)) {
    return 'world.baby.downstairsUntil';
  }
  if (
    downstairsUntil !== null &&
    (!isFiniteNumber(downstairsUntil) || (downstairsUntil as number) <= 0)
  ) {
    return 'world.baby.downstairsUntil';
  }
  if (
    (slice.state === 'carriedUp') !==
    ((papa as Record<string, unknown>).state === 'carryingUp')
  ) {
    return 'world.baby.state';
  }
  // In Papa's arms (story 4.1) he is at Papa's point: no path, target or approach was checked above.
  if (slice.state === 'carried') {
    const holder = papa as Record<string, unknown>;
    if (slice.xM !== holder.xM || slice.zM !== holder.zM) return 'world.baby.xM';
  }
  // A cry (story 3.1) has both its instants or neither, started no later than now, and ends no
  // earlier than it started.
  const { cryStartedAt, cryEndsAt } = slice;
  if ((cryStartedAt === null) !== (cryEndsAt === null)) return 'world.baby.cryEndsAt';
  if (cryStartedAt !== null) {
    if (
      !isFiniteNumber(cryStartedAt) ||
      (cryStartedAt as number) < 0 ||
      (cryStartedAt as number) > nowMs
    ) {
      return 'world.baby.cryStartedAt';
    }
    if (!isFiniteNumber(cryEndsAt) || (cryEndsAt as number) < (cryStartedAt as number)) {
      return 'world.baby.cryEndsAt';
    }
  }
  return null;
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function windowProblem(value: unknown, where: string): string | null {
  if (typeof value !== 'object' || value === null) return where;
  const fields = value as Record<string, unknown>;
  for (const key of ['windowMs', 'perfectMs', 'toleranceMs', 'bufferMs']) {
    if (!isFiniteNumber(fields[key])) return `${where}.${key}`;
  }
  return null;
}

function pressProblem(press: unknown, where: string): string | null {
  if (typeof press !== 'object' || press === null) return where;
  const fields = press as Record<string, unknown>;
  if (!isFiniteNumber(fields.t)) return `${where}.t`;
  if (fields.quality !== 'perfect' && fields.quality !== 'success') return `${where}.quality`;
  if (!isFiniteNumber(fields.offsetMs)) return `${where}.offsetMs`;
  if (fields.releasedAt !== null && !isFiniteNumber(fields.releasedAt))
    return `${where}.releasedAt`;
  // The ring closed no earlier than the press (the sim also holds it to `holdMinMs`, which the
  // snapshot does not know: only the feel's hash travels with it).
  const { heldAt } = fields;
  if (heldAt !== null && !(isFiniteNumber(heldAt) && (heldAt as number) >= (fields.t as number)))
    return `${where}.heldAt`;
  return null;
}

/** An integer in `[-1, waveCount − 1]`: -1 is « no wave ». */
function isWaveIndex(value: unknown, waveCount: number): boolean {
  return Number.isInteger(value) && (value as number) >= -1 && (value as number) < waveCount;
}

function directorProblem(director: unknown, waveCount: number): string | null {
  if (typeof director !== 'object' || director === null) return 'world.director is missing';
  const slice = director as Record<string, unknown>;
  if (!isWaveIndex(slice.waveIndex, waveCount)) return 'world.director.waveIndex';
  if (!isFiniteNumber(slice.nextAt) || (slice.nextAt as number) < 0) return 'world.director.nextAt';
  return null;
}

function gaugesProblem(
  gauges: unknown,
  hasFatigue: boolean,
  hasNoise: boolean,
  hasBladder: boolean,
  propCount: number,
  nowMs: number,
): string | null {
  if (typeof gauges !== 'object' || gauges === null) return 'world.gauges is missing';
  const slice = gauges as Record<string, unknown>;
  if (
    !isFiniteNumber(slice.fatigue) ||
    (slice.fatigue as number) < 0 ||
    (slice.fatigue as number) > GAUGE_MAX_POINTS
  ) {
    return 'world.gauges.fatigue';
  }
  if (typeof slice.isFatigueAbove !== 'boolean') return 'world.gauges.isFatigueAbove';
  if (
    slice.microSleepAt !== null &&
    (!isFiniteNumber(slice.microSleepAt) || (slice.microSleepAt as number) < 0)
  ) {
    return 'world.gauges.microSleepAt';
  }
  // A micro-sleep is pending exactly while Papa is above the threshold, and only in a level with fatigue.
  if (!hasFatigue && slice.isFatigueAbove) return 'world.gauges.isFatigueAbove';
  if ((slice.microSleepAt !== null) !== slice.isFatigueAbove) return 'world.gauges.microSleepAt';
  // The noise (story 3.1) is held in [0, 100], and is 0 for good in a level without the gauge.
  if (
    !isFiniteNumber(slice.noisePct) ||
    (slice.noisePct as number) < 0 ||
    (slice.noisePct as number) > GAUGE_MAX_POINTS ||
    (!hasNoise && slice.noisePct !== 0)
  ) {
    return 'world.gauges.noisePct';
  }
  // The catastrophe (story 3.16) is held in [0, 100] in every level.
  if (
    !isFiniteNumber(slice.catastrophePct) ||
    (slice.catastrophePct as number) < 0 ||
    (slice.catastrophePct as number) > GAUGE_MAX_POINTS
  ) {
    return 'world.gauges.catastrophePct';
  }
  // The need (story 4.3) is held in [0, 100], and is 0 and not full for good in a level without the
  // gauge. `isBladderFull` is not held to `feel.bladder.slowFromPct`: a `SetFeel` can move the
  // threshold, and the flag follows at the next step.
  if (
    !isFiniteNumber(slice.bladderPct) ||
    (slice.bladderPct as number) < 0 ||
    (slice.bladderPct as number) > GAUGE_MAX_POINTS ||
    (!hasBladder && slice.bladderPct !== 0)
  ) {
    return 'world.gauges.bladderPct';
  }
  if (typeof slice.isBladderFull !== 'boolean' || (!hasBladder && slice.isBladderFull)) {
    return 'world.gauges.isBladderFull';
  }
  const noiseAt = slice.propNoiseAt;
  if (!Array.isArray(noiseAt) || noiseAt.length !== propCount) return 'world.gauges.propNoiseAt';
  for (const at of noiseAt) {
    // A noise instant is in the past (or now): a later one would mute the prop until the clock caught up.
    if (at !== null && (!isFiniteNumber(at) || (at as number) < 0 || (at as number) > nowMs))
      return 'world.gauges.propNoiseAt';
  }
  return null;
}

function disruptionProblem(
  disruption: unknown,
  index: number,
  nowMs: number,
  ringMaxMs: number,
): string | null {
  const where = `world.disruptions[${index}]`;
  if (typeof disruption !== 'object' || disruption === null) return where;
  const instance = disruption as Record<string, unknown>;
  if (!DISRUPTION_STATES.includes(instance.state as (typeof DISRUPTION_STATES)[number])) {
    return `${where}.state`;
  }
  for (const key of ['enteredAt', 'untilAt', 'nextRingingAt']) {
    if (!isFiniteNumber(instance[key]) || (instance[key] as number) < 0) return `${where}.${key}`;
  }
  // A state is entered in the past; a disruption that never started was never entered.
  if ((instance.enteredAt as number) > nowMs) return `${where}.enteredAt`;
  if (instance.state === 'pending' && instance.enteredAt !== 0) return `${where}.enteredAt`;
  // The two instants mean something only while it rings, and are then both in the future of its start.
  const isRinging = instance.state === 'ringing';
  if (isRinging !== (instance.untilAt !== 0)) return `${where}.untilAt`;
  if (isRinging !== (instance.nextRingingAt !== 0)) return `${where}.nextRingingAt`;
  if (isRinging) {
    // It rings from `enteredAt` to exactly `ringMaxMs` later, and its ticks fall on whole periods from
    // there: anything else is a world `tickRinging` would loop on (a tiny `nextRingingAt` and a huge
    // `untilAt` is a burst of ticks in one step).
    const enteredAt = instance.enteredAt as number;
    const untilAt = instance.untilAt as number;
    const nextRingingAt = instance.nextRingingAt as number;
    if (untilAt !== enteredAt + ringMaxMs || untilAt <= nowMs) return `${where}.untilAt`;
    const sinceStartMs = nextRingingAt - enteredAt;
    if (
      sinceStartMs < PHONE_RINGING_EVERY_MS ||
      sinceStartMs % PHONE_RINGING_EVERY_MS !== 0 ||
      nextRingingAt > untilAt + PHONE_RINGING_EVERY_MS
    ) {
      return `${where}.nextRingingAt`;
    }
  }
  return null;
}

function choreProblem(
  chore: unknown,
  index: number,
  nowMs: number,
  beatCount: number,
  hasOpenThreat: boolean,
): string | null {
  const where = `world.chores[${index}]`;
  if (typeof chore !== 'object' || chore === null) return where;
  const instance = chore as Record<string, unknown>;
  if (!CHORE_STATES.includes(instance.state as (typeof CHORE_STATES)[number])) {
    return `${where}.state`;
  }
  if (!CHORE_BEAT_STATES.includes(instance.beatState as (typeof CHORE_BEAT_STATES)[number])) {
    return `${where}.beatState`;
  }
  for (const key of ['enteredAt', 'beatTelegraphAt', 'beatWindowOpenAt']) {
    if (!isFiniteNumber(instance[key]) || (instance[key] as number) < 0) return `${where}.${key}`;
  }
  // A state is entered in the past; a chore that was never touched was never entered.
  if ((instance.enteredAt as number) > nowMs) return `${where}.enteredAt`;
  if (instance.state === 'untouched' && instance.enteredAt !== 0) return `${where}.enteredAt`;
  const beatsDone = instance.beatsDone;
  if (
    !Number.isInteger(beatsDone) ||
    (beatsDone as number) < 0 ||
    (beatsDone as number) > beatCount
  ) {
    return `${where}.beatsDone`;
  }
  // The progress: none before the first touch, all of it exactly when done.
  if (instance.state === 'untouched' && beatsDone !== 0) return `${where}.beatsDone`;
  if ((instance.state === 'done') !== (beatsDone === beatCount)) return `${where}.beatsDone`;
  // A working chore always has a beat: announced, or held for a threat's window.
  if ((instance.state === 'working') !== (instance.beatState !== 'none')) {
    return `${where}.beatState`;
  }
  // The beats missed (story 9.6): a count, never negative.
  const beatsMissed = instance.beatsMissed;
  if (!Number.isInteger(beatsMissed) || (beatsMissed as number) < 0) return `${where}.beatsMissed`;
  // The door (story 9.6): a boolean, open only on a chore whose def has an open threat and that is
  // being worked or waits (`startChore` opens it; the last beat and a caught open threat shut it).
  if (typeof instance.isOpen !== 'boolean') return `${where}.isOpen`;
  if (
    instance.isOpen &&
    (!hasOpenThreat || (instance.state !== 'working' && instance.state !== 'paused'))
  ) {
    return `${where}.isOpen`;
  }
  const windowSlice = instance.responseWindow as Record<string, unknown> | null | undefined;
  if (typeof windowSlice !== 'object' || windowSlice === null) return `${where}.responseWindow`;
  for (const key of ['windowMs', 'perfectMs', 'toleranceMs', 'bufferMs']) {
    if (!isFiniteNumber(windowSlice[key]) || (windowSlice[key] as number) < 0) {
      return `${where}.responseWindow`;
    }
  }
  if (instance.beatState === 'telegraph') {
    if ((instance.beatTelegraphAt as number) > nowMs) return `${where}.beatTelegraphAt`;
    if ((instance.beatWindowOpenAt as number) <= (instance.beatTelegraphAt as number)) {
      return `${where}.beatWindowOpenAt`;
    }
    if ((windowSlice.windowMs as number) <= 0) return `${where}.responseWindow`;
  } else {
    if (instance.beatTelegraphAt !== 0) return `${where}.beatTelegraphAt`;
    if (instance.beatWindowOpenAt !== 0) return `${where}.beatWindowOpenAt`;
    if (
      ['windowMs', 'perfectMs', 'toleranceMs', 'bufferMs'].some((key) => windowSlice[key] !== 0)
    ) {
      return `${where}.responseWindow`;
    }
  }
  return null;
}

/**
 * The house chores (story 9.4): one instance per planned chore, in order; at most one is `working`,
 * and exactly when Papa is in `chore`.
 */
function choresProblem(
  chores: unknown,
  planned: PlannedLevel['chores'],
  papa: unknown,
  nowMs: number,
  threats: readonly ThreatInstance[],
): string | null {
  if (!Array.isArray(chores) || chores.length !== planned.length) return 'world.chores';
  let workingCount = 0;
  for (let i = 0; i < chores.length; i++) {
    const plannedChore = planned[i] as PlannedLevel['chores'][number];
    const problem = choreProblem(
      chores[i],
      i,
      nowMs,
      plannedChore.def.beats.length,
      plannedChore.openThreatIndex !== null,
    );
    if (problem !== null) return problem;
    if ((chores[i] as { state: unknown }).state === 'working') workingCount++;
    // The baby does not head for a door that is shut (story 9.6): the director draws the open threat
    // only while its chore is open, and only a caught threat shuts the door, which ends the threat.
    const openState =
      plannedChore.openThreatIndex === null
        ? undefined
        : threats[plannedChore.openThreatIndex]?.state;
    if (
      (openState === 'telegraph' || openState === 'windowOpen') &&
      (chores[i] as { isOpen: unknown }).isOpen !== true
    ) {
      return `world.chores[${i}].isOpen`;
    }
  }
  if (workingCount > 1) return 'world.chores';
  const isInChore = (papa as Record<string, unknown> | null | undefined)?.state === 'chore';
  if (isInChore !== (workingCount === 1)) return 'world.papa.state';
  return null;
}

function disruptionsProblem(
  disruptions: unknown,
  planned: PlannedLevel['disruptions'],
  nowMs: number,
): string | null {
  if (!Array.isArray(disruptions) || disruptions.length !== planned.length) {
    return 'world.disruptions';
  }
  for (let i = 0; i < disruptions.length; i++) {
    const problem = disruptionProblem(
      disruptions[i],
      i,
      nowMs,
      (planned[i] as PlannedLevel['disruptions'][number]).def.ringMaxMs,
    );
    if (problem !== null) return problem;
  }
  return null;
}

/** Papa is on the phone only after a pick-up: some disruption is `answered` (the call's own life). */
function onPhoneProblem(papa: unknown, disruptions: readonly { state: unknown }[]): string | null {
  const isOnPhone = (papa as Record<string, unknown> | null | undefined)?.state === 'onPhone';
  if (isOnPhone && !disruptions.some((disruption) => disruption.state === 'answered')) {
    return 'world.papa.state';
  }
  return null;
}

/**
 * `ended` before the level's time is up is only a woken Mama (story 3.2): the level has the noise
 * gauge and it stands at 100 %, frozen there by the end. `finalRush` and `photo` (story 3.5) exist
 * only in a level with a final rush, `photo` only once the time is up, and `finalRushAt` is null in
 * `playing` and `sequence`, set in `finalRush` and `photo`, and either in `ended` (set only after a
 * `mamaWoke` in the rush, so only in a level with one). It is never compared with the current
 * `finalRushMs`: a `SetFeel` can move that.
 */
function flowProblem(
  flow: unknown,
  nowMs: number,
  durationMs: number,
  hasNoise: boolean,
  hasFinalRush: boolean,
  gauges: unknown,
  cycle: unknown,
): string | null {
  if (typeof flow !== 'object' || flow === null) return 'world.flow is missing';
  const slice = flow as Record<string, unknown>;
  if (!FLOW_STATES.includes(slice.state as FlowState)) return 'world.flow.state';
  if (!isFiniteNumber(slice.enteredAt) || (slice.enteredAt as number) < 0) {
    return 'world.flow.enteredAt';
  }
  // A state is entered in the past, and the level only ends once its time is up, the noise is full or the cycle is done.
  if ((slice.enteredAt as number) > nowMs) return 'world.flow.enteredAt';
  const { finalRushAt } = slice;
  if (finalRushAt !== null) {
    if (!isFiniteNumber(finalRushAt) || (finalRushAt as number) < 0)
      return 'world.flow.finalRushAt';
    if ((finalRushAt as number) > nowMs || !hasFinalRush) return 'world.flow.finalRushAt';
    // The flow state the rush leaves is entered at or after it.
    if ((finalRushAt as number) > (slice.enteredAt as number)) return 'world.flow.finalRushAt';
  }
  const isRushState = slice.state === 'finalRush' || slice.state === 'photo';
  if (isRushState && (!hasFinalRush || finalRushAt === null)) return 'world.flow.state';
  if (!isRushState && slice.state !== 'ended' && finalRushAt !== null)
    return 'world.flow.finalRushAt';
  // The reason the level ended (story 3.16): null while it is live, one of the reasons once it is over.
  const { endReason } = slice;
  const isOver = slice.state === 'ended' || slice.state === 'photo';
  if (isOver ? !LEVEL_END_REASONS.includes(endReason as LevelEndReason) : endReason !== null) {
    return 'world.flow.endReason';
  }
  if (slice.state === 'photo' && (nowMs < durationMs || endReason !== 'timer')) {
    return 'world.flow.state';
  }
  if (slice.state === 'ended' && nowMs < durationMs) {
    const gaugeSlice = gauges as Record<string, unknown> | null | undefined;
    const completedAt = (cycle as Record<string, unknown> | null | undefined)?.completedAt;
    const isCycleDone = completedAt !== null && completedAt !== undefined;
    const isMamaHome = endReason === 'mamaHome' && gaugeSlice?.catastrophePct === GAUGE_MAX_POINTS;
    const isMamaWoke = hasNoise && gaugeSlice?.noisePct === GAUGE_MAX_POINTS;
    if (!isMamaHome && !isCycleDone && !isMamaWoke) return 'world.flow.state';
  }
  return null;
}

function threatProblem(threat: unknown, index: number, waveCount: number): string | null {
  const where = `world.threats[${index}]`;
  if (typeof threat !== 'object' || threat === null) return where;
  const instance = threat as Record<string, unknown>;
  if (!Number.isInteger(instance.id)) return `${where}.id`;
  for (const key of ['defId', 'anchorId']) {
    if (typeof instance[key] !== 'string') return `${where}.${key}`;
  }
  for (const key of ['xM', 'zM', 'enteredAt', 'windowOpenAt']) {
    if (!isFiniteNumber(instance[key])) return `${where}.${key}`;
  }
  if (!THREAT_STATES.includes(instance.state as (typeof THREAT_STATES)[number])) {
    return `${where}.state`;
  }
  // The feint of a `wait` threat (story 4.7): a drawn instant or nothing, and a flag that follows it.
  const { feintAt } = instance;
  if (feintAt !== null && (!isFiniteNumber(feintAt) || (feintAt as number) < 0)) {
    return `${where}.feintAt`;
  }
  if (typeof instance.isFeintGiven !== 'boolean') return `${where}.isFeintGiven`;
  if (instance.isFeintGiven && feintAt === null) return `${where}.isFeintGiven`;
  if (instance.state === 'idle' || instance.state === 'hidden') {
    if (feintAt !== null) return `${where}.feintAt`;
    if (instance.isFeintGiven) return `${where}.isFeintGiven`;
  }
  // The feint comes strictly before the signal, so that a reflex on it can never land in the window.
  if (feintAt !== null && (feintAt as number) >= (instance.windowOpenAt as number)) {
    return `${where}.feintAt`;
  }
  if (instance.responseWindow !== null) {
    const problem = windowProblem(instance.responseWindow, `${where}.responseWindow`);
    if (problem !== null) return problem;
  }
  if (instance.press !== null) {
    const problem = pressProblem(instance.press, `${where}.press`);
    if (problem !== null) return problem;
  }
  // The state and the data it carries must agree.
  const isActive = instance.state === 'telegraph' || instance.state === 'windowOpen';
  if (
    (instance.state === 'idle' || instance.state === 'hidden') &&
    instance.responseWindow !== null
  ) {
    return `${where}.responseWindow`;
  }
  // A hidden silence has no window yet: nothing to open.
  if (instance.state === 'hidden' && instance.windowOpenAt !== 0) return `${where}.windowOpenAt`;
  if (isActive && instance.responseWindow === null) return `${where}.responseWindow`;
  if (!isActive && instance.press !== null) return `${where}.press`;
  // The wave that telegraphed it, or -1 (idle, or no wave planned it); an idle threat has none.
  if (!isWaveIndex(instance.waveIndex, waveCount)) return `${where}.waveIndex`;
  if (instance.state === 'idle' && instance.waveIndex !== -1) return `${where}.waveIndex`;
  return null;
}

/** What `worldProblem` needs of the level: its waves, and the defs it plans and its props, in order (both are index-aligned with the world's). */
export interface PlannedLevel {
  /** Only the count is needed: it bounds the wave indices. */
  readonly waves: readonly unknown[];
  /** How long the level lasts, in sim ms: a level that has ended cannot be earlier than this. */
  readonly durationMs: number;
  readonly threats: readonly { readonly def: { readonly id: string } }[];
  /** The planned disruptions: `world.disruptions` is index-aligned with them (story 1.20). */
  readonly disruptions: readonly { readonly def: { readonly ringMaxMs: number } }[];
  /**
   * The planned house chores: `world.chores` is index-aligned with them, the beat count bounds
   * `beatsDone`, the station is the only object a glide with no threat may go to (story 9.4).
   */
  readonly chores: readonly {
    readonly def: { readonly beats: readonly unknown[] };
    readonly objectId: string;
    /** The index in `threats` of the chore's open-door threat, or null when its def has none (story 9.6). */
    readonly openThreatIndex: number | null;
  }[];
  /** The index in `threats` of the micro-sleep, or -1 when the level has no fatigue. */
  readonly microSleepIndex: number;
  /** The index in `threats` of the cry in the arms, or -1 when the level has none (story 4.1). */
  readonly armsCryIndex: number;
  /** Whether the level carries the baby (`SimLevel.hasCarry`, story 4.1): only then can he be `carried`. */
  readonly hasCarry: boolean;
  /** Whether the level has the noise gauge (`SimLevel.hasNoise`, story 3.1). */
  readonly hasNoise: boolean;
  /** Whether the level has the need gauge (`SimLevel.hasBladder`, story 4.3). */
  readonly hasBladder: boolean;
  /** Whether the level has a final rush (`SimLevel.hasFinalRush`, story 3.5): only then can the flow be in it. */
  readonly hasFinalRush: boolean;
  /** The special sequences the level can run, with the length of each one's steps (story 4.4). */
  readonly sequences: readonly {
    readonly id: string;
    readonly def: {
      readonly steps: readonly { readonly kind: string; readonly durationMs: number }[];
      readonly babyCarried: boolean;
      /** A `retreats` failure bounds `world.sequence.duel.retreats` (story 4.6). */
      readonly failure: { readonly kind: string; readonly maxRetreats?: number };
    };
    /** The beat timeline of each step, null for a step that is not a `beats` step (story 4.5). */
    readonly beatTimelines: readonly (
      | readonly { readonly kind: string; readonly offsetMs: number }[]
      | null
    )[];
  }[];
  /** The bedtime cycle (story 4.10): only the entry count is needed, it bounds `cycle.index`. */
  readonly cycle: { readonly entries: readonly unknown[] } | null;
  /** The level's creak zones (story 4.9): only the count is needed, it bounds `stealth.creakZoneIndex`. */
  readonly creakZones: readonly unknown[];
  /** The level's interactive objects: Papa's `objectId` must be one of them or one of `props` (the final rush's mess, story 3.5, and a debris, story 3.15). */
  readonly objects: readonly { readonly id: string }[];
  readonly props: readonly {
    readonly id: string;
    readonly kind: string;
    readonly spawnedAboveFloor: boolean;
  }[];
}
type PlannedThreats = PlannedLevel['threats'];

/**
 * Whether Papa's `objectId` may name a prop (story 3.5): in the rush, and in the frozen states that follow
 * it, since the level can end (timer, `mamaWoke`) while he is still walking to one.
 */
function isPropWalkState(state: unknown): boolean {
  return state === 'finalRush' || state === 'photo' || state === 'ended';
}

/**
 * The ids Papa's `objectId` may name: the level's objects; its props in the final rush and after it
 * (story 3.5), or while he picks one up (story 3.15); outside them, only a debris (a prop the coffee
 * table's gag pushed, `debrisPickUpMs > 0`, story 3.15).
 */
function papaTargetIds(
  planned: PlannedLevel,
  flowState: unknown,
  props: unknown,
  papa: unknown,
): string[] {
  const ids = planned.objects.map((object) => object.id);
  const papaState = (papa as { state?: unknown } | null)?.state;
  if ((planned.hasFinalRush && isPropWalkState(flowState)) || papaState === 'pickingUp') {
    for (const prop of planned.props) ids.push(prop.id);
    return ids;
  }
  if (Array.isArray(props)) {
    for (const prop of props as ({ id?: unknown; debrisPickUpMs?: unknown } | null)[]) {
      if (prop && typeof prop.id === 'string' && Number(prop.debrisPickUpMs) > 0) ids.push(prop.id);
    }
  }
  return ids;
}

function isTimeScale(value: unknown): boolean {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= MIN_TIME_SCALE && value <= 1
  );
}

function slowMoProblem(slowMo: unknown, where: string): string | null {
  if (typeof slowMo !== 'object' || slowMo === null) return where;
  const fields = slowMo as Record<string, unknown>;
  if (!SLOW_MO_SOURCES.includes(fields.source as SlowMoSource)) return `${where}.source`;
  if (!isTimeScale(fields.scale)) return `${where}.scale`;
  for (const key of ['startedAt', 'holdUntil', 'endsAt']) {
    if (!isFiniteNumber(fields[key])) return `${where}.${key}`;
  }
  if ((fields.holdUntil as number) < (fields.startedAt as number)) return `${where}.holdUntil`;
  if ((fields.endsAt as number) < (fields.holdUntil as number)) return `${where}.endsAt`;
  return null;
}

function timeProblem(clock: Record<string, unknown>): string | null {
  if (!isFiniteNumber(clock.sim)) return 'world.time.sim';
  if (!isTimeScale(clock.scale)) return 'world.time.scale';
  if (!isTimeScale(clock.baseScale)) return 'world.time.baseScale';
  const { slowMos } = clock;
  if (!Array.isArray(slowMos)) return 'world.time.slowMos';
  const sources = new Set<unknown>();
  for (let i = 0; i < slowMos.length; i++) {
    const problem = slowMoProblem(slowMos[i], `world.time.slowMos[${i}]`);
    if (problem !== null) return problem;
    const { source } = slowMos[i] as { source: unknown };
    // At most one slow-mo per source: `startSlowMo` merges into the running one.
    if (sources.has(source)) return 'world.time.slowMos';
    sources.add(source);
  }
  return null;
}

function isUnitQuaternion(x: unknown, y: unknown, z: unknown, w: unknown): boolean {
  if (![x, y, z, w].every(isFiniteNumber)) return false;
  const length = Math.sqrt(
    (x as number) ** 2 + (y as number) ** 2 + (z as number) ** 2 + (w as number) ** 2,
  );
  return Math.abs(length - 1) <= QUATERNION_LENGTH_TOLERANCE;
}

function propProblem(prop: unknown, index: number, planned: PlannedLevel['props']): string | null {
  const where = `world.props[${index}]`;
  if (typeof prop !== 'object' || prop === null) return where;
  const slice = prop as Record<string, unknown>;
  const spec = planned[index];
  if (slice.id !== spec?.id) return `${where}.id`;
  if (slice.kind !== spec?.kind) return `${where}.kind`;
  for (const key of ['xM', 'yM', 'zM', 'prevXM', 'prevYM', 'prevZM']) {
    if (!isFiniteNumber(slice[key])) return `${where}.${key}`;
  }
  if (!isUnitQuaternion(slice.qx, slice.qy, slice.qz, slice.qw)) return `${where}.q`;
  if (!isUnitQuaternion(slice.prevQx, slice.prevQy, slice.prevQz, slice.prevQw)) {
    return `${where}.prevQ`;
  }
  for (const key of ['isOnFloor', 'isMess', 'isBroken']) {
    if (typeof slice[key] !== 'boolean') return `${where}.${key}`;
  }
  if (slice.lastImpactAt !== null && !isFiniteNumber(slice.lastImpactAt)) {
    return `${where}.lastImpactAt`;
  }
  // A debris (story 3.15) is picked up in a whole number of ms; 0 is no debris.
  if (!Number.isInteger(slice.debrisPickUpMs) || (slice.debrisPickUpMs as number) < 0) {
    return `${where}.debrisPickUpMs`;
  }
  return null;
}

/** The décor séquelles (story 3.15): the pénombre's end, the debris Papa stands on and the silence's marks. */
function afterEffectsProblem(afterEffects: unknown, propCount: number): string | null {
  if (typeof afterEffects !== 'object' || afterEffects === null) {
    return 'world.afterEffects is missing';
  }
  const slice = afterEffects as Record<string, unknown>;
  if (!isFiniteNumber(slice.dimUntil) || (slice.dimUntil as number) < 0) {
    return 'world.afterEffects.dimUntil';
  }
  const stepped = slice.steppedDebrisIndex;
  if (!Number.isInteger(stepped) || (stepped as number) < -1 || (stepped as number) >= propCount) {
    return 'world.afterEffects.steppedDebrisIndex';
  }
  const marks = slice.mischiefMarks;
  if (!Array.isArray(marks)) return 'world.afterEffects.mischiefMarks';
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i] as Record<string, unknown> | null;
    const where = `world.afterEffects.mischiefMarks[${i}]`;
    if (typeof mark !== 'object' || mark === null) return where;
    if (!(GAG_IDS as readonly unknown[]).includes(mark.gag)) return `${where}.gag`;
    if (!isFiniteNumber(mark.xM)) return `${where}.xM`;
    if (!isFiniteNumber(mark.zM)) return `${where}.zM`;
  }
  return null;
}

/**
 * The suspicious silence (story 1.21) and the world agree: it names the one `hidden` threat, its
 * instants come in order and are not in the future, and the baby is `mischiefSilent` on that threat
 * exactly while there is one and babbles exactly until it has entered the zone. A level that has
 * ended closes the silence (`SilenceEnded{levelEnded}`) and leaves the baby and the threat as they
 * were: the coupling is then not checked.
 */
function silenceProblem(
  silence: unknown,
  baby: unknown,
  threats: readonly { id: number; state: unknown }[],
  nowMs: number,
  isEnded: boolean,
): string | null {
  if (typeof silence !== 'object' || silence === null) return 'world.silence is missing';
  const slice = silence as Record<string, unknown>;
  const { threatId, zoneEnteredAt, startedAt } = slice;
  if (threatId !== null) {
    if (!Number.isInteger(threatId)) return 'world.silence.threatId';
    const threat = threats.find((candidate) => candidate.id === threatId);
    if (threat === undefined || threat.state !== 'hidden') return 'world.silence.threatId';
  }
  if (zoneEnteredAt !== null) {
    if (!isFiniteNumber(zoneEnteredAt) || threatId === null || (zoneEnteredAt as number) > nowMs) {
      return 'world.silence.zoneEnteredAt';
    }
  }
  if (startedAt !== null) {
    if (!isFiniteNumber(startedAt) || zoneEnteredAt === null) return 'world.silence.startedAt';
    if ((startedAt as number) < (zoneEnteredAt as number)) return 'world.silence.startedAt';
    if ((startedAt as number) > nowMs) return 'world.silence.startedAt';
  }
  const slept = baby as Record<string, unknown>;
  if (slept.babbling !== (zoneEnteredAt === null)) return 'world.silence.zoneEnteredAt';
  if (threatId !== null && slept.targetThreatId !== threatId) return 'world.silence.threatId';
  if (isEnded && threatId === null) return null;
  if ((slept.state === 'mischiefSilent') !== (threatId !== null)) return 'world.silence.threatId';
  // One threat is hidden exactly while the silence names it.
  let hiddenCount = 0;
  for (const threat of threats) if (threat.state === 'hidden') hiddenCount++;
  if (hiddenCount !== (threatId === null ? 0 : 1)) return 'world.silence.threatId';
  return null;
}

/**
 * Carrying (story 4.1): the baby is carried only in a level that carries; `armsCryAt` is a finite
 * instant exactly while the baby is in the arms in a level with a cry in the arms, and null
 * otherwise (`takeBaby` draws it, `putDownBaby` clears it).
 */
function carryProblem(
  carry: unknown,
  baby: unknown,
  hasCarry: boolean,
  hasArmsCry: boolean,
): string | null {
  if (typeof carry !== 'object' || carry === null) return 'world.carry is missing';
  const { armsCryAt } = carry as Record<string, unknown>;
  const isCarried = (baby as Record<string, unknown>).state === 'carried';
  if (isCarried && !hasCarry) return 'world.baby.state';
  if (armsCryAt === null) return isCarried && hasArmsCry ? 'world.carry.armsCryAt' : null;
  if (!isFiniteNumber(armsCryAt) || (armsCryAt as number) < 0) return 'world.carry.armsCryAt';
  if (!hasArmsCry || !isCarried) return 'world.carry.armsCryAt';
  return null;
}

/**
 * The combo (story 4.2): a whole multiplier of at least 1, finite non-negative base points (not
 * whole: they are not `isCount`), and a tick that is due at a finite instant exactly while the baby
 * is in the arms (`takeBaby` starts it, `putDownBaby` stops it). Not checked against `feel.combo`: a
 * `SetFeel` can move the bounds under a running combo.
 */
function comboProblem(combo: unknown, baby: unknown): string | null {
  if (typeof combo !== 'object' || combo === null) return 'world.combo is missing';
  const { multiplier, basePoints, carryTickAt } = combo as Record<string, unknown>;
  if (!Number.isInteger(multiplier) || (multiplier as number) < 1) return 'world.combo.multiplier';
  if (!isFiniteNumber(basePoints) || (basePoints as number) < 0) return 'world.combo.basePoints';
  const isCarried = (baby as Record<string, unknown>).state === 'carried';
  if (carryTickAt === null) return isCarried ? 'world.combo.carryTickAt' : null;
  if (!isFiniteNumber(carryTickAt) || (carryTickAt as number) < 0 || !isCarried) {
    return 'world.combo.carryTickAt';
  }
  return null;
}

/**
 * The special sequence (story 4.4): `id` and `lastId` are null or a planned sequence's id, the
 * instants are finite and not in the future, `stepIndex` is a step of the sequence's def,
 * `endedAt` is null while one runs, `nextMicroSleepAt` is null or finite, and the flow is in
 * `sequence` exactly when `id` is not null (the level's own end closes the sequence first). The
 * clocks are ordered (`startedAt ≤ stepEndsAt ≤ endsAt`, `startedAt ≤ endedAt`), no sequence means
 * step 0 and no micro-sleep due, and a running `babyCarried` sequence has the baby in the arms.
 */
function sequenceProblem(
  sequence: unknown,
  flow: unknown,
  planned: PlannedLevel['sequences'],
  baby: unknown,
  nowMs: number,
  breathBoundMs: number,
  creakZoneCount: number,
): string | null {
  if (typeof sequence !== 'object' || sequence === null) return 'world.sequence is missing';
  const slice = sequence as Record<string, unknown>;
  const isPlanned = (id: unknown): boolean =>
    id === null || (typeof id === 'string' && planned.some((entry) => entry.id === id));
  if (!isPlanned(slice.id)) return 'world.sequence.id';
  if (!isPlanned(slice.lastId)) return 'world.sequence.lastId';
  if (slice.id !== null && slice.lastId !== slice.id) return 'world.sequence.lastId';
  for (const key of ['startedAt', 'endsAt', 'stepEndsAt']) {
    if (!isFiniteNumber(slice[key]) || (slice[key] as number) < 0) return `world.sequence.${key}`;
  }
  if ((slice.startedAt as number) > nowMs) return 'world.sequence.startedAt';
  if ((slice.endsAt as number) < (slice.startedAt as number)) return 'world.sequence.endsAt';
  if (
    (slice.stepEndsAt as number) < (slice.startedAt as number) ||
    (slice.stepEndsAt as number) > (slice.endsAt as number)
  ) {
    return 'world.sequence.stepEndsAt';
  }
  if (slice.endedAt !== null) {
    if (!isFiniteNumber(slice.endedAt) || (slice.endedAt as number) < 0) {
      return 'world.sequence.endedAt';
    }
    if (slice.id !== null || (slice.endedAt as number) > nowMs) return 'world.sequence.endedAt';
    if ((slice.endedAt as number) < (slice.startedAt as number)) return 'world.sequence.endedAt';
  }
  if (slice.nextMicroSleepAt !== null) {
    if (!isFiniteNumber(slice.nextMicroSleepAt) || (slice.nextMicroSleepAt as number) < 0) {
      return 'world.sequence.nextMicroSleepAt';
    }
  }
  const def = planned.find((entry) => entry.id === (slice.id ?? slice.lastId));
  if (!Number.isInteger(slice.stepIndex) || (slice.stepIndex as number) < 0) {
    return 'world.sequence.stepIndex';
  }
  if ((slice.stepIndex as number) >= Math.max(1, def?.def.steps.length ?? 1)) {
    return 'world.sequence.stepIndex';
  }
  if (((flow as { state: unknown }).state === 'sequence') !== (slice.id !== null)) {
    return 'world.sequence.id';
  }
  if (slice.id === null) {
    // `closeSequence` resets both: a stale step or cadence would leak into the next sequence.
    if (slice.stepIndex !== 0) return 'world.sequence.stepIndex';
    if (slice.nextMicroSleepAt !== null) return 'world.sequence.nextMicroSleepAt';
  } else if (
    def?.def.babyCarried === true &&
    (baby as { state?: unknown } | null)?.state !== 'carried'
  ) {
    return 'world.sequence.id';
  }
  return (
    beatProblem(slice, def) ??
    duelProblem(slice, def) ??
    stealthProblem(slice, def, breathBoundMs, creakZoneCount, nowMs)
  );
}

/**
 * The running `beats` step (story 4.5), `world.sequence.beat`: all clear when no sequence runs or
 * the current step is not a `beats` step; in one, `isRunning`, both cursors inside the step's
 * timeline (the judge cursor on a `beat` entry, or past the end), `nextBeatAt` null exactly when no
 * judged beat is left and otherwise the beat's own instant, `wakePct` finite in `[0, 100]`, a spent
 * decoy only right after a decoy, and a finite window.
 */
function beatProblem(
  slice: Record<string, unknown>,
  planned: PlannedLevel['sequences'][number] | undefined,
): string | null {
  const beat = slice.beat;
  if (typeof beat !== 'object' || beat === null) return 'world.sequence.beat is missing';
  const fields = beat as Record<string, unknown>;
  const where = (key: string): string => `world.sequence.beat.${key}`;
  const timeline =
    slice.id === null ? null : (planned?.beatTimelines[slice.stepIndex as number] ?? null);
  if (typeof fields.isRunning !== 'boolean') return where('isRunning');
  if (fields.isRunning !== (timeline !== null)) return where('isRunning');
  if (typeof fields.isDecoySpent !== 'boolean') return where('isDecoySpent');
  if (
    !isFiniteNumber(fields.wakePct) ||
    (fields.wakePct as number) < 0 ||
    (fields.wakePct as number) > 100
  ) {
    return where('wakePct');
  }
  const response = fields.responseWindow;
  if (typeof response !== 'object' || response === null) return where('responseWindow');
  for (const key of ['windowMs', 'perfectMs', 'toleranceMs', 'bufferMs']) {
    const value = (response as Record<string, unknown>)[key];
    if (!isFiniteNumber(value) || (value as number) < 0) return where(`responseWindow.${key}`);
  }
  if (timeline === null) {
    // Clear: a stale cursor would leak into the next `beats` step.
    if (fields.cueIndex !== 0) return where('cueIndex');
    if (fields.judgeIndex !== 0) return where('judgeIndex');
    if (fields.nextBeatAt !== null) return where('nextBeatAt');
    if (fields.isDecoySpent || fields.wakePct !== 0) return where('wakePct');
    return null;
  }
  const { cueIndex, judgeIndex } = fields;
  if (
    !Number.isInteger(cueIndex) ||
    (cueIndex as number) < 0 ||
    (cueIndex as number) > timeline.length
  ) {
    return where('cueIndex');
  }
  if (
    !Number.isInteger(judgeIndex) ||
    (judgeIndex as number) < 0 ||
    (judgeIndex as number) > timeline.length ||
    ((judgeIndex as number) < timeline.length && timeline[judgeIndex as number]?.kind !== 'beat')
  ) {
    return where('judgeIndex');
  }
  const entry = timeline[judgeIndex as number];
  if (entry === undefined) {
    if (fields.nextBeatAt !== null) return where('nextBeatAt');
  } else {
    const step = planned?.def.steps[slice.stepIndex as number];
    if (
      step === undefined ||
      fields.nextBeatAt !== (slice.stepEndsAt as number) - step.durationMs + entry.offsetMs
    ) {
      return where('nextBeatAt');
    }
  }
  const before = timeline[(judgeIndex as number) - 1];
  if (fields.isDecoySpent === true && before?.kind !== 'decoy') return where('isDecoySpent');
  return null;
}

/**
 * The running `duel` step (story 4.6), `world.sequence.duel`: all clear when no sequence runs;
 * in one, `isRunning` exactly when the current step is a `duel` step, `nextRoundAt` null or a finite
 * time (null too while a round is up, and always when no duel runs), and `retreats` a whole number
 * below the def's `maxRetreats` (a sequence that reached it has ended), 0 for any other failure.
 */
function duelProblem(
  slice: Record<string, unknown>,
  planned: PlannedLevel['sequences'][number] | undefined,
): string | null {
  const duel = slice.duel;
  if (typeof duel !== 'object' || duel === null) return 'world.sequence.duel is missing';
  const fields = duel as Record<string, unknown>;
  const where = (key: string): string => `world.sequence.duel.${key}`;
  if (typeof fields.isRunning !== 'boolean') return where('isRunning');
  const isDuelStep =
    slice.id !== null && planned?.def.steps[slice.stepIndex as number]?.kind === 'duel';
  if (fields.isRunning !== isDuelStep) return where('isRunning');
  if (fields.nextRoundAt !== null) {
    if (!isFiniteNumber(fields.nextRoundAt) || (fields.nextRoundAt as number) < 0) {
      return where('nextRoundAt');
    }
    if (!fields.isRunning) return where('nextRoundAt');
  }
  const { retreats } = fields;
  if (!Number.isInteger(retreats) || (retreats as number) < 0) return where('retreats');
  const failure = planned?.def.failure;
  const maxRetreats = failure?.kind === 'retreats' ? (failure.maxRetreats ?? 0) : 0;
  if (slice.id === null || failure?.kind !== 'retreats') {
    if (retreats !== 0) return where('retreats');
  } else if ((retreats as number) >= maxRetreats) {
    return where('retreats');
  }
  return null;
}

/** The most breath a snapshot may hold: the larger capacity of the initial and the effective feel (a `SetFeel` may have moved it). */
function breathBoundMsOf(world: unknown, initialFeel: Feel): number {
  const effective = (world as { feel?: { stealth?: { breathCapacityMs?: unknown } } }).feel;
  const capacityMs = effective?.stealth?.breathCapacityMs;
  return Math.max(
    initialFeel.stealth.breathCapacityMs,
    typeof capacityMs === 'number' && Number.isFinite(capacityMs) ? capacityMs : 0,
  );
}

/**
 * The running `stealth` step (story 4.9), `world.sequence.stealth`: all at rest when no sequence runs
 * or the current step is not a `stealth` step (no exit, no alert due, no breath held, no board, no
 * gasp paid); in one, `isRunning`, a finite exit, and the breath between 0 and the capacity, held only
 * while some is left. `breathHeldAt` and `nextAlertAt` are null or a finite time (a hold is never
 * later than the sim clock), `creakZoneIndex` is -1 or the index of one of the level's creak zones.
 */
function stealthProblem(
  slice: Record<string, unknown>,
  planned: PlannedLevel['sequences'][number] | undefined,
  breathBoundMs: number,
  creakZoneCount: number,
  nowMs: number,
): string | null {
  const stealth = slice.stealth;
  if (typeof stealth !== 'object' || stealth === null) return 'world.sequence.stealth is missing';
  const fields = stealth as Record<string, unknown>;
  const where = (key: string): string => `world.sequence.stealth.${key}`;
  if (typeof fields.isRunning !== 'boolean') return where('isRunning');
  if (typeof fields.isPassagePaid !== 'boolean') return where('isPassagePaid');
  const isStealthStep =
    slice.id !== null && planned?.def.steps[slice.stepIndex as number]?.kind === 'stealth';
  if (fields.isRunning !== isStealthStep) return where('isRunning');
  for (const key of ['exitXM', 'exitZM']) {
    if (!isFiniteNumber(fields[key])) return where(key);
  }
  const { breathLeftMs } = fields;
  if (
    !isFiniteNumber(breathLeftMs) ||
    (breathLeftMs as number) < 0 ||
    (breathLeftMs as number) > breathBoundMs
  ) {
    return where('breathLeftMs');
  }
  for (const key of ['breathHeldAt', 'nextAlertAt']) {
    const value = fields[key];
    if (value !== null && (!isFiniteNumber(value) || (value as number) < 0)) return where(key);
  }
  if (
    !Number.isInteger(fields.creakZoneIndex) ||
    (fields.creakZoneIndex as number) < -1 ||
    (fields.creakZoneIndex as number) >= creakZoneCount
  ) {
    return where('creakZoneIndex');
  }
  if (fields.breathHeldAt !== null && (fields.breathHeldAt as number) > nowMs) {
    return where('breathHeldAt');
  }
  if (fields.breathHeldAt !== null && (breathLeftMs as number) <= 0) return where('breathHeldAt');
  if (!fields.isRunning) {
    // At rest: a stale breath, alert or board would leak into the next stealth step.
    if (fields.exitXM !== 0 || fields.exitZM !== 0) return where('exitXM');
    if (fields.nextAlertAt !== null) return where('nextAlertAt');
    if (fields.breathHeldAt !== null) return where('breathHeldAt');
    if (fields.isPassagePaid) return where('isPassagePaid');
    if (fields.creakZoneIndex !== -1) return where('creakZoneIndex');
  } else if (fields.nextAlertAt === null) {
    return where('nextAlertAt');
  }
  return null;
}

function propsProblem(
  props: unknown,
  mess: unknown,
  planned: PlannedLevel['props'],
): string | null {
  if (!Array.isArray(props) || props.length !== planned.length) return 'world.props';
  for (let i = 0; i < props.length; i++) {
    const problem = propProblem(props[i], i, planned);
    if (problem !== null) return problem;
  }
  if (typeof mess !== 'object' || mess === null) return 'world.mess is missing';
  const counts = mess as Record<string, unknown>;
  for (const key of ['propsOnFloor', 'propsBroken', 'mischiefs']) {
    if (!Number.isInteger(counts[key]) || (counts[key] as number) < 0) return `world.mess.${key}`;
  }
  // The counts are a function of the props: a snapshot that disagrees with itself is damaged.
  let onFloor = 0;
  let broken = 0;
  let isMessWrong = false;
  (props as PropSlice[]).forEach((prop, index) => {
    const isMess =
      !prop.isBroken &&
      prop.isOnFloor &&
      (planned[index] as PlannedLevel['props'][number]).spawnedAboveFloor;
    if (prop.isMess !== isMess) isMessWrong = true;
    if (prop.isBroken) broken++;
    else if (isMess) onFloor++;
  });
  if (isMessWrong) return 'world.props.isMess';
  if (counts.propsOnFloor !== onFloor) return 'world.mess.propsOnFloor';
  if (counts.propsBroken !== broken) return 'world.mess.propsBroken';
  return null;
}

const isCount = (value: unknown): boolean => Number.isInteger(value) && (value as number) >= 0;

/** A non-negative number of whole or half points: the Maison row (story 9.4) and the total it feeds. */
const isHalfCount = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value * 2) && value >= 0;

/** The rows of Mama's note that can end on a half: the Maison row and the total (story 9.4). */
const HALF_POINT_KEYS: readonly string[] = ['homePoints', 'scorePoints'];

const MAMA_SCORE_KEYS = [
  'laughPoints',
  'calmPoints',
  'homePoints',
  'sighPoints',
  'screamPoints',
  'scorePoints',
  'stars',
  'lostStars',
] as const;

/** The level is over: `ended`, or `photo` (story 3.5), where the world is frozen with Mama's note given. */
function isLevelOver(state: unknown): boolean {
  return state === 'ended' || state === 'photo';
}

/**
 * Mama's counters are non-negative integers (her note's rows too, but the Maison row and the total,
 * which can end on a half since story 9.4), and the calm time (story 3.12) is whole steps no later
 * than the clock (the tracker adds one `STEP_MS` per live step); her note (story 1.22) is `null` while the level plays
 * and a whole `MamaScore` once it has ended (`runFlow` gives it in the ending step), with a score of
 * at most `MAMA_SCORE_MAX_POINTS`, and at most five stars, the lost ones included.
 */
function scoreProblem(score: unknown, now: number, isEnded: boolean): string | null {
  if (typeof score !== 'object' || score === null) return 'world.score is missing';
  const slice = score as Record<string, unknown>;
  if (!isCount(slice.perfects)) return 'world.score.perfects';
  if (!isCount(slice.successes)) return 'world.score.successes';
  if (!isCount(slice.nearMisses)) return 'world.score.nearMisses';
  if (!isFiniteNumber(slice.comboPoints) || (slice.comboPoints as number) < 0) {
    return 'world.score.comboPoints';
  }
  if (!isCount(slice.propsTidied)) return 'world.score.propsTidied';
  if (!isCount(slice.calmMs)) return 'world.score.calmMs';
  if ((slice.calmMs as number) % STEP_MS !== 0 || (slice.calmMs as number) > now) {
    return 'world.score.calmMs';
  }
  const { final } = slice;
  if (!isEnded) return final === null ? null : 'world.score.final';
  if (typeof final !== 'object' || final === null) return 'world.score.final';
  const note = final as Record<string, unknown>;
  if (Object.keys(note).length !== MAMA_SCORE_KEYS.length) return 'world.score.final';
  for (const key of MAMA_SCORE_KEYS) {
    const isValid = HALF_POINT_KEYS.includes(key) ? isHalfCount(note[key]) : isCount(note[key]);
    if (!isValid) return `world.score.final.${key}`;
  }
  if ((note.scorePoints as number) > MAMA_SCORE_MAX_POINTS) return 'world.score.final.scorePoints';
  if ((note.stars as number) > STAR_COUNT_MAX) return 'world.score.final.stars';
  if ((note.stars as number) + (note.lostStars as number) > STAR_COUNT_MAX) {
    return 'world.score.final.lostStars';
  }
  return null;
}

/**
 * The effective feel (story 2.1) has the shape of the feel the sim was created with: the same keys,
 * leaf types and array lengths. Ranges are the sender's job (the sim cannot run `FeelSchema`).
 */
function feelProblem(feel: unknown, initial: Feel): string | null {
  if (typeof feel !== 'object' || feel === null) return 'world.feel is missing';
  return feelShapeProblem(initial, feel, 'world.feel');
}

/**
 * Fatherly Instinct (story 2.9): a known state, finite instants, ascending misses that never come
 * from the future, and an `untilAt` that agrees with the state: 0 in `ready`, ahead of or at the
 * clock in `active` (it ends at the first step at or after it), from `enteredAt` on in `cooldown`. An ended level has no `active` instinct: `endLevel` closes it. Not
 * checked against `feel.instinct`: a `SetFeel` can move the bounds under a run.
 */
function instinctProblem(instinct: unknown, now: number, isLevelEnded: boolean): string | null {
  if (typeof instinct !== 'object' || instinct === null) return 'world.instinct is missing';
  const { state, enteredAt, untilAt, missAts } = instinct as Record<string, unknown>;
  if (!INSTINCT_STATES.includes(state as InstinctState)) return 'world.instinct.state';
  if (!isFiniteNumber(enteredAt) || (enteredAt as number) < 0 || (enteredAt as number) > now) {
    return 'world.instinct.enteredAt';
  }
  if (!isFiniteNumber(untilAt) || (untilAt as number) < 0) return 'world.instinct.untilAt';
  if (state === 'ready' && untilAt !== 0) return 'world.instinct.untilAt';
  if (state === 'active' && (isLevelEnded || (untilAt as number) < now)) {
    return 'world.instinct.untilAt';
  }
  if (state === 'cooldown' && (untilAt as number) < (enteredAt as number)) {
    return 'world.instinct.untilAt';
  }
  if (!Array.isArray(missAts)) return 'world.instinct.missAts';
  for (let i = 0; i < missAts.length; i++) {
    const at: unknown = missAts[i];
    if (!isFiniteNumber(at) || (at as number) < 0 || (at as number) > now) {
      return 'world.instinct.missAts';
    }
    if (i > 0 && (at as number) < (missAts[i - 1] as number)) return 'world.instinct.missAts';
  }
  return null;
}

/**
 * The bedtime cycle (story 4.10): at rest in a level with no cycle; otherwise an entry within the
 * level's, due at `nextAt`, and `completedAt` set exactly once past the last entry (then `nextAt` is null).
 */
function cycleProblem(cycle: unknown, planned: PlannedLevel): string | null {
  if (typeof cycle !== 'object' || cycle === null) return 'world.cycle is missing';
  const { index, nextAt, completedAt } = cycle as Record<string, unknown>;
  const entryCount = planned.cycle?.entries.length ?? 0;
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) > entryCount) {
    return 'world.cycle.index';
  }
  if (nextAt !== null && (!isFiniteNumber(nextAt) || (nextAt as number) < 0)) {
    return 'world.cycle.nextAt';
  }
  if (completedAt !== null && (!isFiniteNumber(completedAt) || (completedAt as number) < 0)) {
    return 'world.cycle.completedAt';
  }
  if (planned.cycle === null) {
    if (nextAt !== null) return 'world.cycle.nextAt';
    if (completedAt !== null) return 'world.cycle.completedAt';
    return null;
  }
  const isDone = index === entryCount;
  if ((completedAt !== null) !== isDone) return 'world.cycle.completedAt';
  if ((nextAt === null) !== isDone) return 'world.cycle.nextAt';
  return null;
}

/** The client's input latency: a finite number of ms, never negative (`SetInputLag`). */
function inputProblem(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return 'world.input is missing';
  const { lagMs } = input as Record<string, unknown>;
  if (!isFiniteNumber(lagMs) || (lagMs as number) < 0) return 'world.input.lagMs';
  return null;
}

/** The difficulty tier: one of the known ids (`SetDifficultyTier`). */
function difficultyTierProblem(tier: unknown): string | null {
  return typeof tier === 'string' && (DIFFICULTY_TIER_IDS as readonly string[]).includes(tier)
    ? null
    : 'world.difficultyTier';
}

function worldProblem(world: unknown, planned: PlannedLevel, initialFeel: Feel): string | null {
  if (typeof world !== 'object' || world === null) return 'world must be an object';
  const {
    time,
    rng,
    nextId,
    papa,
    baby,
    threats,
    props,
    mess,
    afterEffects,
    director,
    flow,
    gauges,
    disruptions,
    chores,
    silence,
    cycle,
    carry,
    sequence,
    combo,
    instinct,
    score,
    input,
    difficultyTier,
    feel,
  } = world as Record<string, unknown>;
  const clock = time as Record<string, unknown> | null | undefined;
  if (typeof clock !== 'object' || clock === null) return 'world.time is missing';
  const clockProblem = timeProblem(clock);
  if (clockProblem !== null) return clockProblem;
  const state = rng as Record<string, unknown> | null | undefined;
  if (typeof state !== 'object' || state === null) return 'world.rng is missing';
  for (const key of ['a', 'b', 'c', 'd']) {
    if (!Number.isInteger(state[key])) return `world.rng.${key}`;
  }
  if (!Number.isInteger(nextId)) return 'world.nextId';
  if (!Array.isArray(threats)) return 'world.threats';
  for (let i = 0; i < threats.length; i++) {
    const problem = threatProblem(threats[i], i, planned.waves.length);
    if (problem !== null) return problem;
  }
  // `runThreats` and the director index the level's threats by the instances' index.
  if (threats.length !== planned.threats.length) return 'world.threats';
  const ids = new Set<number>();
  for (let i = 0; i < threats.length; i++) {
    const threat = threats[i] as ThreatInstance;
    if (threat.defId !== (planned.threats[i] as PlannedThreats[number]).def.id) {
      return `world.threats[${i}].defId`;
    }
    if (ids.has(threat.id) || threat.id >= (nextId as number)) return `world.threats[${i}].id`;
    ids.add(threat.id);
  }
  const waveProblem = directorProblem(director, planned.waves.length);
  if (waveProblem !== null) return waveProblem;
  // A threat cannot come from a wave the director has not entered.
  const enteredWave = (director as { waveIndex: number }).waveIndex;
  for (let i = 0; i < threats.length; i++) {
    if ((threats[i] as ThreatInstance).waveIndex > enteredWave)
      return `world.threats[${i}].waveIndex`;
  }
  return (
    disruptionsProblem(disruptions, planned.disruptions, clock.sim as number) ??
    onPhoneProblem(papa, disruptions as readonly { state: unknown }[]) ??
    choresProblem(chores, planned.chores, papa, clock.sim as number, threats as ThreatInstance[]) ??
    cycleProblem(cycle, planned) ??
    flowProblem(
      flow,
      clock.sim as number,
      planned.durationMs,
      planned.hasNoise,
      planned.hasFinalRush,
      gauges,
      cycle,
    ) ??
    gaugesProblem(
      gauges,
      planned.microSleepIndex >= 0,
      planned.hasNoise,
      planned.hasBladder,
      planned.props.length,
      clock.sim as number,
    ) ??
    papaProblem(
      papa,
      papaTargetIds(planned, (flow as { state?: unknown } | null)?.state, props, papa),
      (baby as { state?: unknown } | null)?.state,
      planned.hasBladder,
      planned.chores.map((chore) => chore.objectId),
    ) ??
    babyProblem(baby, papa, threats as readonly ThreatInstance[], clock.sim as number) ??
    carryProblem(carry, baby, planned.hasCarry, planned.armsCryIndex >= 0) ??
    comboProblem(combo, baby) ??
    sequenceProblem(
      sequence,
      flow,
      planned.sequences,
      baby,
      clock.sim as number,
      breathBoundMsOf(world, initialFeel),
      planned.creakZones.length,
    ) ??
    silenceProblem(
      silence,
      baby,
      threats as readonly ThreatInstance[],
      clock.sim as number,
      isLevelOver((flow as { state: unknown }).state),
    ) ??
    propsProblem(props, mess, planned.props) ??
    afterEffectsProblem(afterEffects, planned.props.length) ??
    instinctProblem(
      instinct,
      clock.sim as number,
      isLevelOver((flow as { state: unknown }).state),
    ) ??
    scoreProblem(score, clock.sim as number, isLevelOver((flow as { state: unknown }).state)) ??
    inputProblem(input) ??
    difficultyTierProblem(difficultyTier) ??
    feelProblem(feel, initialFeel)
  );
}

/** What a valid snapshot hands over: a copy of its world and the decoded Rapier bytes. */
export interface RestoredSnapshot {
  world: World;
  physics: Uint8Array;
}

/**
 * A deep copy of the snapshot's world, ready to become the live one, with the Rapier bytes decoded.
 * Everything is checked here, before the caller changes anything: a refused snapshot leaves the sim as it was.
 */
export function worldFromSnapshot(
  snapshot: SimSnapshot,
  seed: number,
  feelHash: string,
  geometryHash: string,
  levelHash: string,
  planned: PlannedLevel,
  initialFeel: Feel,
): RestoredSnapshot {
  invariant(snapshot.version === 33, `unsupported snapshot version ${String(snapshot.version)}`);
  invariant(snapshot.seed === seed, 'the snapshot was taken by a sim with another seed');
  invariant(snapshot.feelHash === feelHash, 'the snapshot was taken by a sim with another feel');
  invariant(
    snapshot.geometryHash === geometryHash,
    'the snapshot was taken by a sim with another level geometry',
  );
  invariant(snapshot.levelHash === levelHash, 'the snapshot was taken by a sim with another level');
  const problem = worldProblem(snapshot.world, planned, initialFeel);
  invariant(problem === null, `invalid snapshot world: ${String(problem)}`);
  invariant(typeof snapshot.physics === 'string', 'invalid snapshot physics: not a string');
  const bytes = decodeBase64(snapshot.physics);
  invariant(bytes.ok, `invalid snapshot physics: ${bytes.ok ? '' : bytes.error}`);
  return { world: cloneJson(snapshot.world), physics: bytes.value };
}
