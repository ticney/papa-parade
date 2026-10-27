import type { SimMs } from '@shared/time';

/**
 * Everything the outside world may ask of the sim. Every command carries `t`, its own timestamp
 * (the one a judgement uses, never the time of the step that processes it). A command is added
 * together with its handler.
 */
export type SimCommand =
  /** Debug / test command, journaled. Story 2.1's "forced timeScale" reuses it. */
  { type: 'SetTimeScale'; t: SimMs; scale: number };

/** Every `type` a {@link SimCommand} can have; a journal from outside is checked against it. */
export const COMMAND_TYPES: readonly SimCommand['type'][] = ['SetTimeScale'];

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
  return null;
}
