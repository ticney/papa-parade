import type { VisibilityCounters } from '@bots/bot';
import { NOISE_SOURCE_IDS } from '@content/schemas/feel';
import {
  type DifficultyTierId,
  SILENCE_SIMULTANEOUS_WEIGHT,
  STAR_COUNT_MAX,
} from '@shared/constants';
import { hashJson } from '@shared/hash';
import {
  AFTER_EFFECT_KINDS,
  type AfterEffectKind,
  type BreathGaspReason,
  LEVEL_END_REASONS,
  type LevelEndReason,
  type NoiseSource,
  PAPA_ASLEEP_GAG_ID,
  type Sim,
  type SimEvent,
} from '@sim';
import { createFairnessCheck } from './fairnessCheck.ts';
import type { HumanComparison } from './humanComparison.ts';
import type { ChronoRingMode } from './simArgs.ts';

/** Every `NoiseSource` the report counts, in file order, then `gag` (a def's own noise, story 9.5), `debug` last (a bot never sends `SetNoise`, so it stays 0). */
const NOISE_SOURCES: readonly NoiseSource[] = [...NOISE_SOURCE_IDS, 'gag', 'debug'];

/** Every `AfterEffectKind` at 0: the report has all its keys, whether or not a séquelle of that kind began. */
const emptyAfterEffects = (): Record<AfterEffectKind, number> =>
  Object.fromEntries(AFTER_EFFECT_KINDS.map((kind) => [kind, 0])) as Record<
    AfterEffectKind,
    number
  >;

const emptyNoiseBySource = (): Record<NoiseSource, number> =>
  Object.fromEntries(NOISE_SOURCES.map((source) => [source, 0])) as Record<NoiseSource, number>;

/** Every `LevelEndReason` at 0: the report has all its keys, whether or not a run ended that way. */
const emptyEndsByReason = (): Record<LevelEndReason, number> =>
  Object.fromEntries(LEVEL_END_REASONS.map((reason) => [reason, 0])) as Record<
    LevelEndReason,
    number
  >;

const FAIL_REASONS = ['early', 'late', 'wrongResponse', 'released', 'acted'] as const;
type FailReasonKey = (typeof FAIL_REASONS)[number];

/** What one run saw of one threat def. */
export interface ThreatTally {
  responses: number;
  perfect: number;
  success: number;
  fail: number;
  failReasons: Record<FailReasonKey, number>;
  /** Sum of `|offsetMs|` over the responses that have one, and how many have one. */
  absOffsetSumMs: number;
  offsetCount: number;
}

/** What one run saw of one wave. */
export interface WaveTally {
  /** The `ThreatTelegraphed` events the wave's director drew. */
  telegraphs: number;
  /** The most threats announced or open at once, counted at this wave's telegraphs (a silence counts for two, as the director does). */
  peakSimultaneous: number;
  /** Whether the count ever went above the wave's `maxSimultaneous`. */
  isOverLimit: boolean;
}

/** The house chores of one run (story 9.4): the beats judged by quality (a missed beat is `fail`), the chores finished and the Maison points they paid. */
export interface ChoreCounts {
  beats: { perfect: number; success: number; fail: number };
  completed: number;
  homePoints: number;
  /** The pots of abandoned chores (story 9.5): telegraphed, lowered in time (`success` / `perfect`), boiled over. */
  abandoned: AbandonedCounts;
  /** Each chore def of the level (story 9.6): whether it was finished in the run (0 or 1) and its beats by quality. */
  byDef: Record<string, DefChoreCounts>;
  /** The objects the chores broke (story 9.6): a missed beat of a def with `missBrokenObjects` breaks that many. */
  objectsBroken: number;
  /** The open-door threats of the chores (story 9.6): telegraphed, closed in time (`success` / `perfect`), the baby got in (gag). */
  open: OpenDoorCounts;
}

/** The threat an abandoned chore turns into (story 9.5), over a run or over the runs. */
export interface AbandonedCounts {
  telegraphed: number;
  resolved: number;
  boiledOver: number;
}

/** One chore def over a run (story 9.6): finished or not, and its beats judged by quality. */
export interface DefChoreCounts {
  completed: number;
  beats: { perfect: number; success: number; fail: number };
}

/** The open-door threats of the chores (story 9.6), over a run or over the runs. */
export interface OpenDoorCounts {
  telegraphed: number;
  closed: number;
  gagged: number;
}

/** The counts of a run that has seen nothing yet; `defIds` are the chore defs the level declares, in order. */
function emptyChoreCounts(defIds: readonly string[] = []): ChoreCounts {
  return {
    beats: { perfect: 0, success: 0, fail: 0 },
    completed: 0,
    homePoints: 0,
    abandoned: { telegraphed: 0, resolved: 0, boiledOver: 0 },
    byDef: Object.fromEntries(
      defIds.map((id) => [id, { completed: 0, beats: { perfect: 0, success: 0, fail: 0 } }]),
    ),
    objectsBroken: 0,
    open: { telegraphed: 0, closed: 0, gagged: 0 },
  };
}

/** One sequence over a run or over the runs (story 4.10): started, won, lost. A level end cuts it: neither. */
export interface SequenceOutcomeCounts {
  started: number;
  won: number;
  lost: number;
}

/** The counts of the sequence `id`, created at zero on first sight. */
function outcomesOf(
  outcomes: Record<string, SequenceOutcomeCounts>,
  id: string,
): SequenceOutcomeCounts {
  if (!Object.hasOwn(outcomes, id)) outcomes[id] = { started: 0, won: 0, lost: 0 };
  return outcomes[id] as SequenceOutcomeCounts;
}

/** What one run produced, kept small: counts, never events. */
export interface RunSummary {
  seed: number;
  worldHash: string;
  responses: number;
  gags: number;
  /**
   * The `NearMiss` events (story 1.22). Mama's « Hurlement » counts these and the frozen ones
   * (`frozenNearMisses`, which the report keeps apart).
   */
  nearMisses: number;
  /** The micro-sleeps telegraphed (`ThreatTelegraphed` of no wave, story 1.19). */
  microSleeps: number;
  /** The coffees drunk (`CoffeeDrunk`). */
  coffees: number;
  /** The `papa_asleep` gags: a missed micro-sleep. */
  asleepGags: number;
  /** The séquelles that began, per kind (`AfterEffectStarted`, story 3.15). */
  afterEffects: Record<AfterEffectKind, number>;
  /** The phones that started to ring (`PhoneRingStarted`, story 1.20). */
  phoneRings: number;
  /** The phones Papa picked up (`PhoneAnswered`). */
  phoneAnswers: number;
  /** The seconds of ringing (`PhoneRinging`: one event is one `PHONE_RINGING_EVERY_MS`; the noise gauge reads the same event). */
  phoneRingingSeconds: number;
  /** The suspicious silences announced (`SilenceStarted`, story 1.21). */
  silences: number;
  /** The silences the baby was found in (`SilenceEnded{found}`). */
  silencesFound: number;
  /** The silences nobody found (`SilenceEnded{timedOut}`): the surprise mischief came. */
  silencesTimedOut: number;
  /** The silences the level ended in (`SilenceEnded{levelEnded}`): neither found nor timed out. */
  silencesCutOff: number;
  /** The `BabyPickedUp` events (story 4.1). */
  babyPickUps: number;
  /** The `BabyPutDown` events. */
  babyPutDowns: number;
  /** The `BabyPutDown{safe}` events: Papa stood in a safe zone. */
  safePutDowns: number;
  /** The cries in the arms telegraphed (`ThreatTelegraphed` of the level's `carry.armsCryDef`). */
  armsCries: number;
  /** The `ThreatCancelled` events, any reason: a threat dropped with no result. */
  cancelledThreats: number;
  /** The `ComboCashedIn` events (story 4.2). The bots never carry, so 0 for a bot. */
  comboCashIns: number;
  /** The sum of `ComboCashedIn.points`, not rounded: what fed the Rire. */
  comboPointsCashed: number;
  /** The highest multiplier a `ComboChanged` reached in the run; 0 if the combo never moved. */
  comboPeakMultiplier: number;
  /** The `InstinctTriggered` events (story 2.9): how often Fatherly Instinct helped in the run. */
  instinctTriggers: number;
  /** The toilet visits finished (`ToiletFinished`, story 4.3). The bots never go, so 0 for a bot. */
  toiletVisits: number;
  /** The house chores of the run (story 9.4): the beats by quality, the chores finished and what they paid. */
  chores: ChoreCounts;
  /**
   * What the `human` bot saw of the run (story 9.8): null for every other bot and in a fixed-camera level. Filled
   * by the runner from the bot's counters, never by the recorder (it reads no bot).
   */
  visibility: VisibilityCounters | null;
  /** The special sequences started (`SequenceStarted`, story 4.4): 0 unless `--sequence` starts one. */
  sequencesStarted: number;
  /** The sequences won (`SequenceEnded{succeeded}`). */
  sequencesSucceeded: number;
  /** The sequences lost (`SequenceEnded{failed}`). */
  sequencesFailed: number;
  /** The steps a `retreats` sequence went back, a duel's gags short of the last (`SequenceStepRetreated`, story 4.6). */
  sequenceRetreats: number;
  /** The judged beats tapped in time (`BeatHit`, story 4.5): 0 outside a lullaby walk. */
  beatsHit: number;
  /** The judged beats settled with no tap on them (`BeatMissed`). */
  beatsMissed: number;
  /** The taps on a decoy (`DecoyTapped`). */
  decoysTapped: number;
  /** The taps on no beat and no decoy (`BeatStrayTapped`). */
  beatsStray: number;
  /** The entries of the bedtime cycle won (`world.cycle.index`): 0 in a level with no cycle. */
  cycleEntriesReached: number;
  /** Each sequence started, won and lost in this run, by id (story 4.10). */
  sequenceOutcomes: Record<string, SequenceOutcomeCounts>;
  /** The boards that creaked under Papa (`FloorCreaked`, story 4.9): 0 outside a stealth step. */
  floorCreaks: number;
  /** The breaths let out loudly (`BreathGasped`), by reason: it ran empty, was let go early, or was not held. */
  breathGasps: Record<BreathGaspReason, number>;
  /** The `nothing` threats answered (`ResponseResolved` of response `nothing`), sat through or touched. */
  nothingResponses: number;
  /** The final rushes begun (`FinalRushStarted`, story 3.5): 0 or 1 a game, 0 in a level without a door. */
  finalRushes: number;
  /** The props put back in the final rush (`PropTidied`, story 3.5). */
  propsTidied: number;
  /**
   * The near misses frozen on the end photo (`NearMissFrozen`, story 3.6): the baby, not carried, within
   * `feel.endOfLevel.frozenNearMissReachM` of the stairs when the level ended. Not in `nearMisses`.
   */
  frozenNearMisses: number;
  /**
   * How many of the three parts of Papa's look the gags showed in the run (`PapaLookChanged`, story 3.7): the
   * parts shown at the end, each worth `feel.mama.laughPerLookPartPoints` in Mama's Laugh.
   */
  lookParts: number;
  /**
   * The highest the need reached in the run, in % to one decimal: the gauge rises silently, so it is
   * read from the world when a visit starts (it is frozen from then on), when it fills, and at the
   * end of the run. 0 in a level with no need gauge.
   */
  bladderPeakPct: number;
  /** The highest `NoiseChanged.noisePct` of the run, in %; 0 if none (a level with no noise gauge, story 3.1). */
  noisePeakPct: number;
  /** The final world's noise, in %, rounded to 0.1 (the decay is silent: the events cannot give it). */
  noiseFinalPct: number;
  /** The sum of the positive `NoiseChanged.deltaPct` per source, in %. */
  noiseBySourcePct: Record<NoiseSource, number>;
  /**
   * The director-drawn windows that broke the fairness rule (story 3.13, `tools/sim/fairnessCheck.ts`):
   * opened closer than `glideMaxMs + fairnessMarginMs` to a window announced before them, inside a
   * found silence's guard, or drawn while a silence was under way. 0 when the director is right.
   */
  fairnessViolations: number;
  /** The director-drawn threats whose window opened later than their telegraph delay: the director waited. */
  stretchedTelegraphs: number;
  /** How much later they opened than their telegraph delay, summed, in ms. */
  stretchSumMs: number;
  commands: number;
  threats: Record<string, ThreatTally>;
  byGag: Record<string, number>;
  /** One per wave of the level, in order. */
  waves: WaveTally[];
  /** Whether the run saw `LevelEnded`. */
  isEnded: boolean;
  /** Why the level ended (`LevelEnded.reason`, story 3.2); null for a run cut before the end. */
  endReason: LevelEndReason | null;
  /** The sim time of `MamaWoke`, in ms; null if Mama did not wake in this run. */
  mamaWokeAtMs: number | null;
  /** The sim time of `LevelEnded{mamaHome}`, in ms (story 3.16); null if Mama did not come home early in this run. */
  mamaHomeAtMs: number | null;
  /** The highest value the catastrophe gauge reached, in % (story 3.16): the max `catastrophePct` of the run's `CatastropheChanged` (the decay is silent, so the peak is exact); 0 when it never rose. */
  catastrophePeakPct: number;
  /** Mama's score and stars (`LevelScored`, story 1.22); null for a run cut before the end. */
  scorePoints: number | null;
  stars: number | null;
  /** The stars Mama took off because she woke (`LevelScored.lostStars`); null for a run cut before the end. */
  lostStars: number | null;
  /** The five rows of Mama's note (`LevelScored`, story 3.12); null for a run cut before the end. */
  rows: ScoreRows | null;
}

/** The five rows of Mama's note as the report keeps them: points earned for Rire, Calme, Maison, and what Soupir and Hurlement took off. */
export interface ScoreRows {
  laughPoints: number;
  calmPoints: number;
  homePoints: number;
  sighPoints: number;
  screamPoints: number;
}

const SCORE_ROW_KEYS = [
  'laughPoints',
  'calmPoints',
  'homePoints',
  'sighPoints',
  'screamPoints',
] as const satisfies readonly (keyof ScoreRows)[];

export interface RunRecorder {
  onEvent(event: SimEvent): void;
  /** Call once the run is over. */
  finish(): RunSummary;
}

/** The tally of `defId` in `tallies`, created empty on first use. */
function tallyOf(tallies: Record<string, ThreatTally>, defId: string): ThreatTally {
  // `hasOwn`: an id such as `constructor` must not find a member of `Object.prototype`.
  if (Object.hasOwn(tallies, defId)) return tallies[defId] as ThreatTally;
  const tally = emptyTally();
  tallies[defId] = tally;
  return tally;
}

const emptyBreathGasps = (): Record<BreathGaspReason, number> => ({
  empty: 0,
  early: 0,
  notHeld: 0,
});

const emptyTally = (): ThreatTally => ({
  responses: 0,
  perfect: 0,
  success: 0,
  fail: 0,
  failReasons: { early: 0, late: 0, wrongResponse: 0, released: 0, acted: 0 },
  absOffsetSumMs: 0,
  offsetCount: 0,
});

/** What the fairness check reads of the level's effective feel (story 3.13, `createFairnessCheck`). */
export interface FairnessSetup {
  /** `movement.glideMaxMs + director.fairnessMarginMs`. */
  readonly spacingMs: number;
  /** The telegraph delay of each def, `def.telegraphDelayMs ?? feel.timing.telegraphDelayDefaultMs`. */
  readonly telegraphDelayMsOf: Readonly<Record<string, number>>;
  /** The held Firmnesses (story 9.7): `holdUntilMs` of each `firm` def that has one, by def id. */
  readonly holdUntilMsOf: Readonly<Record<string, number>>;
  /** `input.holdMinMs`. */
  readonly holdMinMs: number;
}

/**
 * Counts the events of one run of `sim` (created for it, before the first step): responses per
 * threat def, gags, threats at once per wave (against the limits `waves` gives, the level's waves),
 * whether the level ended, and at the end the final world hash and the number of commands sent.
 * `armsCryDef` is the level's `carry.armsCryDef` (story 4.1): its telegraphs are cries in the arms,
 * not micro-sleeps (both are threats no wave planned). `sequenceDefs` are the threats the steps of
 * the level's sequences spawn (a duel's, story 4.6; a stealth step's two alerts, story 4.9): a third kind of threat no wave planned, counted as neither.
 * `abandonedDefs` are the threats the level's chores turn into when abandoned (story 9.5): a fourth kind of
 * threat no wave planned, counted in `chores.abandoned` and as neither a micro-sleep nor a cry.
 * `fairness` (story 3.13) is what the fairness check needs of the level's effective feel; without it
 * the run reports 0 violations and 0 stretched telegraphs.
 */
export function createRunRecorder(
  sim: Sim,
  seed: number,
  waves: readonly { readonly maxSimultaneous: number }[] = [],
  armsCryDef: string | null = null,
  sequenceDefs: ReadonlySet<string> = new Set(),
  fairness: FairnessSetup | null = null,
  abandonedDefs: ReadonlySet<string> = new Set(),
): RunRecorder {
  // Threat ids and defs never change after `createSim`.
  const defIdOf = new Map<number, string>();
  for (const threat of sim.world.threats) defIdOf.set(threat.id, threat.defId);
  const threats: Record<string, ThreatTally> = {};
  const byGag: Record<string, number> = {};
  let responses = 0;
  let gags = 0;
  let nearMisses = 0;
  let microSleeps = 0;
  let coffees = 0;
  let asleepGags = 0;
  let phoneRings = 0;
  let phoneAnswers = 0;
  let phoneRingingSeconds = 0;
  let silences = 0;
  let silencesFound = 0;
  let silencesTimedOut = 0;
  let silencesCutOff = 0;
  let babyPickUps = 0;
  let babyPutDowns = 0;
  let safePutDowns = 0;
  let armsCries = 0;
  let cancelledThreats = 0;
  let comboCashIns = 0;
  let instinctTriggers = 0;
  let comboPointsCashed = 0;
  let comboPeakMultiplier = 0;
  let toiletVisits = 0;
  const chores: ChoreCounts = emptyChoreCounts(sim.chores.map((chore) => chore.def.id));
  // The threat instances that are the open door of a chore (story 9.6), by id: they never change after `createSim`.
  const openDoorThreatIds = new Set<number>();
  for (const chore of sim.chores) {
    const door =
      chore.openThreatIndex === null ? undefined : sim.world.threats[chore.openThreatIndex];
    if (door !== undefined) openDoorThreatIds.add(door.id);
  }
  let sequencesStarted = 0;
  let sequencesSucceeded = 0;
  let sequencesFailed = 0;
  let sequenceRetreats = 0;
  let beatsHit = 0;
  let beatsMissed = 0;
  let decoysTapped = 0;
  let beatsStray = 0;
  const sequenceOutcomes: Record<string, SequenceOutcomeCounts> = {};
  let floorCreaks = 0;
  const breathGasps = emptyBreathGasps();
  let nothingResponses = 0;
  let finalRushes = 0;
  let propsTidied = 0;
  let frozenNearMisses = 0;
  let lookParts = 0;
  let bladderPeakPct = 0;
  let noisePeakPct = 0;
  const noiseBySourcePct = emptyNoiseBySource();
  const afterEffects = emptyAfterEffects();
  // A silence is picked (`ThreatHidden`), then telegraphed only if the baby is found: the pick is
  // what counts against the wave, and the later telegraph of the same threat is not a second one.
  const hiddenThreatIds = new Set<number>();
  // The silences of the run (kept after the reveal): they take two places of the wave's limit, like in the director.
  const silenceThreatIds = new Set<number>();
  const fairnessCheck =
    fairness === null
      ? null
      : createFairnessCheck(fairness.spacingMs, fairness.telegraphDelayMsOf, {
          holdUntilMsOf: fairness.holdUntilMsOf,
          holdMinMs: fairness.holdMinMs,
        });
  const weightOf = (threatId: number): number =>
    silenceThreatIds.has(threatId) ? SILENCE_SIMULTANEOUS_WEIGHT : 1;
  // The threats no wave planned (the micro-sleep, the cry in the arms): they are in no wave's tally
  // and never count against a wave's limit, so their results must not move the active count either.
  const systemThreatIds = new Set<number>();
  const waveTallies: WaveTally[] = waves.map(() => ({
    telegraphs: 0,
    peakSimultaneous: 0,
    isOverLimit: false,
  }));
  // Each telegraph ends in exactly one `ResponseResolved`, or in a `ThreatCancelled` (story 4.1):
  // +1 and −1 give the threats at once.
  let activeCount = 0;
  let isEnded = false;
  let endReason: LevelEndReason | null = null;
  let mamaWokeAtMs: number | null = null;
  let mamaHomeAtMs: number | null = null;
  let catastrophePeakPct = 0;
  let scored: { scorePoints: number; stars: number; lostStars: number; rows: ScoreRows } | null =
    null;
  return {
    onEvent(event) {
      fairnessCheck?.onEvent(event);
      if (event.type === 'ThreatTelegraphed' && hiddenThreatIds.delete(event.threatId)) {
        // The reveal of a silence picked earlier: already counted at its `ThreatHidden`.
      } else if (event.type === 'ThreatHidden') {
        hiddenThreatIds.add(event.threatId);
        silenceThreatIds.add(event.threatId);
        activeCount += SILENCE_SIMULTANEOUS_WEIGHT;
        const wave = waveTallies[event.waveIndex];
        if (wave !== undefined) {
          wave.telegraphs++;
          if (activeCount > wave.peakSimultaneous) wave.peakSimultaneous = activeCount;
          const limit = waves[event.waveIndex]?.maxSimultaneous ?? Number.POSITIVE_INFINITY;
          if (activeCount > limit) wave.isOverLimit = true;
        }
      } else if (event.type === 'ThreatTelegraphed' && event.waveIndex < 0) {
        if (armsCryDef !== null && event.kind === armsCryDef) armsCries++;
        else if (abandonedDefs.has(event.kind)) chores.abandoned.telegraphed++;
        else if (!sequenceDefs.has(event.kind)) microSleeps++;
        systemThreatIds.add(event.threatId);
      } else if (event.type === 'ThreatTelegraphed') {
        activeCount++;
        if (openDoorThreatIds.has(event.threatId)) chores.open.telegraphed++;
        const wave = waveTallies[event.waveIndex];
        if (wave !== undefined) {
          wave.telegraphs++;
          if (activeCount > wave.peakSimultaneous) wave.peakSimultaneous = activeCount;
          const limit = waves[event.waveIndex]?.maxSimultaneous ?? Number.POSITIVE_INFINITY;
          if (activeCount > limit) wave.isOverLimit = true;
        }
      } else if (event.type === 'ThreatCancelled') {
        // A cancelled wave threat leaves the count like a resolved one; a system threat never entered it.
        cancelledThreats++;
        if (!systemThreatIds.has(event.threatId)) activeCount -= weightOf(event.threatId);
      } else if (event.type === 'BabyPickedUp') {
        babyPickUps++;
      } else if (event.type === 'BabyPutDown') {
        babyPutDowns++;
        if (event.safe) safePutDowns++;
      } else if (event.type === 'ToiletFinished') {
        toiletVisits++;
      } else if (event.type === 'ChoreBeatJudged') {
        chores.beats[event.quality]++;
        const planned = sim.chores[event.choreIndex];
        const counts = planned === undefined ? undefined : chores.byDef[planned.def.id];
        if (counts !== undefined) counts.beats[event.quality]++;
        // A missed beat breaks what the def says it breaks (a plate); the cooking breaks nothing.
        if (event.quality === 'fail') chores.objectsBroken += planned?.def.missBrokenObjects ?? 0;
      } else if (event.type === 'ChoreCompleted') {
        chores.completed++;
        chores.homePoints += event.homePoints;
        const counts = chores.byDef[sim.chores[event.choreIndex]?.def.id ?? ''];
        if (counts !== undefined) counts.completed++;
      } else if (event.type === 'SequenceStarted') {
        sequencesStarted++;
        outcomesOf(sequenceOutcomes, event.id).started++;
      } else if (event.type === 'SequenceEnded') {
        if (event.outcome === 'succeeded') {
          sequencesSucceeded++;
          outcomesOf(sequenceOutcomes, event.id).won++;
        } else if (event.outcome === 'failed') {
          sequencesFailed++;
          outcomesOf(sequenceOutcomes, event.id).lost++;
        }
      } else if (event.type === 'SequenceStepRetreated') {
        sequenceRetreats++;
      } else if (event.type === 'BeatHit') {
        beatsHit++;
      } else if (event.type === 'BeatMissed') {
        beatsMissed++;
      } else if (event.type === 'DecoyTapped') {
        decoysTapped++;
      } else if (event.type === 'BeatStrayTapped') {
        beatsStray++;
      } else if (event.type === 'FinalRushStarted') {
        finalRushes++;
      } else if (event.type === 'PropTidied') {
        propsTidied++;
      } else if (event.type === 'NearMissFrozen') {
        frozenNearMisses++;
      } else if (event.type === 'PapaLookChanged') {
        // One event per part per level: the count is the parts shown at the end.
        lookParts++;
      } else if (event.type === 'FloorCreaked') {
        floorCreaks++;
      } else if (event.type === 'BreathGasped') {
        breathGasps[event.reason]++;
      } else if (event.type === 'ToiletStarted' || event.type === 'BladderFilled') {
        // The need is frozen from a visit's start, and full from this event on: its peak so far.
        bladderPeakPct = Math.max(bladderPeakPct, sim.world.gauges.bladderPct);
      } else if (event.type === 'ComboChanged') {
        if (event.multiplier > comboPeakMultiplier) comboPeakMultiplier = event.multiplier;
      } else if (event.type === 'ComboCashedIn') {
        comboCashIns++;
        comboPointsCashed += event.points;
      } else if (event.type === 'InstinctTriggered') {
        instinctTriggers++;
      } else if (event.type === 'LevelEnded') {
        isEnded = true;
        endReason = event.reason;
        if (event.reason === 'mamaHome') mamaHomeAtMs = event.t;
      } else if (event.type === 'CatastropheChanged') {
        if (event.catastrophePct > catastrophePeakPct) catastrophePeakPct = event.catastrophePct;
      } else if (event.type === 'MamaWoke') {
        mamaWokeAtMs = event.t;
      } else if (event.type === 'LevelScored') {
        scored = {
          scorePoints: event.scorePoints,
          stars: event.stars,
          lostStars: event.lostStars,
          rows: {
            laughPoints: event.laughPoints,
            calmPoints: event.calmPoints,
            homePoints: event.homePoints,
            sighPoints: event.sighPoints,
            screamPoints: event.screamPoints,
          },
        };
      } else if (event.type === 'ResponseResolved') {
        if (!systemThreatIds.has(event.threatId)) activeCount -= weightOf(event.threatId);
        responses++;
        const defId = defIdOf.get(event.threatId) ?? `threat_${event.threatId}`;
        if (event.response === 'nothing') nothingResponses++;
        const tally = tallyOf(threats, defId);
        tally.responses++;
        tally[event.quality]++;
        if (abandonedDefs.has(defId) && event.quality !== 'fail') chores.abandoned.resolved++;
        if (openDoorThreatIds.has(event.threatId) && event.quality !== 'fail') chores.open.closed++;
        if (event.quality === 'fail' && event.reason !== undefined) {
          tally.failReasons[event.reason]++;
        }
        if (event.offsetMs !== null) {
          tally.absOffsetSumMs += Math.abs(event.offsetMs);
          tally.offsetCount++;
        }
      } else if (event.type === 'GagTriggered') {
        gags++;
        byGag[event.gag] = countOf(byGag, event.gag) + 1;
        if (event.gag === PAPA_ASLEEP_GAG_ID) asleepGags++;
        // Counted by the gagged threat's def, as the telegraphs and the lowerings are, not by the gag id.
        if (abandonedDefs.has(defIdOf.get(event.threatId) ?? '')) chores.abandoned.boiledOver++;
        // The baby got into the open dishwasher (story 9.6): counted by the threat that gagged, as the pot is.
        if (openDoorThreatIds.has(event.threatId)) chores.open.gagged++;
      } else if (event.type === 'NearMiss') {
        nearMisses++;
      } else if (event.type === 'AfterEffectStarted') {
        afterEffects[event.kind]++;
      } else if (event.type === 'CoffeeDrunk') {
        coffees++;
      } else if (event.type === 'PhoneRingStarted') {
        phoneRings++;
      } else if (event.type === 'PhoneAnswered') {
        phoneAnswers++;
      } else if (event.type === 'PhoneRinging') {
        phoneRingingSeconds++;
      } else if (event.type === 'NoiseChanged') {
        noisePeakPct = Math.max(noisePeakPct, event.noisePct);
        if (event.deltaPct > 0) noiseBySourcePct[event.source] += event.deltaPct;
      } else if (event.type === 'SilenceStarted') {
        silences++;
      } else if (event.type === 'SilenceEnded') {
        if (event.reason === 'found') silencesFound++;
        else if (event.reason === 'timedOut') silencesTimedOut++;
        else silencesCutOff++;
      }
    },
    finish() {
      const fairnessResult = fairnessCheck?.finish() ?? {
        fairnessViolations: 0,
        stretchedTelegraphs: 0,
        stretchSumMs: 0,
      };
      return {
        seed,
        worldHash: hashJson(sim.world),
        responses,
        gags,
        nearMisses,
        microSleeps,
        coffees,
        asleepGags,
        afterEffects: { ...afterEffects },
        phoneRings,
        phoneAnswers,
        phoneRingingSeconds,
        silences,
        silencesFound,
        silencesTimedOut,
        silencesCutOff,
        babyPickUps,
        babyPutDowns,
        safePutDowns,
        armsCries,
        cancelledThreats,
        comboCashIns,
        comboPointsCashed,
        comboPeakMultiplier,
        instinctTriggers,
        toiletVisits,
        chores: {
          ...chores,
          beats: { ...chores.beats },
          abandoned: { ...chores.abandoned },
          byDef: Object.fromEntries(
            Object.entries(chores.byDef).map(([id, counts]) => [
              id,
              { completed: counts.completed, beats: { ...counts.beats } },
            ]),
          ),
          open: { ...chores.open },
        },
        visibility: null,
        sequencesStarted,
        sequencesSucceeded,
        sequencesFailed,
        sequenceRetreats,
        beatsHit,
        beatsMissed,
        decoysTapped,
        beatsStray,
        cycleEntriesReached: sim.world.cycle.index,
        sequenceOutcomes,
        floorCreaks,
        breathGasps: { ...breathGasps },
        nothingResponses,
        finalRushes,
        propsTidied,
        frozenNearMisses,
        lookParts,
        bladderPeakPct: round(Math.max(bladderPeakPct, sim.world.gauges.bladderPct), 1),
        noisePeakPct,
        noiseFinalPct: round(sim.world.gauges.noisePct, 1),
        noiseBySourcePct: { ...noiseBySourcePct },
        ...fairnessResult,
        commands: sim.journal().entries.length,
        threats,
        byGag,
        waves: waveTallies.map((wave) => ({ ...wave })),
        isEnded,
        endReason,
        mamaWokeAtMs,
        mamaHomeAtMs,
        catastrophePeakPct: round(catastrophePeakPct, 1),
        scorePoints: scored?.scorePoints ?? null,
        stars: scored?.stars ?? null,
        lostStars: scored?.lostStars ?? null,
        rows: scored?.rows ?? null,
      };
    },
  };
}

/** The `visibility` block of the report (story 9.8). */
export interface VisibilityReport {
  telegraphs: number;
  seenOffscreen: number;
  cappedMs: number;
  neverSeen: number;
  /** Mean `seenAt − enteredAt` over the threats seen after their telegraph, in ms to one decimal; null if none was. */
  meanSeenDelayMs: number | null;
}

/** Sums the runs' counters into the report block; null unless every run has some (a `human` game of a follow level). */
export function summarizeVisibility(runs: readonly RunSummary[]): VisibilityReport | null {
  if (runs.length === 0) return null;
  const total: VisibilityCounters = {
    telegraphs: 0,
    seenOffscreen: 0,
    cappedMs: 0,
    neverSeen: 0,
    seenLate: 0,
    seenLateDelayMs: 0,
  };
  for (const run of runs) {
    if (run.visibility === null) return null;
    total.telegraphs += run.visibility.telegraphs;
    total.seenOffscreen += run.visibility.seenOffscreen;
    total.cappedMs += run.visibility.cappedMs;
    total.neverSeen += run.visibility.neverSeen;
    total.seenLate += run.visibility.seenLate;
    total.seenLateDelayMs += run.visibility.seenLateDelayMs;
  }
  return {
    telegraphs: total.telegraphs,
    seenOffscreen: total.seenOffscreen,
    cappedMs: total.cappedMs,
    neverSeen: total.neverSeen,
    meanSeenDelayMs: total.seenLate === 0 ? null : round(total.seenLateDelayMs / total.seenLate, 1),
  };
}

export interface ThreatReport {
  responses: number;
  perfect: number;
  success: number;
  fail: number;
  perfectPct: number;
  successPct: number;
  failPct: number;
  failReasons: Record<FailReasonKey, number>;
  meanAbsOffsetMs: number | null;
}

/** What the runs saw of one wave of the level. */
export interface WaveReport {
  fromMs: number;
  maxSimultaneous: number;
  /** Summed over the runs. */
  telegraphs: number;
  /** The most threats at once, over the runs. */
  peakSimultaneous: number;
  /** The runs where the count (a silence counts for two) went above `maxSimultaneous`: always 0 unless the director is wrong. */
  overLimitRuns: number;
}

export interface SimReport {
  level: string;
  bot: string;
  /** The difficulty tier the games were played at (story 2.8). */
  tier: DifficultyTierId;
  /** What the `human` bot was shown (story 3.14): the chrono-ring `on` (the game), or `off` (the playtest of 2026-11-03). */
  chronoRing: ChronoRingMode;
  seed: number;
  runs: number;
  /** Where each game stops at the latest: the cap, or the level's duration. */
  untilSimMs: number;
  /** The runs that saw `LevelEnded`. */
  endedRuns: number;
  /** The ended runs per `LevelEndReason`, every key present (0 when none); they add up to `endedRuns` (story 3.2). */
  endsByReason: Record<LevelEndReason, number>;
  /** Mean sim time of `MamaWoke` over the runs it happened in, in ms to one decimal; null if Mama never woke. */
  mamaWokeMeanAtMs: number | null;
  /** Mean sim time of `LevelEnded{mamaHome}` over the runs it happened in, in ms to one decimal; null if Mama never came home early (story 3.16). */
  mamaHomeMeanAtMs: number | null;
  /** Mean over all the runs of the highest value the catastrophe gauge reached, in % to one decimal; null when there are no runs (story 3.16). */
  meanCatastrophePeakPct: number | null;
  hashes: { feel: string; geometry: string; level: string; bots: string };
  /** Mean of Mama's score over the runs that ended, one decimal; null when none ended. */
  meanScore: number | null;
  /** Mean of Mama's stars over the runs that ended, one decimal; null when none ended. */
  meanStars: number | null;
  /** Mean of each of the five rows of the note over the runs that ended, one decimal; null when none ended (story 3.12). */
  meanRows: ScoreRows | null;
  /** Runs per number of stars, from 0 to 5 (index = stars); they add up to `endedRuns`. */
  starCounts: number[];
  /** `null` when no response was seen (no threat, or a game too short for one): not 0 %. */
  meanSuccessPct: number | null;
  /** Share of perfect responses over every response of every run, in % to one decimal; `null` when there is none (story 3.14). */
  perfectPct: number | null;
  threats: Record<string, ThreatReport>;
  /** One per wave of the level, in order. */
  waves: WaveReport[];
  gags: {
    total: number;
    meanPerRun: number;
    byGag: Record<string, number>;
    /** Total `NearMiss` events over the runs (the stairs' gags today). */
    nearMisses: number;
  };
  /**
   * The séquelles the gags left (`AfterEffectStarted`, story 3.15): the total of each kind over the runs, and
   * all of them per run. `perfect` has none; `idle` piles them up.
   */
  afterEffects: {
    byKind: Record<AfterEffectKind, number>;
    meanPerRun: number;
  };
  /** The director-drawn windows that broke the fairness rule, over the runs: 0 when the director is right (story 3.13, FR75). */
  fairnessViolations: number;
  /** The director-drawn threats whose window opened later than their telegraph delay, over the runs: how often the director waits. */
  stretchedTelegraphs: number;
  /** Mean of how much later they opened, in ms to one decimal; null when none was stretched. */
  meanStretchMs: number | null;
  /** The micro-sleeps telegraphed, over the runs (story 1.19). */
  microSleeps: number;
  /** The coffees drunk, over the runs. */
  coffees: number;
  /** The runs where Papa fell asleep at least once (a missed micro-sleep). */
  asleepRuns: number;
  /** The phones that started to ring, over the runs (story 1.20). */
  phoneRings: number;
  /** The phones Papa picked up, over the runs. */
  phoneAnswers: number;
  /** The seconds of ringing, over the runs (the noise it makes is in `noiseBySourcePct`). */
  phoneRingingSeconds: number;
  /** The suspicious silences announced, over the runs (story 1.21). */
  silences: number;
  /** The silences the baby was found in, over the runs. */
  silencesFound: number;
  /** The silences nobody found, over the runs: each ended in the surprise mischief. */
  silencesTimedOut: number;
  /** The silences the level ended in, over the runs. */
  silencesCutOff: number;
  /** The times Papa took the baby in his arms, over the runs (story 4.1). */
  babyPickUps: number;
  /** The times he set him down, over the runs. */
  babyPutDowns: number;
  /** ...of which in a safe zone. */
  safePutDowns: number;
  /** The cries in the arms telegraphed, over the runs. */
  armsCries: number;
  /** The threats dropped with no result (`ThreatCancelled`), over the runs. */
  cancelledThreats: number;
  /** The combos cashed in, over the runs (story 4.2). */
  comboCashIns: number;
  /** The points of every combo cashed in, over the runs. */
  comboPointsCashed: number;
  /** The highest multiplier any run reached; 0 if no combo ever moved. */
  comboPeakMultiplier: number;
  /** The Fatherly Instincts triggered, over the runs (story 2.9). */
  instinctTriggers: number;
  /** The toilet visits finished, over the runs (story 4.3). */
  toiletVisits: number;
  /**
   * The house chores over the runs (story 9.4): the runs where at least one chore was finished, the beats
   * judged by quality, the mean Maison points the chores paid per run and the mean beats judged per run
   * (a missed beat is announced again, so a clumsy player has more of them).
   */
  chores: {
    runsCompleted: number;
    beats: ChoreCounts['beats'];
    meanHomePoints: number;
    meanBeatsPerRun: number;
    /** The pots of the abandoned chores over the runs (story 9.5): telegraphed, lowered in time, boiled over. */
    abandoned: AbandonedCounts;
    /**
     * Each chore def of the level over the runs (story 9.6): the runs where it was finished, its beats by
     * quality and the mean beats missed per run (each one a gag of the chore: smoke, a broken plate).
     */
    byDef: Record<
      string,
      { runsCompleted: number; beats: ChoreCounts['beats']; meanBeatsMissed: number }
    >;
    /** The mean objects the chores broke per run (story 9.6): the plates, each costing Mama's Soupir. */
    meanObjectsBroken: number;
    /** The open-door threats of the chores over the runs (story 9.6): telegraphed, closed in time, gagged. */
    open: OpenDoorCounts;
  };
  /**
   * What the `human` bot saw of the big room over the runs (story 9.8): the threats telegraphed, the ones first seen
   * through an off-screen bubble, the time spent waiting for a bubble behind the cap of three, the ones closed before
   * they were seen, and the mean delay of the ones seen after their telegraph. Null for the other bots, in a
   * fixed-camera level, and with no run.
   */
  visibility: VisibilityReport | null;
  /** The special sequences started, won and lost, over the runs (story 4.4). */
  sequencesStarted: number;
  sequencesSucceeded: number;
  sequencesFailed: number;
  sequenceRetreats: number;
  /** The lullaby walk's beats over the runs (story 4.5): tapped in time, missed, decoys and stray taps. */
  beatsHit: number;
  beatsMissed: number;
  decoysTapped: number;
  beatsStray: number;
  /** The runs that completed the bedtime cycle (story 4.10). */
  cycleCompleted: number;
  /** Mean over the runs of the entries of the cycle won, to one decimal. */
  cycleEntriesReached: number;
  /** Each sequence started, won and lost, over the runs, by id (story 4.10). */
  sequenceOutcomes: Record<string, SequenceOutcomeCounts>;
  /** The stealth exit's boards that creaked, over the runs (story 4.9). */
  floorCreaks: number;
  /** The breaths let out loudly, over the runs, by reason (story 4.9). */
  breathGasps: Record<BreathGaspReason, number>;
  /** The `nothing` threats answered, over the runs (story 4.9). */
  nothingResponses: number;
  /** The final rushes begun, over the runs (story 3.5). */
  finalRushes: number;
  /** The props put back in the final rush, over the runs (story 3.5). */
  propsTidied: number;
  /** The near misses frozen on the end photo, over the runs (`NearMissFrozen`, story 3.6). */
  frozenNearMisses: number;
  /** The parts of Papa's look the gags showed, over the runs (`PapaLookChanged`, story 3.7). */
  lookParts: number;
  /** Mean of the runs' shown parts of the look, to two decimals (0 to 3). */
  meanLookPartsPerRun: number;
  /** The highest need any run reached, in % to one decimal (0 in a level with no need gauge). */
  bladderPeakPct: number;
  /** Mean of the runs' highest noise, in % to one decimal: does 3.2 end games (story 3.1 open point 2)? */
  noisePeakMeanPct: number;
  /** The highest noise of any run, in %. */
  noisePeakMaxPct: number;
  /** Mean of the final noise of the runs, in % to one decimal. */
  noiseFinalMeanPct: number;
  /** The positive noise per source, summed over the runs, in % to one decimal. */
  noiseBySourcePct: Record<NoiseSource, number>;
  runList: {
    seed: number;
    worldHash: string;
    responses: number;
    /** Share of this run's responses that were perfect, in % to one decimal; null when it had none (story 3.14). */
    perfectPct: number | null;
    gags: number;
    /** The fairness violations of this run (story 3.13). */
    fairnessViolations: number;
    commands: number;
    /** Null for a run cut by `--until-ms` before the level ended. */
    scorePoints: number | null;
    stars: number | null;
    /** Null for a run cut before the end (story 3.2). */
    endReason: LevelEndReason | null;
    lostStars: number | null;
    /** The sim time Mama came home early at, in ms; null if she did not in this run (story 3.16). */
    mamaHomeAtMs: number | null;
    /** The highest value the catastrophe gauge reached in this run, in % (story 3.16). */
    catastrophePeakPct: number;
    /** The five rows of the note; null for a run cut before the end (story 3.12). */
    rows: ScoreRows | null;
    /** The special sequences started, won and lost in this run (story 4.4). */
    sequencesStarted: number;
    sequencesSucceeded: number;
    sequencesFailed: number;
    sequenceRetreats: number;
    /** The lullaby walk's beats in this run (story 4.5). */
    beatsHit: number;
    beatsMissed: number;
    decoysTapped: number;
    beatsStray: number;
  }[];
  /** The bot against the testers' journals (`--compare`, story 3.14); `null` without it. */
  comparison: HumanComparison | null;
}

const round = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor + 0; // + 0: no "-0"
};
const countOf = (counts: Record<string, number>, key: string): number =>
  Object.hasOwn(counts, key) ? (counts[key] as number) : 0;
const pct = (part: number, whole: number): number =>
  whole === 0 ? 0 : round((part / whole) * 100, 1);

export interface ReportInput {
  level: string;
  bot: string;
  tier: DifficultyTierId;
  chronoRing: ChronoRingMode;
  seed: number;
  untilSimMs: number;
  hashes: SimReport['hashes'];
  /** The level's waves: where they start and how many threats they allow at once. */
  waves: readonly { readonly fromMs: number; readonly maxSimultaneous: number }[];
}

/** The perfect responses of one run, over its threats. */
const perfectOf = (run: RunSummary): number =>
  Object.values(run.threats).reduce((sum, tally) => sum + tally.perfect, 0);

const sortedKeys = (record: Record<string, unknown>): string[] => Object.keys(record).sort();

/** Folds the runs into the report. Pure: the same runs give the same report, key for key. */
export function summarizeRuns(input: ReportInput, runs: readonly RunSummary[]): SimReport {
  const merged: Record<string, ThreatTally> = {};
  const byGag: Record<string, number> = {};
  let responses = 0;
  let perfectResponses = 0;
  let good = 0;
  let gags = 0;
  let nearMisses = 0;
  let endedRuns = 0;
  const endsByReason = emptyEndsByReason();
  let mamaWokeCount = 0;
  let mamaWokeSumAtMs = 0;
  let mamaHomeCount = 0;
  let mamaHomeSumAtMs = 0;
  let catastrophePeakSumPct = 0;
  let fairnessViolations = 0;
  let stretchedTelegraphs = 0;
  let stretchSumMs = 0;
  let microSleeps = 0;
  let coffees = 0;
  let asleepRuns = 0;
  let phoneRings = 0;
  let phoneAnswers = 0;
  let phoneRingingSeconds = 0;
  let silences = 0;
  let silencesFound = 0;
  let silencesTimedOut = 0;
  let silencesCutOff = 0;
  let babyPickUps = 0;
  let babyPutDowns = 0;
  let safePutDowns = 0;
  let armsCries = 0;
  let cancelledThreats = 0;
  let comboCashIns = 0;
  let instinctTriggers = 0;
  let comboPointsCashed = 0;
  let comboPeakMultiplier = 0;
  let toiletVisits = 0;
  let choresRunsCompleted = 0;
  const choreBeats = { perfect: 0, success: 0, fail: 0 };
  let choreHomePoints = 0;
  const choreAbandoned: AbandonedCounts = { telegraphed: 0, resolved: 0, boiledOver: 0 };
  const choreByDef: Record<string, { runsCompleted: number; beats: ChoreCounts['beats'] }> = {};
  let choreObjectsBroken = 0;
  const choreOpen: OpenDoorCounts = { telegraphed: 0, closed: 0, gagged: 0 };
  let sequencesStarted = 0;
  let sequencesSucceeded = 0;
  let sequencesFailed = 0;
  let sequenceRetreats = 0;
  let beatsHit = 0;
  let beatsMissed = 0;
  let decoysTapped = 0;
  let beatsStray = 0;
  let cycleCompleted = 0;
  let cycleEntriesSum = 0;
  const sequenceOutcomes: Record<string, SequenceOutcomeCounts> = {};
  let floorCreaks = 0;
  const breathGasps = emptyBreathGasps();
  let nothingResponses = 0;
  let finalRushes = 0;
  let propsTidied = 0;
  let frozenNearMisses = 0;
  let lookParts = 0;
  let bladderPeakPct = 0;
  let noisePeakSumPct = 0;
  let noisePeakMaxPct = 0;
  let noiseFinalSumPct = 0;
  const noiseBySourcePct = emptyNoiseBySource();
  const afterEffectsByKind = emptyAfterEffects();
  let scoredRuns = 0;
  let rowRuns = 0;
  let scoreSum = 0;
  let starSum = 0;
  const starCounts: number[] = Array.from({ length: STAR_COUNT_MAX + 1 }, () => 0);
  const rowSums: ScoreRows = {
    laughPoints: 0,
    calmPoints: 0,
    homePoints: 0,
    sighPoints: 0,
    screamPoints: 0,
  };
  const waves: WaveReport[] = input.waves.map((wave) => ({
    fromMs: wave.fromMs,
    maxSimultaneous: wave.maxSimultaneous,
    telegraphs: 0,
    peakSimultaneous: 0,
    overLimitRuns: 0,
  }));
  for (const run of runs) {
    if (run.isEnded) endedRuns++;
    if (run.endReason !== null) endsByReason[run.endReason]++;
    if (run.mamaWokeAtMs !== null) {
      mamaWokeCount++;
      mamaWokeSumAtMs += run.mamaWokeAtMs;
    }
    if (run.mamaHomeAtMs !== null) {
      mamaHomeCount++;
      mamaHomeSumAtMs += run.mamaHomeAtMs;
    }
    catastrophePeakSumPct += run.catastrophePeakPct;
    if (run.rows !== null) {
      rowRuns++;
      for (const key of SCORE_ROW_KEYS) rowSums[key] += run.rows[key];
    }
    if (run.scorePoints !== null && run.stars !== null) {
      scoredRuns++;
      scoreSum += run.scorePoints;
      starSum += run.stars;
      starCounts[run.stars] = (starCounts[run.stars] ?? 0) + 1;
    }
    run.waves.forEach((tally, index) => {
      const into = waves[index];
      if (into === undefined) return;
      into.telegraphs += tally.telegraphs;
      into.peakSimultaneous = Math.max(into.peakSimultaneous, tally.peakSimultaneous);
      if (tally.isOverLimit) into.overLimitRuns++;
    });
    gags += run.gags;
    nearMisses += run.nearMisses;
    fairnessViolations += run.fairnessViolations;
    stretchedTelegraphs += run.stretchedTelegraphs;
    stretchSumMs += run.stretchSumMs;
    microSleeps += run.microSleeps;
    coffees += run.coffees;
    if (run.asleepGags > 0) asleepRuns++;
    phoneRings += run.phoneRings;
    phoneAnswers += run.phoneAnswers;
    phoneRingingSeconds += run.phoneRingingSeconds;
    silences += run.silences;
    silencesFound += run.silencesFound;
    silencesTimedOut += run.silencesTimedOut;
    silencesCutOff += run.silencesCutOff;
    babyPickUps += run.babyPickUps;
    babyPutDowns += run.babyPutDowns;
    safePutDowns += run.safePutDowns;
    armsCries += run.armsCries;
    cancelledThreats += run.cancelledThreats;
    comboCashIns += run.comboCashIns;
    instinctTriggers += run.instinctTriggers;
    comboPointsCashed += run.comboPointsCashed;
    comboPeakMultiplier = Math.max(comboPeakMultiplier, run.comboPeakMultiplier);
    toiletVisits += run.toiletVisits;
    if (run.chores.completed > 0) choresRunsCompleted++;
    choreBeats.perfect += run.chores.beats.perfect;
    choreBeats.success += run.chores.beats.success;
    choreBeats.fail += run.chores.beats.fail;
    choreHomePoints += run.chores.homePoints;
    choreAbandoned.telegraphed += run.chores.abandoned.telegraphed;
    choreAbandoned.resolved += run.chores.abandoned.resolved;
    choreAbandoned.boiledOver += run.chores.abandoned.boiledOver;
    for (const [id, counts] of Object.entries(run.chores.byDef)) {
      let total = choreByDef[id];
      if (total === undefined) {
        total = { runsCompleted: 0, beats: { perfect: 0, success: 0, fail: 0 } };
        choreByDef[id] = total;
      }
      if (counts.completed > 0) total.runsCompleted++;
      total.beats.perfect += counts.beats.perfect;
      total.beats.success += counts.beats.success;
      total.beats.fail += counts.beats.fail;
    }
    choreObjectsBroken += run.chores.objectsBroken;
    choreOpen.telegraphed += run.chores.open.telegraphed;
    choreOpen.closed += run.chores.open.closed;
    choreOpen.gagged += run.chores.open.gagged;
    sequencesStarted += run.sequencesStarted;
    sequencesSucceeded += run.sequencesSucceeded;
    sequencesFailed += run.sequencesFailed;
    sequenceRetreats += run.sequenceRetreats;
    beatsHit += run.beatsHit;
    beatsMissed += run.beatsMissed;
    decoysTapped += run.decoysTapped;
    beatsStray += run.beatsStray;
    // On the end reason, like `playtest:metrics`: a tie with the noise goes to Mama (`CycleCompleted`, then `mamaWoke`).
    if (run.endReason === 'cycleDone') cycleCompleted++;
    cycleEntriesSum += run.cycleEntriesReached;
    for (const [id, counts] of Object.entries(run.sequenceOutcomes)) {
      const total = outcomesOf(sequenceOutcomes, id);
      total.started += counts.started;
      total.won += counts.won;
      total.lost += counts.lost;
    }
    floorCreaks += run.floorCreaks;
    for (const reason of Object.keys(breathGasps) as BreathGaspReason[]) {
      breathGasps[reason] += run.breathGasps[reason];
    }
    nothingResponses += run.nothingResponses;
    finalRushes += run.finalRushes;
    propsTidied += run.propsTidied;
    frozenNearMisses += run.frozenNearMisses;
    lookParts += run.lookParts;
    bladderPeakPct = Math.max(bladderPeakPct, run.bladderPeakPct);
    noisePeakSumPct += run.noisePeakPct;
    noisePeakMaxPct = Math.max(noisePeakMaxPct, run.noisePeakPct);
    noiseFinalSumPct += run.noiseFinalPct;
    for (const source of NOISE_SOURCES) noiseBySourcePct[source] += run.noiseBySourcePct[source];
    for (const kind of AFTER_EFFECT_KINDS) afterEffectsByKind[kind] += run.afterEffects[kind];
    for (const gag of Object.keys(run.byGag)) {
      byGag[gag] = countOf(byGag, gag) + countOf(run.byGag, gag);
    }
    for (const defId of Object.keys(run.threats)) {
      const from = run.threats[defId] as ThreatTally;
      const into = tallyOf(merged, defId);
      into.responses += from.responses;
      into.perfect += from.perfect;
      into.success += from.success;
      into.fail += from.fail;
      for (const reason of FAIL_REASONS) into.failReasons[reason] += from.failReasons[reason];
      into.absOffsetSumMs += from.absOffsetSumMs;
      into.offsetCount += from.offsetCount;
    }
    responses += run.responses;
    perfectResponses += perfectOf(run);
  }

  const threats: Record<string, ThreatReport> = {};
  for (const defId of sortedKeys(merged)) {
    const tally = merged[defId] as ThreatTally;
    good += tally.perfect + tally.success;
    threats[defId] = {
      responses: tally.responses,
      perfect: tally.perfect,
      success: tally.success,
      fail: tally.fail,
      perfectPct: pct(tally.perfect, tally.responses),
      successPct: pct(tally.success, tally.responses),
      failPct: pct(tally.fail, tally.responses),
      failReasons: { ...tally.failReasons },
      meanAbsOffsetMs:
        tally.offsetCount === 0 ? null : round(tally.absOffsetSumMs / tally.offsetCount, 1),
    };
  }

  const sortedByGag: Record<string, number> = {};
  for (const gag of sortedKeys(byGag)) sortedByGag[gag] = byGag[gag] as number;

  return {
    level: input.level,
    bot: input.bot,
    tier: input.tier,
    chronoRing: input.chronoRing,
    seed: input.seed,
    runs: runs.length,
    untilSimMs: input.untilSimMs,
    endedRuns,
    endsByReason,
    mamaWokeMeanAtMs: mamaWokeCount === 0 ? null : round(mamaWokeSumAtMs / mamaWokeCount, 1),
    mamaHomeMeanAtMs: mamaHomeCount === 0 ? null : round(mamaHomeSumAtMs / mamaHomeCount, 1),
    meanCatastrophePeakPct:
      runs.length === 0 ? null : round(catastrophePeakSumPct / runs.length, 1),
    hashes: input.hashes,
    meanScore: scoredRuns === 0 ? null : round(scoreSum / scoredRuns, 1),
    meanStars: scoredRuns === 0 ? null : round(starSum / scoredRuns, 1),
    meanRows:
      rowRuns === 0
        ? null
        : {
            laughPoints: round(rowSums.laughPoints / rowRuns, 1),
            calmPoints: round(rowSums.calmPoints / rowRuns, 1),
            homePoints: round(rowSums.homePoints / rowRuns, 1),
            sighPoints: round(rowSums.sighPoints / rowRuns, 1),
            screamPoints: round(rowSums.screamPoints / rowRuns, 1),
          },
    starCounts,
    meanSuccessPct: responses === 0 ? null : pct(good, responses),
    perfectPct: responses === 0 ? null : pct(perfectResponses, responses),
    threats,
    waves,
    gags: {
      total: gags,
      meanPerRun: runs.length === 0 ? 0 : round(gags / runs.length, 2),
      byGag: sortedByGag,
      nearMisses,
    },
    afterEffects: {
      byKind: afterEffectsByKind,
      meanPerRun:
        runs.length === 0
          ? 0
          : round(
              AFTER_EFFECT_KINDS.reduce((sum, kind) => sum + afterEffectsByKind[kind], 0) /
                runs.length,
              2,
            ),
    },
    fairnessViolations,
    stretchedTelegraphs,
    meanStretchMs: stretchedTelegraphs === 0 ? null : round(stretchSumMs / stretchedTelegraphs, 1),
    microSleeps,
    coffees,
    asleepRuns,
    phoneRings,
    phoneAnswers,
    phoneRingingSeconds,
    silences,
    silencesFound,
    silencesTimedOut,
    silencesCutOff,
    babyPickUps,
    babyPutDowns,
    safePutDowns,
    armsCries,
    cancelledThreats,
    comboCashIns,
    comboPointsCashed,
    comboPeakMultiplier,
    instinctTriggers,
    toiletVisits,
    chores: {
      runsCompleted: choresRunsCompleted,
      beats: choreBeats,
      meanHomePoints: runs.length === 0 ? 0 : round(choreHomePoints / runs.length, 2),
      meanBeatsPerRun:
        runs.length === 0
          ? 0
          : round((choreBeats.perfect + choreBeats.success + choreBeats.fail) / runs.length, 1),
      abandoned: choreAbandoned,
      byDef: Object.fromEntries(
        Object.entries(choreByDef).map(([id, total]) => [
          id,
          {
            runsCompleted: total.runsCompleted,
            beats: total.beats,
            meanBeatsMissed: runs.length === 0 ? 0 : round(total.beats.fail / runs.length, 2),
          },
        ]),
      ),
      meanObjectsBroken: runs.length === 0 ? 0 : round(choreObjectsBroken / runs.length, 2),
      open: choreOpen,
    },
    visibility: summarizeVisibility(runs),
    sequencesStarted,
    sequencesSucceeded,
    sequencesFailed,
    sequenceRetreats,
    beatsHit,
    beatsMissed,
    decoysTapped,
    beatsStray,
    cycleCompleted,
    cycleEntriesReached: runs.length === 0 ? 0 : round(cycleEntriesSum / runs.length, 1),
    sequenceOutcomes,
    floorCreaks,
    breathGasps,
    nothingResponses,
    finalRushes,
    propsTidied,
    frozenNearMisses,
    lookParts,
    meanLookPartsPerRun: runs.length === 0 ? 0 : round(lookParts / runs.length, 2),
    bladderPeakPct: round(bladderPeakPct, 1),
    noisePeakMeanPct: runs.length === 0 ? 0 : round(noisePeakSumPct / runs.length, 1),
    noisePeakMaxPct: round(noisePeakMaxPct, 1),
    noiseFinalMeanPct: runs.length === 0 ? 0 : round(noiseFinalSumPct / runs.length, 1),
    noiseBySourcePct: Object.fromEntries(
      NOISE_SOURCES.map((source) => [source, round(noiseBySourcePct[source], 1)]),
    ) as Record<NoiseSource, number>,
    runList: runs.map((run) => ({
      seed: run.seed,
      worldHash: run.worldHash,
      responses: run.responses,
      perfectPct: run.responses === 0 ? null : pct(perfectOf(run), run.responses),
      gags: run.gags,
      fairnessViolations: run.fairnessViolations,
      commands: run.commands,
      scorePoints: run.scorePoints,
      stars: run.stars,
      endReason: run.endReason,
      lostStars: run.lostStars,
      mamaHomeAtMs: run.mamaHomeAtMs,
      catastrophePeakPct: run.catastrophePeakPct,
      rows: run.rows,
      sequencesStarted: run.sequencesStarted,
      sequencesSucceeded: run.sequencesSucceeded,
      sequencesFailed: run.sequencesFailed,
      sequenceRetreats: run.sequenceRetreats,
      beatsHit: run.beatsHit,
      beatsMissed: run.beatsMissed,
      decoysTapped: run.decoysTapped,
      beatsStray: run.beatsStray,
    })),
    comparison: null,
  };
}

const WAVES_PLACEHOLDER = '__waves__';

/** The report as it is written: 2-space JSON and a trailing newline, one line per wave. */
export function renderReport(report: SimReport): string {
  const text = JSON.stringify({ ...report, waves: WAVES_PLACEHOLDER }, null, 2);
  const lines = report.waves.map((wave) => `    ${JSON.stringify(wave)}`);
  const waves = lines.length === 0 ? '[]' : `[\n${lines.join(',\n')}\n  ]`;
  return `${text.replace(`"${WAVES_PLACEHOLDER}"`, waves)}\n`;
}
