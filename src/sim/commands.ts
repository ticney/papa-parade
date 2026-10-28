import type { SimMs } from '@shared/time';

/**
 * Everything the outside world may ask of the sim. Every command carries `t`, its own timestamp
 * (the one a judgement uses, never the time of the step that processes it). A command is added
 * together with its handler.
 */
export type SimCommand =
  /** Debug / test command, journaled. Story 2.1's "forced timeScale" reuses it. */
  | { type: 'SetTimeScale'; t: SimMs; scale: number }
  /**
   * Debug / test command, journaled like `SetTimeScale`: sets Papa's fatigue to `points` (held in
   * `[0, 100]`) through `addFatigue`, so the threshold logic runs. Ignored in a level with no fatigue.
   */
  | { type: 'SetFatigue'; t: SimMs; points: number }
  /**
   * Debug / test command, journaled like `SetFatigue`: starts the planned disruption number `index`
   * (the waves' `disruptions` flattened in wave order) now, if it is still `pending`; any other
   * state, or an index the level does not have, is ignored with no event (story 1.20).
   */
  | { type: 'StartDisruption'; t: SimMs; index: number }
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
  /** A finger went down on this threat. The type of the response (Parry or Firmness) is decided at `Release`. */
  | { type: 'PressThreat'; t: SimMs; threatId: number }
  /** The finger went up. It names no threat: it ends every press made before it. */
  | { type: 'Release'; t: SimMs }
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
  'SetFatigue',
  'StartDisruption',
  'TapFloor',
  'TapObject',
  'Move',
  'MoveStop',
  'PressThreat',
  'Release',
  'PushProp',
];

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
  if (command.type === 'SetFatigue') {
    if (typeof command.points !== 'number' || !Number.isFinite(command.points)) {
      return 'SetFatigue: points must be a finite number';
    }
  }
  if (command.type === 'StartDisruption') {
    if (!Number.isInteger(command.index) || (command.index as number) < 0) {
      return 'StartDisruption: index must be a non-negative integer';
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
