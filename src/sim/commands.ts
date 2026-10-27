import type { SimMs } from '@shared/time';

/**
 * Everything the outside world may ask of the sim. Every command carries `t`, its own timestamp
 * (the one a judgement uses, never the time of the step that processes it). A command is added
 * together with its handler.
 */
export type SimCommand =
  /** Debug / test command, journaled. Story 2.1's "forced timeScale" reuses it. */
  | { type: 'SetTimeScale'; t: SimMs; scale: number }
  /** Walk to this point of the floor (metres); an unreachable point means the nearest reachable one. */
  | { type: 'TapFloor'; t: SimMs; xM: number; zM: number }
  /** Walk in this direction on the floor (world axes, any length but 0: the sim normalises it) until `MoveStop`. */
  | { type: 'Move'; t: SimMs; dirX: number; dirZ: number }
  /** Stop a `Move`. Ignored while Papa follows a tapped path. */
  | { type: 'MoveStop'; t: SimMs };

/** Every `type` a {@link SimCommand} can have; a journal from outside is checked against it. */
export const COMMAND_TYPES: readonly SimCommand['type'][] = [
  'SetTimeScale',
  'TapFloor',
  'Move',
  'MoveStop',
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
  if (command.type === 'TapFloor') {
    for (const key of ['xM', 'zM']) {
      if (typeof command[key] !== 'number' || !Number.isFinite(command[key])) {
        return `TapFloor: ${key} must be a finite number`;
      }
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
  return null;
}
