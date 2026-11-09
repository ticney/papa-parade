import { fileURLToPath } from 'node:url';
import type { BotId } from '@bots/bot';
import { botResponsesOf, releaseDefIdsOf, safeSpotOf } from '@bots/botResponses';
import { botViewOf } from '@bots/botView';
import { createBot } from '@bots/createBot';
import { PICK_UP_TIME_SCALE_MAX, PICK_UP_TIME_SCALE_MIN, STEP_MS } from '@shared/constants';
import { hashJson } from '@shared/hash';
import type { SimMs } from '@shared/time';
import { createSim, isFlowLive, type SimCommand } from '@sim';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BABY_IDLE_SALT,
  isBabyClapEligible,
  isBabyPaused,
  isBabyRestShown,
} from '../../src/client/render/views/babyActing.ts';
import { BABY_IDLE_CLIPS, PAPA_PARRY_CLIPS } from '../../src/client/render/views/characterClips.ts';
import { busyFitTimeScaleOf } from '../../src/client/render/views/characterMotion.ts';
import { isSignalOnly } from '../../src/client/render/views/faceInputs.ts';
import {
  createIdleSlot,
  idleSlotAt,
  parryVariantOf,
} from '../../src/client/render/views/papaActing.ts';
import { loadSimLevel, type SimLevel } from '../../tools/sim/loadSimLevel.ts';

// Story 7.12, the headless proof of the second half of the first wave (AC 4, 6, 7, 12): whole games of the real
// `createSim` on the live content, played by bots, read as the views read them: the baby's pause and sit on his
// stop (`babble`), his claps on the step clock (a frame every two steps, each slot seen by the one frame that first
// reaches it), the Parry of each judged Parry success from `world.score.successes` in its own step (the events are
// read after each step, as the loop delivers them), and the pick-up's span. No Three: the pure modules alone.

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const CONTENT_DIR = `${REPO}content`;
const TIMEOUT_MS = 600_000;
const LEVELS = ['salon_kitchen', 'salon_crawler', 'chambre_night'] as const;
const SEEDS = [1, 2, 3];
const BOTS: readonly BotId[] = ['idle', 'human', 'perfect'];
/** Sim steps per rendered frame: more than one at 30 fps, as 7.10's review asked of a live read. */
const STEPS_PER_FRAME = 2;
/** The baby's states in which he crawls (`BABY_TRAVELLING`). */
const TRAVELLING_STATES: readonly string[] = ['wander', 'approach', 'mischiefSilent'];
/** The pick-up gesture's own length (`pick_up`, 30 frames at 30 fps). */
const PICK_UP_CLIP_MS = 1000;

const levels = new Map<string, SimLevel>();

beforeAll(async () => {
  for (const id of LEVELS) {
    const loaded = await loadSimLevel(CONTENT_DIR, id);
    if (!loaded.ok) throw new Error(loaded.error);
    levels.set(id, loaded.value);
  }
}, TIMEOUT_MS);

interface Clap {
  readonly atMs: number;
  readonly slotAt: number;
  readonly enteredAt: number;
  readonly index: number;
}

interface Parry {
  readonly atMs: number;
  readonly successes: number;
  readonly clip: string;
}

/** A step on which the baby, drawn paused or seated, moved: the end of a crawl, or a placement (put down, a snap). */
interface RestMove {
  readonly atMs: number;
  readonly distanceM: number;
  readonly sinceStopMs: number;
  /** His state on the step before: a travelling one ends a crawl, any other is a placement by the sim. */
  readonly fromState: string;
}

interface WaveRun {
  readonly claps: Clap[];
  readonly parries: Parry[];
  readonly pickUpSpansMs: number[];
  restSteps: number;
  pausedSteps: number;
  readonly restMoves: RestMove[];
  reliefs: number;
  readonly violations: string[];
  /** Two Parry successes in a row that another success (a Firmness, a perfect) separated. */
  parryPairsSeparated: number;
}

async function play(levelId: string, botId: BotId, seed: number): Promise<WaveRun> {
  const { content, geometry, level } = levels.get(levelId) as SimLevel;
  const sim = await createSim({ content, geometry, level, seed, strictInvariants: true });
  const bot = createBot(botId, {
    seed,
    holdMinMs: content.feel.input.holdMinMs,
    responses: botResponsesOf(level.threats),
    releaseDefIds: releaseDefIdsOf(level.threats),
    choreObjectIds: (level.level.chores ?? []).map((chore) => chore.object),
    safeSpot: safeSpotOf(geometry),
    isChronoRingShown: true,
    view: botViewOf({
      camera: level.level.camera,
      geometry,
      threats: level.threats,
      babyBodyRadiusM: content.feel.baby.bodyRadiusM,
      screen: content.bots.human.view,
    }),
    settings: content.bots,
  });
  if (!bot.ok) throw new Error(bot.error.message);
  const slot = createIdleSlot();
  const run: WaveRun = {
    claps: [],
    parries: [],
    pickUpSpansMs: [],
    restSteps: 0,
    pausedSteps: 0,
    restMoves: [],
    reliefs: 0,
    violations: [],
    parryPairsSeparated: 0,
  };
  let lastFrameMs: number | null = null;
  let previousBabyState: string = sim.world.baby.state;
  let lastSuccessWasParry: { successes: number; clip: string } | null = null;
  const out: SimCommand[] = [];
  while (sim.world.time.sim < level.level.durationMs && isFlowLive(sim.world)) {
    out.length = 0;
    bot.value.act(sim.world, out);
    for (const command of out) sim.enqueue(command);
    for (let i = 0; i < STEPS_PER_FRAME; i++) {
      sim.step();
      const { world } = sim;
      const at = `${levelId}/${botId}/${seed} at ${world.time.sim} ms`;
      // Every step the baby is drawn paused or seated, his sim position stands (D7, AC 12).
      const { characters } = world.feel;
      if (isBabyRestShown(world.baby, isSignalOnly(world), false)) {
        run.restSteps += 1;
        if (isBabyPaused(world.baby, world.time.sim, characters.babySit)) run.pausedSteps += 1;
        const distanceM = Math.hypot(
          world.baby.xM - world.baby.prevXM,
          world.baby.zM - world.baby.prevZM,
        );
        if (distanceM > 0) {
          run.restMoves.push({
            atMs: world.time.sim,
            distanceM,
            sinceStopMs: world.time.sim - world.baby.enteredAt,
            fromState: previousBabyState,
          });
        }
      }
      previousBabyState = world.baby.state;
      for (const event of sim.drainEvents()) {
        if (event.type === 'PapaStateChanged' && event.to === 'pickingUp') {
          run.pickUpSpansMs.push(world.papa.busyUntil - world.papa.enteredAt);
        }
        if (event.type !== 'ResponseResolved' || event.quality === 'fail') continue;
        // The Parry of a success: from the world of its own step (D4), as the choreography reads it.
        const isParry = event.response === 'parry' && event.quality === 'success';
        if (isParry && !isSignalOnly(world)) {
          const { successes } = world.score;
          const clip = PAPA_PARRY_CLIPS[parryVariantOf(seed, successes)] as string;
          run.parries.push({ atMs: event.t, successes, clip });
          if (lastSuccessWasParry !== null) {
            if (lastSuccessWasParry.successes === successes - 1) {
              if (lastSuccessWasParry.clip === clip) {
                run.violations.push(`${at}: the same Parry twice in a row (${clip})`);
              }
            } else {
              run.parryPairsSeparated += 1;
            }
          }
          lastSuccessWasParry = { successes, clip };
        } else if (event.quality === 'success' || event.quality === 'perfect') {
          // Another success between two Parries: the next one may repeat (« Open for Geo », D4).
          if (lastSuccessWasParry !== null && !isParry) lastSuccessWasParry = null;
        }
        if (event.quality === 'success' && event.offsetMs !== null && !isSignalOnly(world)) {
          const half = event.responseWindow.windowMs / 2 + event.responseWindow.toleranceMs;
          const share = half > 0 ? (event.offsetMs + half) / (2 * half) : 0;
          if (share >= 1 - characters.relief.lastSharePct / 100) run.reliefs += 1;
        }
      }
    }
    const { world } = sim;
    const simMs = world.time.sim;
    if (lastFrameMs === null) {
      lastFrameMs = simMs;
      continue;
    }
    // His claps (D8): the slots of his stop, each seen by the one frame that first reaches it.
    const { babySit, babyIdles } = world.feel.characters;
    idleSlotAt(
      seed,
      BABY_IDLE_SALT,
      world.baby.enteredAt,
      simMs,
      babyIdles,
      BABY_IDLE_CLIPS.length,
      slot,
    );
    if (slot.index >= 0 && slot.startAt > lastFrameMs) {
      const isGuarded = isSignalOnly(world);
      if (isBabyClapEligible(world.baby, simMs, babySit, isGuarded, false, false)) {
        const at = `${levelId}/${botId}/${seed} at ${simMs} ms`;
        if (world.sequence.duel.isRunning || world.sequence.stealth.isRunning) {
          run.violations.push(`${at}: a clap in a duel or stealth step`);
        }
        if (world.baby.state !== 'babble')
          run.violations.push(`${at}: a clap in ${world.baby.state}`);
        if (world.baby.cryEndsAt !== null) run.violations.push(`${at}: a clap while he cries`);
        if (simMs - slot.startAt >= STEPS_PER_FRAME * STEP_MS) {
          run.violations.push(`${at}: slot of ${slot.startAt} ms seen late`);
        }
        run.claps.push({
          atMs: simMs,
          slotAt: slot.startAt,
          enteredAt: world.baby.enteredAt,
          index: slot.index,
        });
      }
    }
    lastFrameMs = simMs;
  }
  return run;
}

describe('the second half of the first wave in live games (story 7.12, AC 4, 6, 7, 12)', () => {
  const runs = new Map<string, WaveRun>();

  beforeAll(async () => {
    for (const levelId of LEVELS) {
      for (const botId of BOTS) {
        for (const seed of SEEDS)
          runs.set(`${levelId}/${botId}/${seed}`, await play(levelId, botId, seed));
      }
    }
  }, TIMEOUT_MS);

  it('never draws the baby paused or seated while the sim crawls him (D7)', () => {
    let restSteps = 0;
    let pausedSteps = 0;
    for (const [key, run] of runs) {
      restSteps += run.restSteps;
      pausedSteps += run.pausedSteps;
      const levelId = key.split('/')[0] as string;
      const { feel } = (levels.get(levelId) as SimLevel).content;
      // The step he stops on may end his crawl (less than one crawl step), or place him (put down from Papa's
      // arms, a snap onto an open cell: instant, not a crawl); after it, he never moves.
      const { crawlSpeedMps, approachSpeedMps, sneakSpeedMps } = feel.baby;
      const crawlStepM =
        (Math.max(crawlSpeedMps, approachSpeedMps, sneakSpeedMps) * STEP_MS) / 1000;
      for (const move of run.restMoves) {
        const where = `${key} at ${move.atMs} ms from ${move.fromState}`;
        expect(move.sinceStopMs, where).toBe(0);
        if (TRAVELLING_STATES.includes(move.fromState)) {
          expect(move.distanceM, where).toBeLessThanOrEqual(crawlStepM + 1e-9);
        }
      }
    }
    expect(restSteps).toBeGreaterThan(0);
    expect(pausedSteps).toBeGreaterThan(0);
  });

  it('claps only seated, outside the guard, firstAfterMs after the stop, gapMinMs to gapMaxMs apart; each in its frame', () => {
    let claps = 0;
    for (const [key, run] of runs) {
      expect(run.violations, key).toEqual([]);
      const levelId = key.split('/')[0] as string;
      const { babyIdles, babySit } = (levels.get(levelId) as SimLevel).content.feel.characters;
      for (const [i, clap] of run.claps.entries()) {
        claps += 1;
        expect(clap.slotAt - clap.enteredAt, key).toBeGreaterThanOrEqual(babyIdles.firstAfterMs);
        expect(clap.slotAt - clap.enteredAt, key).toBeGreaterThanOrEqual(babySit.afterMs);
        const previous = run.claps[i - 1];
        if (previous === undefined || previous.enteredAt !== clap.enteredAt) continue;
        const slotsApart = clap.index - previous.index;
        expect(slotsApart, key).toBeGreaterThan(0);
        expect(clap.slotAt - previous.slotAt, key).toBeGreaterThanOrEqual(
          babyIdles.gapMinMs * slotsApart,
        );
        expect(clap.slotAt - previous.slotAt, key).toBeLessThanOrEqual(
          babyIdles.gapMaxMs * slotsApart,
        );
      }
    }
    expect(claps).toBeGreaterThan(0);
  });

  it('never plays the same Parry for two Parry successes in a row, and plays both over the games (D4)', () => {
    const clips = new Set<string>();
    for (const [key, run] of runs) {
      expect(run.violations, key).toEqual([]);
      for (const parry of run.parries) clips.add(parry.clip);
    }
    expect([...clips].sort()).toEqual([...PAPA_PARRY_CLIPS].sort());
  });

  it('fits the pick-up to spans the clamp never touches (D3)', async () => {
    // No bot picks a debris up: a forced coffee-table gag on the live salon, then a tap on the mug (story 3.15).
    const { content, geometry, level } = levels.get('salon_crawler') as SimLevel;
    const sim = await createSim({ content, geometry, level, seed: 1, strictInvariants: true });
    const at = (): SimMs => sim.world.time.sim;
    const until = (done: () => boolean, what: string): void => {
      for (let i = 0; i < 2000 && !done(); i++) sim.step();
      sim.drainEvents();
      if (!done()) throw new Error(`no ${what}`);
    };
    const table = sim.world.threats.find((threat) => threat.defId === 'coffee_table_object');
    if (table === undefined) throw new Error('the salon plans no coffee table');
    sim.enqueue({ type: 'ForceThreat', t: at(), threatId: table.id });
    until(() => sim.world.props.some((prop) => prop.id === 'mug_01' && prop.isMess), 'mug down');
    until(() => sim.world.papa.state === 'idle', 'free Papa');
    sim.enqueue({ type: 'TapObject', t: at(), objectId: 'mug_01' });
    until(() => sim.world.papa.state === 'pickingUp', 'pick-up');
    const forced = sim.world.papa.busyUntil - sim.world.papa.enteredAt;
    const spans = [forced, ...[...runs.values()].flatMap((run) => run.pickUpSpansMs)];
    expect(forced).toBeGreaterThan(0);
    for (const spanMs of spans) {
      const scale = busyFitTimeScaleOf(PICK_UP_CLIP_MS, spanMs);
      expect(scale).toBeCloseTo(PICK_UP_CLIP_MS / spanMs, 9);
      expect(scale).toBeGreaterThan(PICK_UP_TIME_SCALE_MIN);
      expect(scale).toBeLessThan(PICK_UP_TIME_SCALE_MAX);
    }
  });

  it(
    'gives the same pauses, claps, Parries and spans when the same game is played again (AC 12)',
    async () => {
      for (const levelId of LEVELS) {
        const again = await play(levelId, 'human', 2);
        const first = runs.get(`${levelId}/human/2`) as WaveRun;
        expect(hashJson(again), levelId).toBe(hashJson(first));
      }
    },
    TIMEOUT_MS,
  );

  it('writes its counts for the story notes', () => {
    const summary: Record<string, unknown> = {};
    for (const [key, run] of runs) {
      summary[key] = {
        claps: run.claps.length,
        parries: run.parries.length,
        parryClips: run.parries.map((parry) => parry.clip).join(','),
        parryPairsSeparated: run.parryPairsSeparated,
        pickUps: run.pickUpSpansMs.join(','),
        restSteps: run.restSteps,
        pausedSteps: run.pausedSteps,
        reliefs: run.reliefs,
        restMoves: run.restMoves,
      };
    }
    expect(Object.keys(summary)).toHaveLength(LEVELS.length * BOTS.length * SEEDS.length);
    const out = process.env.PP_WAVE_SUMMARY;
    if (out !== undefined) {
      // A throwaway read for the story's notes, never on by default.
      void import('node:fs').then((fs) => fs.writeFileSync(out, JSON.stringify(summary, null, 1)));
    }
  });
});
