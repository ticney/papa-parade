// The public API of the simulation (`@sim`). Everything else in `src/sim` is internal.

export type { BabyState } from './baby/babyFsm.ts';
export type { SimCommand } from './commands.ts';
export type { SimObjectSpec } from './context.ts';
export { type CreateSimOptions, createSim, type Sim } from './createSim.ts';
export { silenceLimitProblem } from './director/fairness.ts';
export { DISRUPTION_STATES, type DisruptionState } from './disruptions/disruptionFsm.ts';
export {
  AFTER_EFFECT_KINDS,
  type AfterEffectKind,
  BABY_STIR_REASONS,
  type BabyStirReason,
  type BreathGaspReason,
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
export {
  type EndOfLevelShape,
  type FinalRushRoom,
  type FinalRushShape,
  finalRushProblems,
  playableMsOf,
} from './flow/finalRush.ts';
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
export {
  type CycleDefShape,
  type CycleRoom,
  type CycleShape,
  cycleProblems,
  cycleRoomForGeometry,
} from './sequences/bedtimeCycle.ts';
export {
  type DuelDefShape,
  type DuelLimits,
  type DuelThreatShape,
  duelLimitsOf,
  isDuelStepRunning,
  sequenceDuelProblems,
} from './sequences/bedtimeDuel.ts';
export { openSafeCentreCountOf, sequenceLayProblems } from './sequences/layDown.ts';
export { isBeatStepRunning } from './sequences/lullabyWalk.ts';
export { type SequenceRefusal, sequenceRefusal } from './sequences/sequenceStart.ts';
export {
  isStealthStepRunning,
  type StealthDefShape,
  type StealthRoom,
  type StealthThreatShape,
  sequenceStealthProblems,
  stealthRoomForGeometry,
} from './sequences/stealthExit.ts';
export type { SimSnapshot } from './snapshot.ts';
export {
  AFTER_EFFECT_OF_GAG,
  afterEffectProblem,
  CATASTROPHE_OF_GAG,
  catastropheProblem,
  GAG_IDS,
  type GagId,
  PAPA_ASLEEP_GAG_ID,
} from './threats/gags.ts';
export type { ThreatState } from './threats/threatFsm.ts';
export { holdEndAt } from './timing/holdEnd.ts';
export type {
  AfterEffectsSlice,
  BabySlice,
  BeatSlice,
  ComboSlice,
  CycleSlice,
  DirectorSlice,
  DisruptionInstance,
  DuelSlice,
  FlowSlice,
  GaugesSlice,
  MamaScore,
  MessSlice,
  MischiefMark,
  PapaGlide,
  PapaSlice,
  PendingPress,
  PropSlice,
  ScoreSlice,
  SequenceSlice,
  SilenceSlice,
  SlowMo,
  SlowMoSource,
  StealthSlice,
  ThreatInstance,
  World,
} from './world.ts';
