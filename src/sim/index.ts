// The public API of the simulation (`@sim`). Everything else in `src/sim` is internal.

export type { BabyState } from './baby/babyFsm.ts';
export type { SimCommand } from './commands.ts';
export { type CreateSimOptions, createSim, type Sim } from './createSim.ts';
export {
  type FailReason,
  type ResponseQuality,
  SIM_EVENT_TYPES,
  type SimEvent,
} from './events.ts';
export type { Journal, JournalEntry } from './journal.ts';
export type { PapaState } from './papa/papaFsm.ts';
export { type ReplayOptions, type ReplayResult, replayJournal } from './replay.ts';
export type { SimSnapshot } from './snapshot.ts';
export { GAG_IDS, type GagId } from './threats/gags.ts';
export type { ThreatState } from './threats/threatFsm.ts';
export type {
  BabySlice,
  PapaGlide,
  PapaSlice,
  PendingPress,
  ThreatInstance,
  World,
} from './world.ts';
