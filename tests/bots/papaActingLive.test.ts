import { fileURLToPath } from 'node:url';
import type { BotId } from '@bots/bot';
import { botResponsesOf, releaseDefIdsOf, safeSpotOf } from '@bots/botResponses';
import { botViewOf } from '@bots/botView';
import { createBot } from '@bots/createBot';
import { STEP_MS } from '@shared/constants';
import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { createSim, isFlowLive, type Sim, type SimCommand, type SimEvent } from '@sim';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  PAPA_ACTING_CUT_EVENTS,
  PAPA_IDLE_CLIPS,
} from '../../src/client/render/views/characterClips.ts';
import { isSignalOnly } from '../../src/client/render/views/faceInputs.ts';
import {
  createIdleSlot,
  idleSlotAt,
  isPapaIdleEligible,
  PAPA_IDLE_SALT,
} from '../../src/client/render/views/papaActing.ts';
import { loadSimLevel, type SimLevel } from '../../tools/sim/loadSimLevel.ts';

// Story 7.11, the headless proof of Papa's idles (AC 5, 6, 7): whole games of the real `createSim` on the live
// content, played by bots, with the idles read as `papaView.ts` reads them (a frame every two steps, the slots on
// the step clock `world.time.sim`, each slot seen by the one frame that first reaches it, played only if Papa is
// free for it). Then the table of the commands a player can send to an idle Papa: each one's applying step emits
// an event that cuts his acting (D12).

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const CONTENT_DIR = `${REPO}content`;
const TIMEOUT_MS = 600_000;
const LEVELS = ['salon_kitchen', 'salon_crawler', 'chambre_night'] as const;
const SEEDS = [1, 2, 3];
const BOTS: readonly BotId[] = ['idle', 'human', 'perfect'];
/** Sim steps per rendered frame: more than one at 30 fps, as 7.10's review asked of a live read. */
const STEPS_PER_FRAME = 2;

/** A command of any kind with no `t`: the helpers date it on the sim's clock. */
type Untimed = {
  [K in SimCommand['type']]: Omit<Extract<SimCommand, { type: K }>, 't'>;
}[SimCommand['type']];

const levels = new Map<string, SimLevel>();

beforeAll(async () => {
  for (const id of LEVELS) {
    const loaded = await loadSimLevel(CONTENT_DIR, id);
    if (!loaded.ok) throw new Error(loaded.error);
    levels.set(id, loaded.value);
  }
}, TIMEOUT_MS);

interface PlayedIdle {
  /** The step clock of the frame that played it. */
  readonly atMs: number;
  readonly slotAt: number;
  readonly enteredAt: number;
  readonly index: number;
  readonly clip: string;
}

interface IdlesRun {
  readonly played: PlayedIdle[];
  readonly violations: string[];
  /** Frames that reached a slot Papa was not free for. */
  readonly skipped: number;
  /** Frames on which only the signals counted. */
  readonly guardedFrames: number;
}

async function playIdles(levelId: string, botId: BotId, seed: number): Promise<IdlesRun> {
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
  const played: PlayedIdle[] = [];
  const violations: string[] = [];
  let skipped = 0;
  let guardedFrames = 0;
  let lastSimMs: number | null = null;
  const out: SimCommand[] = [];
  while (sim.world.time.sim < level.level.durationMs && isFlowLive(sim.world)) {
    out.length = 0;
    bot.value.act(sim.world, out);
    for (const command of out) sim.enqueue(command);
    for (let i = 0; i < STEPS_PER_FRAME; i++) sim.step();
    sim.drainEvents();
    const { world } = sim;
    const simMs = world.time.sim;
    const isGuarded = isSignalOnly(world);
    if (isGuarded) guardedFrames += 1;
    if (lastSimMs === null) {
      lastSimMs = simMs;
      continue;
    }
    const { idles } = world.feel.characters;
    idleSlotAt(
      seed,
      PAPA_IDLE_SALT,
      world.papa.enteredAt,
      simMs,
      idles,
      PAPA_IDLE_CLIPS.length,
      slot,
    );
    if (slot.index >= 0 && slot.startAt > lastSimMs) {
      if (isPapaIdleEligible(world.papa, world.baby, isGuarded, false, false)) {
        const at = `${levelId}/${botId}/${seed} at ${simMs} ms`;
        // What the guard stands for, read from the world on its own (D7): no duel, no stealth step.
        if (world.sequence.duel.isRunning || world.sequence.stealth.isRunning) {
          violations.push(`${at}: an idle in a duel or stealth step`);
        }
        if (world.baby.state === 'carried') violations.push(`${at}: an idle with the baby carried`);
        if (world.papa.state !== 'idle') violations.push(`${at}: an idle in ${world.papa.state}`);
        if (simMs - slot.startAt >= STEPS_PER_FRAME * STEP_MS) {
          violations.push(`${at}: slot of ${slot.startAt} ms seen late`);
        }
        played.push({
          atMs: simMs,
          slotAt: slot.startAt,
          enteredAt: world.papa.enteredAt,
          index: slot.index,
          clip: PAPA_IDLE_CLIPS[slot.variant] as string,
        });
      } else {
        skipped += 1;
      }
    }
    lastSimMs = simMs;
  }
  return { played, violations, skipped, guardedFrames };
}

describe('the idles in live games (story 7.11, AC 5-7)', () => {
  const runs = new Map<string, IdlesRun>();

  beforeAll(async () => {
    for (const levelId of LEVELS) {
      for (const botId of BOTS) {
        for (const seed of SEEDS)
          runs.set(`${levelId}/${botId}/${seed}`, await playIdles(levelId, botId, seed));
      }
    }
  }, TIMEOUT_MS);

  it('plays no idle in a duel or stealth step, with the baby carried, or outside `idle`; each in its frame', () => {
    for (const [key, run] of runs) expect(run.violations, key).toEqual([]);
  });

  it('plays each idle at least firstAfterMs after Papa stood still, and slots of one spell gapMinMs to gapMaxMs apart, never the same twice', () => {
    for (const [key, run] of runs) {
      const levelId = key.split('/')[0] as string;
      const { idles } = (levels.get(levelId) as SimLevel).content.feel.characters;
      for (const [i, idle] of run.played.entries()) {
        expect(idle.slotAt - idle.enteredAt, key).toBeGreaterThanOrEqual(idles.firstAfterMs);
        const previous = run.played[i - 1];
        if (previous === undefined || previous.enteredAt !== idle.enteredAt) continue;
        const slotsApart = idle.index - previous.index;
        expect(slotsApart, key).toBeGreaterThan(0);
        expect(idle.slotAt - previous.slotAt, key).toBeGreaterThanOrEqual(
          idles.gapMinMs * slotsApart,
        );
        expect(idle.slotAt - previous.slotAt, key).toBeLessThanOrEqual(idles.gapMaxMs * slotsApart);
        if (slotsApart === 1) expect(idle.clip, `${key} at ${idle.atMs}`).not.toBe(previous.clip);
      }
    }
  });

  it('plays all three idles over the games, some in every game of the idle bot, and the guard was met', () => {
    const all = [...runs.values()].flatMap((run) => run.played.map((idle) => idle.clip));
    for (const clip of PAPA_IDLE_CLIPS) expect(all, clip).toContain(clip);
    const idleBot = [...runs].filter(([key]) => key.includes('/idle/'));
    for (const [key, run] of idleBot) expect(run.played.length, key).toBeGreaterThan(0);
    const guarded = [...runs.values()].reduce((sum, run) => sum + run.guardedFrames, 0);
    expect(guarded).toBeGreaterThan(0);
  });

  it(
    'plays the same idles at the same slots when the same game is played again',
    async () => {
      for (const levelId of LEVELS) {
        const again = await playIdles(levelId, 'human', 2);
        const first = runs.get(`${levelId}/human/2`) as IdlesRun;
        expect(hashJson(again.played), levelId).toBe(hashJson(first.played));
      }
    },
    TIMEOUT_MS,
  );
});

describe('every command a player sends an idle Papa cuts his acting in its applying step (story 7.11, AC 5, D12)', () => {
  /** A live `levelId` played 20 steps from seed 1, with nobody at the controls: Papa idle at his spawn. */
  async function idleSim(levelId: string): Promise<Sim> {
    const { content, geometry, level } = levels.get(levelId) as SimLevel;
    const sim = await createSim({ content, geometry, level, seed: 1, strictInvariants: true });
    for (let i = 0; i < 20; i++) sim.step();
    sim.drainEvents();
    return sim;
  }
  const send = (sim: Sim, command: Untimed): void =>
    sim.enqueue({ ...command, t: asSimMs(sim.world.time.sim) } as SimCommand);
  const settle = (sim: Sim, ms: number): void => {
    const end = sim.world.time.sim + ms;
    while (sim.world.time.sim < end) sim.step();
    sim.drainEvents();
  };
  /** The event types of the one step that applies `command`. */
  const applyingStepOf = (sim: Sim, command: Untimed): SimEvent['type'][] => {
    send(sim, command);
    sim.step();
    return sim.drainEvents().map((event) => event.type);
  };
  const cuts = (types: readonly SimEvent['type'][]): boolean =>
    types.some((type) => PAPA_ACTING_CUT_EVENTS.includes(type));

  it.each(LEVELS)(
    'on %s: a tap on the floor, near or on a wall, a move, the baby far, near and carried',
    async (levelId) => {
      const commands: [string, (sim: Sim) => Untimed, (sim: Sim) => void][] = [
        [
          'TapFloor',
          (sim) => ({ type: 'TapFloor', xM: sim.world.papa.xM + 1, zM: sim.world.papa.zM }),
          () => {},
        ],
        [
          'TapFloor on his own spot',
          (sim) => ({ type: 'TapFloor', xM: sim.world.papa.xM, zM: sim.world.papa.zM }),
          () => {},
        ],
        ['TapFloor out of the room', () => ({ type: 'TapFloor', xM: 999, zM: 999 }), () => {}],
        ['Move', () => ({ type: 'Move', dirX: 1, dirZ: 0 }), () => {}],
        ['TapBaby far', () => ({ type: 'TapBaby' }), () => {}],
        [
          'TapBaby near',
          () => ({ type: 'TapBaby' }),
          (sim) => {
            // Walked to him, and holding him: put him down first, so that Papa stands next to him.
            send(sim, { type: 'TapBaby' });
            settle(sim, 6000);
            if (sim.world.baby.state === 'carried') {
              send(sim, { type: 'TapBaby' });
              settle(sim, 100);
            }
          },
        ],
        [
          'TapBaby carried',
          () => ({ type: 'TapBaby' }),
          (sim) => {
            send(sim, { type: 'TapBaby' });
            settle(sim, 6000);
          },
        ],
      ];
      for (const [name, command, prepare] of commands) {
        const sim = await idleSim(levelId);
        prepare(sim);
        expect(sim.world.papa.state, name).toBe('idle');
        expect(cuts(applyingStepOf(sim, command(sim))), name).toBe(true);
      }
    },
  );

  it.each(LEVELS)('on %s: a tap on each of the level’s objects', async (levelId) => {
    const objects = (levels.get(levelId) as SimLevel).level.level.objects ?? [];
    expect(objects.length).toBeGreaterThan(0);
    for (const object of objects) {
      const sim = await idleSim(levelId);
      expect(cuts(applyingStepOf(sim, { type: 'TapObject', objectId: object.id })), object.id).toBe(
        true,
      );
    }
  });

  it.each(LEVELS)(
    'on %s: a press on a forced threat, in its window and on its telegraph',
    async (levelId) => {
      for (const isInWindow of [true, false]) {
        const sim = await idleSim(levelId);
        const target = sim.world.threats.find((threat) => threat.state === 'idle');
        if (target === undefined) throw new Error(`${levelId} has no idle threat to force`);
        send(sim, { type: 'ForceThreat', threatId: target.id });
        for (let i = 0; i < 1000; i++) {
          sim.step();
          const state = sim.world.threats.find((threat) => threat.id === target.id)?.state;
          if (state === (isInWindow ? 'windowOpen' : 'telegraph')) break;
        }
        sim.drainEvents();
        const pressed = sim.world.threats.find((threat) => threat.id === target.id);
        expect(pressed?.state).toBe(isInWindow ? 'windowOpen' : 'telegraph');
        expect(
          cuts(applyingStepOf(sim, { type: 'PressThreat', threatId: target.id })),
          `${levelId} in window ${isInWindow}`,
        ).toBe(true);
      }
    },
  );
});
