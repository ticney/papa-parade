// The public API of the simulation (`@sim`). Everything else in `src/sim` is internal.

export type { BabyState } from './baby/babyFsm.ts';
export type { SimCommand } from './commands.ts';
export type { SimObjectSpec } from './context.ts';
export { type CreateSimOptions, createSim, type Sim } from './createSim.ts';
export { DISRUPTION_STATES, type DisruptionState } from './disruptions/disruptionFsm.ts';
export {
  BABY_STIR_REASONS,
  type BabyStirReason,
  COMBO_CHANGE_REASONS,
  type ComboChangeReason,
  type FailReason,
  LEVEL_END_REASONS,
  type LevelEndReason,
  type NoiseSource,
  type PhoneRingEndReason,
  type ResponseQuality,
  SEQUENCE_OUTCOMES,
  type SequenceOutcome,
  SIM_EVENT_TYPES,
  type SilenceEndReason,
  type SimEvent,
  THREAT_CANCEL_REASONS,
  type ThreatCancelReason,
} from './events.ts';
export type { FeelPatch } from './feel/applyFeelPatch.ts';
export { type FlowState, isFlowLive } from './flow/flowFsm.ts';
export type { Journal, JournalEntry } from './journal.ts';
export { isPapaBusy, PAPA_STATES, type PapaState } from './papa/papaFsm.ts';
export { OBJECT_ACTION_KINDS } from './papa/papaSystem.ts';
export { type ReplayOptions, type ReplayResult, replayJournal } from './replay.ts';
export { starsForScore } from './scoring/stars.ts';
export {
  type BeatEntry,
  type BeatEntryKind,
  type BeatTimelineStep,
  type BeatWindowLimits,
  beatTimelineOf,
  beatWindowLimitsOf,
  judgedBeatCountOf,
  sequenceBeatProblems,
} from './sequences/beatClock.ts';
export { isBeatStepRunning } from './sequences/lullabyWalk.ts';
export { type SequenceRefusal, sequenceRefusal } from './sequences/sequenceStart.ts';
export type { SimSnapshot } from './snapshot.ts';
export { GAG_IDS, type GagId, PAPA_ASLEEP_GAG_ID } from './threats/gags.ts';
export type { ThreatState } from './threats/threatFsm.ts';
export type {
  BabySlice,
  BeatSlice,
  ComboSlice,
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
  SequenceSlice,
  SilenceSlice,
  SlowMo,
  SlowMoSource,
  ThreatInstance,
  World,
} from './world.ts';
