import { DIFFICULTY_TIER_IDS, type DifficultyTierId, PATCH_MAX_DEPTH } from '@shared/constants';
import type { SimMs } from '@shared/time';
import { type FeelPatch, isPlainObject, UNSAFE_PATCH_KEYS } from './feel/applyFeelPatch.ts';

/**
 * Everything the outside world may ask of the sim. Every command carries `t`, its own timestamp
 * (the one a judgement uses, never the time of the step that processes it). A command is added
 * together with its handler.
 */
export type SimCommand =
  /** Debug / test command, journaled. Story 2.1's "forced timeScale" reuses it. */
  | { type: 'SetTimeScale'; t: SimMs; scale: number }
  /**
   * Debug / test command, journaled (story 2.1): lays `patch` over the effective feel
   * (`world.feel`) at the step that applies it, before any system of that step runs. A patch that
   * does not fit the feel's shape is ignored with an `InvariantViolated`; ranges are the sender's job.
   */
  | { type: 'SetFeel'; t: SimMs; patch: FeelPatch }
  /**
   * Debug / test command, journaled like `SetTimeScale`: sets Papa's fatigue to `points` (held in
   * `[0, 100]`) through `addFatigue`, so the threshold logic runs. Ignored in a level with no fatigue.
   */
  | { type: 'SetFatigue'; t: SimMs; points: number }
  /**
   * Debug / test command, journaled like `SetFatigue`: sets the noise to `pct` (held in `[0, 100]`)
   * through `addNoise`, source `debug`. Ignored in a level with no noise gauge (story 3.1).
   */
  | { type: 'SetNoise'; t: SimMs; pct: number }
  /**
   * Debug / test command, the twin of `SetNoise`: sets the need to `pct` (held in `[0, 100]`)
   * through `addBladder`. Ignored in a level with no need gauge (story 4.3).
   */
  | { type: 'SetBladder'; t: SimMs; pct: number }
  /**
   * Debug / test command, journaled like `SetFatigue`: starts the planned disruption number `index`
   * (the waves' `disruptions` flattened in wave order) now, if it is still `pending`; any other
   * state, or an index the level does not have, is ignored with no event (story 1.20).
   */
  | { type: 'StartDisruption'; t: SimMs; index: number }
  /**
   * Debug / test command, journaled like `StartDisruption`: the director picks the idle threat
   * `threatId` now, through the helper a draw uses (a `hidden` silence, or a telegraph), ignoring
   * gaps, `maxSimultaneous` and the lull. Ignored with no event when the threat is unknown, not
   * `idle`, on Papa, or a hidden-zone threat while the baby is not free (story 1.21).
   */
  | { type: 'ForceThreat'; t: SimMs; threatId: number }
  /**
   * Debug / test command, journaled like `StartDisruption` (story 4.4): starts the special sequence
   * `sequenceId` now. Ignored with no event when the level does not plan it or when
   * `sequenceRefusal(world)` is not null (one is under way, the level ended, Papa is busy, the
   * baby is hiding or a phone is ringing). Nothing schedules a sequence in a normal level.
   */
  | { type: 'StartSequence'; t: SimMs; sequenceId: string }
  /**
   * A tap on the baby. During a started silence it finds him; otherwise Papa walks to where the baby
   * is, as `TapFloor` there would (story 1.21; story 4.1 turns this into « take the baby »).
   */
  | { type: 'TapBaby'; t: SimMs }
  /** Walk to this point of the floor (metres); an unreachable point means the nearest reachable one. */
  | { type: 'TapFloor'; t: SimMs; xM: number; zM: number }
  /**
   * Walk to this interactive object of the level; what happens there is the object's (stories 1.19,
   * 1.20). An unknown id does nothing.
   */
  | { type: 'TapObject'; t: SimMs; objectId: string }
  /** Walk in this direction on the floor (world axes, any length but 0: the sim normalises it) until `MoveStop`. */
  | { type: 'Move'; t: SimMs; dirX: number; dirZ: number }
  /** Stop a `Move`. Ignored while Papa follows a tapped path. */
  | { type: 'MoveStop'; t: SimMs }
  /**
   * A tap to the beat (story 4.5): the player walks in time. It names no threat (D2: a beat is not a
   * threat); the sim decides which beat or decoy it is from `t` alone, in a running `beats` step, and
   * ignores it everywhere else. Anywhere on the screen, Space or A. Never followed by a `Release`.
   */
  | { type: 'TapBeat'; t: SimMs }
  /** A finger went down on this threat. The type of the response (Parry or Firmness) is decided at `Release`. */
  | { type: 'PressThreat'; t: SimMs; threatId: number }
  /** The finger went up. It names no threat: it ends every press made before it. */
  | { type: 'Release'; t: SimMs }
  /**
   * Journaled (story 2.7, D1): how long, in ms, the client's input stamps are corrected into the
   * past (the player's screen latency, `visualOffsetMs`). A corrected press reaches the sim `lagMs`
   * after the instant its `t` names, so the sim waits that long before it decides what no command
   * has come to say: a press held `holdMinMs` is a Firmness only `lagMs` later, and a window nobody
   * answered gags `lagMs` later. 0 until this command says otherwise; a level start sends it for a
   * positive lag only, a recalibration sends it whatever it is (so it may be 0).
   */
  | { type: 'SetInputLag'; t: SimMs; lagMs: number }
  /**
   * Journaled (story 2.8, D1): the player's difficulty tier. The client sends it at a level's start
   * when the saved tier is not `normal`, so a journal at `normal` carries no entry. It picks the
   * entry of `feel.difficulty` that the windows of the threats telegraphed from then on read; a
   * window already telegraphed keeps its length.
   */
  | { type: 'SetDifficultyTier'; t: SimMs; tier: DifficultyTierId }
  /**
   * Debug / test command, journaled: pushes a prop with this impulse (N·s, world axes) at its
   * centre of mass and wakes it. An unknown or broken `propId` is ignored. Gameplay pushes props
   * through the `pushProp` helper (a gag), never through a command.
   */
  | {
      type: 'PushProp';
      t: SimMs;
      propId: string;
      impulseXNs: number;
      impulseYNs: number;
      impulseZNs: number;
    };

/** Every `type` a {@link SimCommand} can have; a journal from outside is checked against it. */
export const COMMAND_TYPES: readonly SimCommand['type'][] = [
  'SetTimeScale',
  'SetFeel',
  'SetFatigue',
  'SetNoise',
  'SetBladder',
  'StartDisruption',
  'ForceThreat',
  'StartSequence',
  'TapBaby',
  'TapFloor',
  'TapObject',
  'Move',
  'MoveStop',
  'PressThreat',
  'Release',
  'SetInputLag',
  'SetDifficultyTier',
  'PushProp',
  'TapBeat',
];

/**
 * Why `value` cannot be part of a `SetFeel` patch, or `null`: only plain objects, finite numbers,
 * strings and arrays of those, with no key that reaches the prototype. Depth is bounded by the
 * JSON a caller can build, and a cycle is refused by the depth cap.
 */
function patchValueProblem(value: unknown, path: string, depth: number): string | null {
  if (depth > PATCH_MAX_DEPTH) return `${path} is nested too deep`;
  if (typeof value === 'number') return Number.isFinite(value) ? null : `${path} must be finite`;
  if (typeof value === 'string' || typeof value === 'boolean') return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const problem = patchValueProblem(value[i], `${path}[${i}]`, depth + 1);
      if (problem !== null) return problem;
    }
    return null;
  }
  if (typeof value !== 'object' || value === null || !isPlainObject(value)) {
    return `${path} must be a plain object, a finite number, a string or an array`;
  }
  for (const key of Object.keys(value)) {
    if (UNSAFE_PATCH_KEYS.includes(key)) return `${path} has the forbidden key ${key}`;
    const problem = patchValueProblem(
      (value as Record<string, unknown>)[key],
      `${path}.${key}`,
      depth + 1,
    );
    if (problem !== null) return problem;
  }
  return null;
}

/**
 * Runtime shape check of a command that comes from outside the type system (a bot, the debug
 * panel, a journal file): `null` when well formed, else the reason. Value ranges are not checked
 * here (`clampInvariant` owns them).
 */
export function commandProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'a command must be an object';
  const command = value as Record<string, unknown>;
  if (!COMMAND_TYPES.includes(command.type as SimCommand['type'])) {
    return `unknown command type ${String(command.type)}`;
  }
  if (typeof command.t !== 'number' || !Number.isFinite(command.t)) {
    return `${String(command.type)}: t must be a finite number`;
  }
  if (command.type === 'SetTimeScale' && typeof command.scale !== 'number') {
    return 'SetTimeScale: scale must be a number';
  }
  if (command.type === 'SetFeel') {
    const patch = command.patch;
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      return 'SetFeel: patch must be a plain object';
    }
    const problem = patchValueProblem(patch, 'patch', 0);
    if (problem !== null) return `SetFeel: ${problem}`;
  }
  if (command.type === 'SetFatigue') {
    if (typeof command.points !== 'number' || !Number.isFinite(command.points)) {
      return 'SetFatigue: points must be a finite number';
    }
  }
  if (command.type === 'SetNoise') {
    if (typeof command.pct !== 'number' || !Number.isFinite(command.pct)) {
      return 'SetNoise: pct must be a finite number';
    }
  }
  if (command.type === 'SetBladder') {
    if (typeof command.pct !== 'number' || !Number.isFinite(command.pct)) {
      return 'SetBladder: pct must be a finite number';
    }
  }
  if (command.type === 'StartDisruption') {
    if (!Number.isInteger(command.index) || (command.index as number) < 0) {
      return 'StartDisruption: index must be a non-negative integer';
    }
  }
  if (command.type === 'ForceThreat') {
    if (!Number.isInteger(command.threatId) || (command.threatId as number) < 1) {
      return 'ForceThreat: threatId must be an integer of at least 1';
    }
  }
  if (command.type === 'StartSequence') {
    if (typeof command.sequenceId !== 'string' || command.sequenceId === '') {
      return 'StartSequence: sequenceId must be a non-empty string';
    }
  }
  if (command.type === 'TapFloor') {
    for (const key of ['xM', 'zM']) {
      if (typeof command[key] !== 'number' || !Number.isFinite(command[key])) {
        return `TapFloor: ${key} must be a finite number`;
      }
    }
  }
  if (command.type === 'TapObject') {
    if (typeof command.objectId !== 'string' || command.objectId === '') {
      return 'TapObject: objectId must be a non-empty string';
    }
  }
  if (command.type === 'Move') {
    for (const key of ['dirX', 'dirZ']) {
      if (typeof command[key] !== 'number' || !Number.isFinite(command[key])) {
        return `Move: ${key} must be a finite number`;
      }
    }
    if (command.dirX === 0 && command.dirZ === 0) return 'Move: the direction must not be (0, 0)';
  }
  if (command.type === 'PressThreat') {
    if (!Number.isInteger(command.threatId) || (command.threatId as number) < 1) {
      return 'PressThreat: threatId must be an integer of at least 1';
    }
  }
  if (command.type === 'SetInputLag') {
    if (typeof command.lagMs !== 'number' || !Number.isFinite(command.lagMs) || command.lagMs < 0) {
      return 'SetInputLag: lagMs must be a finite number of at least 0';
    }
  }
  if (command.type === 'SetDifficultyTier') {
    if (!(DIFFICULTY_TIER_IDS as readonly unknown[]).includes(command.tier)) {
      return `SetDifficultyTier: tier must be one of ${DIFFICULTY_TIER_IDS.join(', ')}`;
    }
  }
  if (command.type === 'PushProp') {
    if (typeof command.propId !== 'string' || command.propId === '') {
      return 'PushProp: propId must be a non-empty string';
    }
    for (const key of ['impulseXNs', 'impulseYNs', 'impulseZNs']) {
      if (typeof command[key] !== 'number' || !Number.isFinite(command[key])) {
        return `PushProp: ${key} must be a finite number`;
      }
    }
    if (command.impulseXNs === 0 && command.impulseYNs === 0 && command.impulseZNs === 0) {
      return 'PushProp: the impulse must not be (0, 0, 0)';
    }
  }
  return null;
}
