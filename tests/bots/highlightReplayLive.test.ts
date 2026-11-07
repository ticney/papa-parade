import { fileURLToPath } from 'node:url';
import type { BotId } from '@bots/bot';
import { botResponsesOf, releaseDefIdsOf, safeSpotOf } from '@bots/botResponses';
import { botViewOf } from '@bots/botView';
import { createBot } from '@bots/createBot';
import { STEP_MS } from '@shared/constants';
import { hashJson } from '@shared/hash';
import {
  createSim,
  isFlowLive,
  type LevelEndReason,
  type Sim,
  type SimCommand,
  type SimEvent,
} from '@sim';
import { beforeAll, describe, expect, it } from 'vitest';
import { createHighlightRecorder, type Highlight } from '../../src/client/endOfLevel/highlights.ts';
import {
  createMomentSim,
  momentWindowOf,
  type ReplaySource,
} from '../../src/client/endOfLevel/momentSim.ts';
import { createSnapshotLog, type SnapshotLog } from '../../src/client/endOfLevel/snapshotLog.ts';
import { loadSimLevel, type SimLevel } from '../../tools/sim/loadSimLevel.ts';

// Story 3.9, FR38, the headless proof (the golden rule): a whole game of the real `createSim` on the
// live content, played by bots, with the client's snapshot rule (a snapshot before the step at 0 and at
// each multiple of `SNAPSHOT_EVERY_MS`, taken before the bot acts). The highlight recorder picks the
// moments from the events; every picked moment is rebuilt by `createMomentSim` and must play out as
// the live game did.

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const CONTENT_DIR = `${REPO}content`;
const TIMEOUT_MS = 300_000;
const LEVELS = ['salon_kitchen', 'salon_crawler'] as const;
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

/** One step's events with the sim time after it: what two sims are compared on. */
interface StepEvents {
  readonly atMs: number;
  readonly events: readonly SimEvent[];
}

interface LiveGame {
  readonly loaded: SimLevel;
  readonly seed: number;
  readonly sim: Sim;
  readonly snapshots: SnapshotLog;
  readonly steps: StepEvents[];
  readonly endReason: LevelEndReason;
  readonly endedAt: number | null;
  readonly highlights: readonly Highlight[];
  readonly source: ReplaySource;
}

/** Plays one strict game the way the client's session does, then picks the moments. */
async function playLive(levelId: string, botId: BotId, seed: number): Promise<LiveGame> {
  const loaded = levels.get(levelId) as SimLevel;
  const { content, geometry, level } = loaded;
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
  const snapshots = createSnapshotLog();
  const recorder = createHighlightRecorder();
  const steps: StepEvents[] = [];
  let endReason: LevelEndReason = 'timer';
  let endedAt: number | null = null;
  const out: SimCommand[] = [];
  while (sim.world.time.sim < level.level.durationMs && isFlowLive(sim.world)) {
    // The snapshot first, then the bot (AC 1).
    snapshots.take(sim);
    out.length = 0;
    bot.value.act(sim.world, out);
    for (const command of out) sim.enqueue(command);
    sim.step();
    const events = sim.drainEvents().map((event) => structuredClone(event));
    steps.push({ atMs: sim.world.time.sim, events });
    for (const event of events) {
      recorder.onSimEvent(event);
      if (event.type === 'LevelEnded') {
        endReason = event.reason;
        endedAt = event.t;
      }
    }
  }
  const highlights = recorder.pick(endReason, content.feedback.replay);
  const source: ReplaySource = {
    content,
    geometry,
    level,
    seed,
    journal: () => sim.journal(),
    snapshots,
    endedAt,
  };
  return { loaded, seed, sim, snapshots, steps, endReason, endedAt, highlights, source };
}

/** The events of the steps that end in `(fromMs, untilMs]`, in order, flattened. */
const eventsBetween = (steps: readonly StepEvents[], fromMs: number, untilMs: number) =>
  steps.filter((step) => step.atMs > fromMs && step.atMs <= untilMs).flatMap((step) => step.events);

/** The events a sim restored by hand from the snapshot gives while stepping to `untilMs`. */
async function eventsFromSnapshot(game: LiveGame, snapshotMs: number, untilMs: number) {
  const { content, geometry, level } = game.loaded;
  const snapshot = game.snapshots.latestAtOrBefore(snapshotMs);
  if (snapshot === null) throw new Error('no snapshot');
  const sim = await createSim({
    content,
    geometry,
    level,
    seed: game.seed,
    strictInvariants: true,
  });
  try {
    sim.restore(
      snapshot,
      game.sim.journal().entries.filter((entry) => entry.applyAt > snapshot.world.time.sim),
    );
    const collected: StepEvents[] = [];
    while (sim.world.time.sim < untilMs) {
      sim.step();
      collected.push({
        atMs: sim.world.time.sim,
        events: structuredClone(sim.drainEvents().slice()),
      });
    }
    return { fromMs: snapshot.world.time.sim, collected };
  } finally {
    sim.dispose();
  }
}

/** The event that makes the moment a moment: its `t`, its threat, and the kind it scored for. */
function momentEventOf(highlight: Highlight, events: readonly SimEvent[]): SimEvent | undefined {
  return events.find((event) => {
    if (event.t !== highlight.t || !('threatId' in event) || event.threatId !== highlight.threatId)
      return false;
    if (event.type === 'ResponseResolved') {
      return highlight.kinds.includes('perfect') || highlight.kinds.includes('waveLast');
    }
    if (event.type === 'GagTriggered') return true;
    if (event.type === 'NearMiss') return highlight.kinds.includes('nearMiss');
    return false;
  });
}

/** Builds each picked moment and checks it against the live game. */
async function checkMoments(game: LiveGame): Promise<void> {
  const rules = game.loaded.content.feedback.replay;
  for (const highlight of game.highlights) {
    const { fromMs, untilMs } = momentWindowOf(highlight, rules, game.endedAt);
    const live = game.steps.flatMap((step) => step.events);

    // (b) the moment's own event is in the span.
    expect(
      momentEventOf(highlight, eventsBetween(game.steps, fromMs - STEP_MS, untilMs)),
      `seed ${game.seed}: no event for the moment ${JSON.stringify(highlight)}`,
    ).toBeDefined();
    expect(live.length).toBeGreaterThan(0);

    // (a) from the snapshot, by hand: (snapshotTime, untilMs]. `hashJson`, not `JSON.stringify`: a
    // restored sim's keys come out in another order, and that is no difference.
    const snapshotMs = game.snapshots.latestAtOrBefore(fromMs)?.world.time.sim ?? 0;
    const byHand = await eventsFromSnapshot(game, fromMs, untilMs);
    expect(byHand.fromMs).toBe(snapshotMs);
    expect(hashJson(byHand.collected.flatMap((step) => step.events))).toBe(
      hashJson(eventsBetween(game.steps, snapshotMs, untilMs)),
    );

    // (a) through `createMomentSim`: the span after its silent fast-forward, (fromMs, untilMs].
    const built = await createMomentSim(game.source, highlight, rules);
    if (!built.ok) throw new Error(`seed ${game.seed}: ${built.error.message}`);
    const moment = built.value;
    try {
      expect(moment.fromMs).toBe(fromMs);
      expect(moment.sim.world.time.sim).toBe(fromMs);
      const collected: StepEvents[] = [];
      while (moment.sim.world.time.sim < moment.untilMs) {
        moment.sim.step();
        collected.push({
          atMs: moment.sim.world.time.sim,
          events: structuredClone(moment.sim.drainEvents().slice()),
        });
      }
      expect(hashJson(collected.flatMap((step) => step.events))).toBe(
        hashJson(eventsBetween(game.steps, fromMs, untilMs)),
      );
    } finally {
      moment.sim.dispose();
    }
  }
}

describe('the highlight replay, played live by bots (story 3.9, AC 17)', () => {
  const games: LiveGame[] = [];

  for (const levelId of LEVELS) {
    for (const botId of BOTS) {
      for (const seed of SEEDS) {
        it(
          `${levelId}, ${botId} bot, seed ${seed}: every moment replays as it was lived`,
          async () => {
            const game = await playLive(levelId, botId, seed);
            try {
              const rules = game.loaded.content.feedback.replay;
              // (c) the moments are spaced and in time order.
              for (let index = 1; index < game.highlights.length; index++) {
                const previous = game.highlights[index - 1] as Highlight;
                const next = game.highlights[index] as Highlight;
                expect(next.t - previous.t).toBeGreaterThanOrEqual(rules.minSpacingMs);
              }
              expect(game.highlights.length).toBeLessThanOrEqual(rules.momentCount);
              await checkMoments(game);
              games.push({ ...game });
            } finally {
              game.sim.dispose();
            }
          },
          TIMEOUT_MS,
        );
      }
    }
  }

  it('(c) at least one game has three moments', () => {
    const counts = games.map((game) => game.highlights.length);
    expect(Math.max(...counts), `moments per game: ${counts.join(', ')}`).toBe(3);
  });
});

describe('a mamaHome game replays the cascade (story 3.9, AC 7 and 17d)', () => {
  // The `idle` bot lets every threat through, so seed 1 ends on `mamaHome` on both live levels (asserted below).
  const CASES = [
    { levelId: 'salon_kitchen', botId: 'idle', seed: 1 },
    { levelId: 'salon_crawler', botId: 'idle', seed: 1 },
  ] as const;

  for (const found of CASES) {
    it(
      `${found.levelId}, ${found.botId} bot, seed ${found.seed}: the last gag is in`,
      async () => {
        const game = await playLive(found.levelId, found.botId, found.seed);
        try {
          expect(game.endReason).toBe('mamaHome');
          const gags = game.steps
            .flatMap((step) => step.events)
            .filter((event) => event.type === 'GagTriggered');
          const lastGag = gags.at(-1);
          expect(lastGag).toBeDefined();
          expect(game.highlights.at(-1)).toMatchObject({
            t: lastGag?.t,
            threatId: (lastGag as { threatId: number }).threatId,
          });
          await checkMoments(game);
        } finally {
          game.sim.dispose();
        }
      },
      TIMEOUT_MS,
    );
  }
});
