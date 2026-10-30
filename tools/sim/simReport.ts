import { NOISE_SOURCE_IDS } from '@content/schemas/feel';
import { type DifficultyTierId, STAR_COUNT_MAX } from '@shared/constants';
import { hashJson } from '@shared/hash';
import {
  LEVEL_END_REASONS,
  type LevelEndReason,
  type NoiseSource,
  PAPA_ASLEEP_GAG_ID,
  type Sim,
  type SimEvent,
} from '@sim';

/** Every `NoiseSource` the report counts, in file order, `debug` last (a bot never sends `SetNoise`, so it stays 0). */
const NOISE_SOURCES: readonly NoiseSource[] = [...NOISE_SOURCE_IDS, 'debug'];

const emptyNoiseBySource = (): Record<NoiseSource, number> =>
  Object.fromEntries(NOISE_SOURCES.map((source) => [source, 0])) as Record<NoiseSource, number>;

/** Every `LevelEndReason` at 0: the report has all its keys, whether or not a run ended that way. */
const emptyEndsByReason = (): Record<LevelEndReason, number> =>
  Object.fromEntries(LEVEL_END_REASONS.map((reason) => [reason, 0])) as Record<
    LevelEndReason,
    number
  >;

const FAIL_REASONS = ['early', 'late', 'wrongResponse', 'released'] as const;
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
  /** The most threats announced or open at once, counted at this wave's telegraphs. */
  peakSimultaneous: number;
  /** Whether the count ever went above the wave's `maxSimultaneous`. */
  isOverLimit: boolean;
}

/** What one run produced, kept small: counts, never events. */
export interface RunSummary {
  seed: number;
  worldHash: string;
  responses: number;
  gags: number;
  /** The `NearMiss` events: what Mama's « Hurlement » counts (story 1.22). */
  nearMisses: number;
  /** The micro-sleeps telegraphed (`ThreatTelegraphed` of no wave, story 1.19). */
  microSleeps: number;
  /** The coffees drunk (`CoffeeDrunk`). */
  coffees: number;
  /** The `papa_asleep` gags: a missed micro-sleep. */
  asleepGags: number;
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
  /** Mama's score and stars (`LevelScored`, story 1.22); null for a run cut before the end. */
  scorePoints: number | null;
  stars: number | null;
  /** The stars Mama took off because she woke (`LevelScored.lostStars`); null for a run cut before the end. */
  lostStars: number | null;
}

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

const emptyTally = (): ThreatTally => ({
  responses: 0,
  perfect: 0,
  success: 0,
  fail: 0,
  failReasons: { early: 0, late: 0, wrongResponse: 0, released: 0 },
  absOffsetSumMs: 0,
  offsetCount: 0,
});

/**
 * Counts the events of one run of `sim` (created for it, before the first step): responses per
 * threat def, gags, threats at once per wave (against the limits `waves` gives, the level's waves),
 * whether the level ended, and at the end the final world hash and the number of commands sent.
 * `armsCryDef` is the level's `carry.armsCryDef` (story 4.1): its telegraphs are cries in the arms,
 * not micro-sleeps (both are threats no wave planned).
 */
export function createRunRecorder(
  sim: Sim,
  seed: number,
  waves: readonly { readonly maxSimultaneous: number }[] = [],
  armsCryDef: string | null = null,
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
  let bladderPeakPct = 0;
  let noisePeakPct = 0;
  const noiseBySourcePct = emptyNoiseBySource();
  // A silence is picked (`ThreatHidden`), then telegraphed only if the baby is found: the pick is
  // what counts against the wave, and the later telegraph of the same threat is not a second one.
  const hiddenThreatIds = new Set<number>();
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
  let scored: { scorePoints: number; stars: number; lostStars: number } | null = null;
  return {
    onEvent(event) {
      if (event.type === 'ThreatTelegraphed' && hiddenThreatIds.delete(event.threatId)) {
        // The reveal of a silence picked earlier: already counted at its `ThreatHidden`.
      } else if (event.type === 'ThreatHidden') {
        hiddenThreatIds.add(event.threatId);
        activeCount++;
        const wave = waveTallies[event.waveIndex];
        if (wave !== undefined) {
          wave.telegraphs++;
          if (activeCount > wave.peakSimultaneous) wave.peakSimultaneous = activeCount;
          const limit = waves[event.waveIndex]?.maxSimultaneous ?? Number.POSITIVE_INFINITY;
          if (activeCount > limit) wave.isOverLimit = true;
        }
      } else if (event.type === 'ThreatTelegraphed' && event.waveIndex < 0) {
        if (armsCryDef !== null && event.kind === armsCryDef) armsCries++;
        else microSleeps++;
        systemThreatIds.add(event.threatId);
      } else if (event.type === 'ThreatTelegraphed') {
        activeCount++;
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
        if (!systemThreatIds.has(event.threatId)) activeCount--;
      } else if (event.type === 'BabyPickedUp') {
        babyPickUps++;
      } else if (event.type === 'BabyPutDown') {
        babyPutDowns++;
        if (event.safe) safePutDowns++;
      } else if (event.type === 'ToiletFinished') {
        toiletVisits++;
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
      } else if (event.type === 'MamaWoke') {
        mamaWokeAtMs = event.t;
      } else if (event.type === 'LevelScored') {
        scored = {
          scorePoints: event.scorePoints,
          stars: event.stars,
          lostStars: event.lostStars,
        };
      } else if (event.type === 'ResponseResolved') {
        if (!systemThreatIds.has(event.threatId)) activeCount--;
        responses++;
        const defId = defIdOf.get(event.threatId) ?? `threat_${event.threatId}`;
        const tally = tallyOf(threats, defId);
        tally.responses++;
        tally[event.quality]++;
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
      } else if (event.type === 'NearMiss') {
        nearMisses++;
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
      return {
        seed,
        worldHash: hashJson(sim.world),
        responses,
        gags,
        nearMisses,
        microSleeps,
        coffees,
        asleepGags,
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
        bladderPeakPct: round(Math.max(bladderPeakPct, sim.world.gauges.bladderPct), 1),
        noisePeakPct,
        noiseFinalPct: round(sim.world.gauges.noisePct, 1),
        noiseBySourcePct: { ...noiseBySourcePct },
        commands: sim.journal().entries.length,
        threats,
        byGag,
        waves: waveTallies.map((wave) => ({ ...wave })),
        isEnded,
        endReason,
        mamaWokeAtMs,
        scorePoints: scored?.scorePoints ?? null,
        stars: scored?.stars ?? null,
        lostStars: scored?.lostStars ?? null,
      };
    },
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
  /** The runs where the count went above `maxSimultaneous`: always 0 unless the director is wrong. */
  overLimitRuns: number;
}

export interface SimReport {
  level: string;
  bot: string;
  /** The difficulty tier the games were played at (story 2.8). */
  tier: DifficultyTierId;
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
  hashes: { feel: string; geometry: string; level: string; bots: string };
  /** Mean of Mama's score over the runs that ended, one decimal; null when none ended. */
  meanScore: number | null;
  /** Mean of Mama's stars over the runs that ended, one decimal; null when none ended. */
  meanStars: number | null;
  /** Runs per number of stars, from 0 to 5 (index = stars); they add up to `endedRuns`. */
  starCounts: number[];
  /** `null` when no response was seen (no threat, or a game too short for one): not 0 %. */
  meanSuccessPct: number | null;
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
    gags: number;
    commands: number;
    /** Null for a run cut by `--until-ms` before the level ended. */
    scorePoints: number | null;
    stars: number | null;
    /** Null for a run cut before the end (story 3.2). */
    endReason: LevelEndReason | null;
    lostStars: number | null;
  }[];
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
  seed: number;
  untilSimMs: number;
  hashes: SimReport['hashes'];
  /** The level's waves: where they start and how many threats they allow at once. */
  waves: readonly { readonly fromMs: number; readonly maxSimultaneous: number }[];
}

const sortedKeys = (record: Record<string, unknown>): string[] => Object.keys(record).sort();

/** Folds the runs into the report. Pure: the same runs give the same report, key for key. */
export function summarizeRuns(input: ReportInput, runs: readonly RunSummary[]): SimReport {
  const merged: Record<string, ThreatTally> = {};
  const byGag: Record<string, number> = {};
  let responses = 0;
  let good = 0;
  let gags = 0;
  let nearMisses = 0;
  let endedRuns = 0;
  const endsByReason = emptyEndsByReason();
  let mamaWokeCount = 0;
  let mamaWokeSumAtMs = 0;
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
  let bladderPeakPct = 0;
  let noisePeakSumPct = 0;
  let noisePeakMaxPct = 0;
  let noiseFinalSumPct = 0;
  const noiseBySourcePct = emptyNoiseBySource();
  let scoredRuns = 0;
  let scoreSum = 0;
  let starSum = 0;
  const starCounts: number[] = Array.from({ length: STAR_COUNT_MAX + 1 }, () => 0);
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
    bladderPeakPct = Math.max(bladderPeakPct, run.bladderPeakPct);
    noisePeakSumPct += run.noisePeakPct;
    noisePeakMaxPct = Math.max(noisePeakMaxPct, run.noisePeakPct);
    noiseFinalSumPct += run.noiseFinalPct;
    for (const source of NOISE_SOURCES) noiseBySourcePct[source] += run.noiseBySourcePct[source];
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
    seed: input.seed,
    runs: runs.length,
    untilSimMs: input.untilSimMs,
    endedRuns,
    endsByReason,
    mamaWokeMeanAtMs: mamaWokeCount === 0 ? null : round(mamaWokeSumAtMs / mamaWokeCount, 1),
    hashes: input.hashes,
    meanScore: scoredRuns === 0 ? null : round(scoreSum / scoredRuns, 1),
    meanStars: scoredRuns === 0 ? null : round(starSum / scoredRuns, 1),
    starCounts,
    meanSuccessPct: responses === 0 ? null : pct(good, responses),
    threats,
    waves,
    gags: {
      total: gags,
      meanPerRun: runs.length === 0 ? 0 : round(gags / runs.length, 2),
      byGag: sortedByGag,
      nearMisses,
    },
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
      gags: run.gags,
      commands: run.commands,
      scorePoints: run.scorePoints,
      stars: run.stars,
      endReason: run.endReason,
      lostStars: run.lostStars,
    })),
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
