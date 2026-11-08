import { fileURLToPath } from 'node:url';
import type { BotId } from '@bots/bot';
import { botResponsesOf, releaseDefIdsOf, safeSpotOf } from '@bots/botResponses';
import { botViewOf } from '@bots/botView';
import { createBot } from '@bots/createBot';
import { STEP_MS } from '@shared/constants';
import { hashJson } from '@shared/hash';
import { createSim, isFlowLive, type SimCommand } from '@sim';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BABY_EXPRESSIONS,
  type BabyExpression,
  babyExpressionAt,
  createFaceTrack,
  dropMoment,
  noteBabyEvent,
  notePapaEvent,
  PAPA_EXPRESSIONS,
  type PapaExpression,
  papaExpressionAt,
} from '../../src/client/render/views/expressions.ts';
import {
  babyFocusOf,
  isPapaTired,
  isSignalOnly,
} from '../../src/client/render/views/faceInputs.ts';
import { loadSimLevel, type SimLevel } from '../../tools/sim/loadSimLevel.ts';

// Story 7.10, the headless proof of the faces (AC 5, 6, 9): whole games of the real `createSim` on the live
// content, played by bots, with the faces read as `levelScene.ts` reads them (each step's events through the
// guard into the tracks, then the faces from the world on the step's clock). On every step: the baby is
// focused only on a threat whose telegraph was seen, never in `mischiefSilent`; both faces rest through
// every duel and stealth step; he is sleepy only in a bedtime level.

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const CONTENT_DIR = `${REPO}content`;
const TIMEOUT_MS = 600_000;
const LEVELS = ['salon_kitchen', 'salon_crawler', 'chambre_night'] as const;
const SEEDS = [1, 2, 3];
const BOTS: readonly BotId[] = ['human', 'perfect'];
/** How far into a step the render reads the faces: the frame's leftover, never 0 in a real frame. */
const FRAME_ALPHA = 0.5;
/** Sim steps per rendered frame: more than one at 30 fps, so an event can be a step older than the frame. */
const STEPS_PER_FRAME = 2;

const levels = new Map<string, SimLevel>();

beforeAll(async () => {
  for (const id of LEVELS) {
    const loaded = await loadSimLevel(CONTENT_DIR, id);
    if (!loaded.ok) throw new Error(loaded.error);
    levels.set(id, loaded.value);
  }
}, TIMEOUT_MS);

interface FacesRun {
  /** Each step's two faces, in order. */
  readonly faces: string[];
  readonly seen: Set<string>;
  readonly violations: string[];
  /** Steps on which the guard of the signals held. */
  readonly guardedSteps: number;
}

async function playFaces(levelId: string, botId: BotId, seed: number): Promise<FacesRun> {
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
  const hasBedtimeCycle = level.level.cycle !== undefined;
  const papaTrack = createFaceTrack<PapaExpression>();
  const babyTrack = createFaceTrack<BabyExpression>();
  const telegraphed = new Set<number>();
  const faces: string[] = [];
  const seen = new Set<string>();
  const violations: string[] = [];
  let guardedSteps = 0;
  const out: SimCommand[] = [];
  while (sim.world.time.sim < level.level.durationMs && isFlowLive(sim.world)) {
    out.length = 0;
    bot.value.act(sim.world, out);
    for (const command of out) sim.enqueue(command);
    // A frame of the scene at 30 fps: two steps, then one read of the world and of both steps' events.
    for (let i = 0; i < STEPS_PER_FRAME; i++) sim.step();
    const { world } = sim;
    const simMs = world.time.sim;
    // The scene's clock is the sim's plus the render's leftover of a step: read mid-frame, as it does.
    const nowMs = simMs + FRAME_ALPHA * STEP_MS;
    const feel = world.feel.characters.expressions;
    const isGuarded = isSignalOnly(world);
    let isPerfectNoted = false;
    for (const event of sim.drainEvents()) {
      if (event.type === 'ThreatTelegraphed') telegraphed.add(event.threatId);
      if (isGuarded) {
        dropMoment(papaTrack);
        dropMoment(babyTrack);
        continue;
      }
      if (event.type === 'ResponseResolved' && event.quality === 'perfect') isPerfectNoted = true;
      notePapaEvent(papaTrack, event, world.papa.state === 'asleep', feel.papa);
      noteBabyEvent(babyTrack, event, feel.baby);
    }
    const papaFace = papaExpressionAt(papaTrack, nowMs, simMs, isPapaTired(world), isGuarded);
    const babyFace = babyExpressionAt(
      babyTrack,
      nowMs,
      simMs,
      babyFocusOf(world),
      hasBedtimeCycle,
      isGuarded,
    );
    faces.push(papaFace, babyFace);
    seen.add(`papa:${papaFace}`);
    seen.add(`baby:${babyFace}`);
    const at = `${levelId}/${botId}/${seed} at ${simMs} ms`;
    // A perfect makes the baby laugh, bedtime or not: only a focus on another threat that begins in that very
    // step may show over his delight (the sleepy of a bedroom must never swallow it).
    if (isPerfectNoted && babyFace !== 'delighted' && babyFace !== 'focused') {
      violations.push(`${at}: a perfect left the baby ${babyFace}`);
    }
    if (babyFace === 'focused') {
      if (world.baby.state === 'mischiefSilent')
        violations.push(`${at}: focused in mischiefSilent`);
      const target = world.baby.targetThreatId;
      if (target === null || !telegraphed.has(target)) {
        violations.push(`${at}: focused before the telegraph of threat ${String(target)}`);
      }
    }
    if (isGuarded) {
      guardedSteps++;
      if (papaFace !== 'neutral' || babyFace !== 'neutral') {
        violations.push(`${at}: ${papaFace}/${babyFace} during a duel or stealth step`);
      }
    }
    if (babyFace === 'sleepy' && !hasBedtimeCycle) violations.push(`${at}: sleepy outside bedtime`);
  }
  return { faces, seen, violations, guardedSteps };
}

// Each game is played once and shared by the tests below, so that none depends on another having run
// (a filtered, sharded or shuffled run gives the same answers).
const runs = new Map<string, Promise<FacesRun>>();
function runOf(levelId: string, botId: BotId, seed: number): Promise<FacesRun> {
  const key = `${levelId}/${botId}/${seed}`;
  let run = runs.get(key);
  if (run === undefined) {
    run = playFaces(levelId, botId, seed);
    runs.set(key, run);
  }
  return run;
}

describe('the faces on the live levels (story 7.10, AC 5, 6, 9)', () => {
  for (const levelId of LEVELS) {
    for (const botId of BOTS) {
      it(
        `${levelId}, ${botId}, seeds ${SEEDS.join(', ')}: focus after the telegraph, rest through the signals, sleepy only at bedtime`,
        async () => {
          let guardedSteps = 0;
          for (const seed of SEEDS) {
            const run = await runOf(levelId, botId, seed);
            expect(run.violations).toEqual([]);
            guardedSteps += run.guardedSteps;
          }
          // The bedroom's duels and stealth exit run in every game: the guard is exercised there.
          if (levelId === 'chambre_night') expect(guardedSteps).toBeGreaterThan(0);
        },
        TIMEOUT_MS,
      );
    }
  }

  it(
    'shows each of the eight expressions at least once over the runs',
    async () => {
      const seenEverywhere = new Set<string>();
      for (const levelId of LEVELS) {
        for (const botId of BOTS) {
          for (const seed of SEEDS) {
            for (const face of (await runOf(levelId, botId, seed)).seen) seenEverywhere.add(face);
          }
        }
      }
      const wanted = [
        ...PAPA_EXPRESSIONS.map((face) => `papa:${face}`),
        ...BABY_EXPRESSIONS.map((face) => `baby:${face}`),
      ];
      expect(wanted.filter((face) => !seenEverywhere.has(face))).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it.each(LEVELS)(
    '%s: the same seed twice gives the same faces on every step',
    async (levelId) => {
      // The second game is played afresh: the shared one would only be compared with itself.
      const first = await runOf(levelId, 'human', 1);
      const second = await playFaces(levelId, 'human', 1);
      expect(hashJson(second.faces)).toBe(hashJson(first.faces));
    },
    TIMEOUT_MS,
  );
});
