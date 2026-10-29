// The public API of the simulation (`@sim`). Everything else in `src/sim` is internal.

export type { BabyState } from './baby/babyFsm.ts';
export type { SimCommand } from './commands.ts';
export type { SimObjectSpec } from './context.ts';
export { type CreateSimOptions, createSim, type Sim } from './createSim.ts';
export { DISRUPTION_STATES, type DisruptionState } from './disruptions/disruptionFsm.ts';
export {
  type FailReason,
  type LevelEndReason,
  type NoiseSource,
  type PhoneRingEndReason,
  type ResponseQuality,
  SIM_EVENT_TYPES,
  type SilenceEndReason,
  type SimEvent,
} from './events.ts';
export type { FeelPatch } from './feel/applyFeelPatch.ts';
export type { FlowState } from './flow/flowFsm.ts';
export type { Journal, JournalEntry } from './journal.ts';
export { isPapaBusy, PAPA_STATES, type PapaState } from './papa/papaFsm.ts';
export { OBJECT_ACTION_KINDS } from './papa/papaSystem.ts';
export { type ReplayOptions, type ReplayResult, replayJournal } from './replay.ts';
export { starsForScore } from './scoring/stars.ts';
export type { SimSnapshot } from './snapshot.ts';
export { GAG_IDS, type GagId, PAPA_ASLEEP_GAG_ID } from './threats/gags.ts';
export type { ThreatState } from './threats/threatFsm.ts';
export type {
  BabySlice,
  DirectorSlice,
  DisruptionInstance,
  FlowSlice,
  GaugesSlice,
  MamaScore,
  MessSlice,
  PapaGlide,
  PapaSlice,
  PendingPress,
  PropSlice,
  ScoreSlice,
  SilenceSlice,
  SlowMo,
  SlowMoSource,
  ThreatInstance,
  World,
} from './world.ts';
