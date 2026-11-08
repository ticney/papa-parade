import { fileURLToPath } from 'node:url';
import type { BotId } from '@bots/bot';
import { botResponsesOf, releaseDefIdsOf, safeSpotOf } from '@bots/botResponses';
import { botViewOf } from '@bots/botView';
import { createBot } from '@bots/createBot';
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
    sim.step();
    const { world } = sim;
    const nowMs = world.time.sim;
    const feel = world.feel.characters.expressions;
    const isGuarded = isSignalOnly(world);
    for (const event of sim.drainEvents()) {
      if (event.type === 'ThreatTelegraphed') telegraphed.add(event.threatId);
      if (isGuarded) {
        dropMoment(papaTrack);
        dropMoment(babyTrack);
        continue;
      }
      notePapaEvent(papaTrack, event, world.papa.state === 'asleep', feel.papa);
      noteBabyEvent(babyTrack, event, feel.baby);
    }
    const papaFace = papaExpressionAt(papaTrack, nowMs, isPapaTired(world), isGuarded);
    const babyFace = babyExpressionAt(
      babyTrack,
      nowMs,
      babyFocusOf(world),
      hasBedtimeCycle,
      isGuarded,
    );
    faces.push(papaFace, babyFace);
    seen.add(`papa:${papaFace}`);
    seen.add(`baby:${babyFace}`);
    const at = `${levelId}/${botId}/${seed} at ${nowMs} ms`;
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

describe('the faces on the live levels (story 7.10, AC 5, 6, 9)', () => {
  const seenEverywhere = new Set<string>();

  for (const levelId of LEVELS) {
    for (const botId of BOTS) {
      it(
        `${levelId}, ${botId}, seeds ${SEEDS.join(', ')}: focus after the telegraph, rest through the signals, sleepy only at bedtime`,
        async () => {
          let guardedSteps = 0;
          for (const seed of SEEDS) {
            const run = await playFaces(levelId, botId, seed);
            expect(run.violations).toEqual([]);
            guardedSteps += run.guardedSteps;
            for (const face of run.seen) seenEverywhere.add(face);
          }
          // The bedroom's duels and stealth exit run in every game: the guard is exercised there.
          if (levelId === 'chambre_night') expect(guardedSteps).toBeGreaterThan(0);
        },
        TIMEOUT_MS,
      );
    }
  }

  it('shows each of the eight expressions at least once over the runs', () => {
    const wanted = [
      ...PAPA_EXPRESSIONS.map((face) => `papa:${face}`),
      ...BABY_EXPRESSIONS.map((face) => `baby:${face}`),
    ];
    expect(wanted.filter((face) => !seenEverywhere.has(face))).toEqual([]);
  });

  it.each(LEVELS)(
    '%s: the same seed twice gives the same faces on every step',
    async (levelId) => {
      const first = await playFaces(levelId, 'human', 1);
      const second = await playFaces(levelId, 'human', 1);
      expect(hashJson(second.faces)).toBe(hashJson(first.faces));
    },
    TIMEOUT_MS,
  );
});
