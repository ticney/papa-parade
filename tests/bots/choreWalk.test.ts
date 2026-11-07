import { createChoreMemory, planChore } from '@bots/threatTiming';
import { asSimMs } from '@shared/time';
import { createSim, type SimCommand, type World } from '@sim';
import { describe, expect, it } from 'vitest';
import {
  createTestBots,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  DISHWASHER_OPEN,
  TEST_COOKING,
  TEST_DISHWASHER,
  TEST_OBJECTS,
  TEST_STOVE,
  TEST_UNLOAD_DISHWASHER,
  testWave,
} from '../support/testContent.ts';

// The walk of the house chores (story 9.6, AC 12): with two stations the bots resume a `paused` chore
// before they start an `untouched` one, by index within each group; a station whose tap did not put
// Papa to work is skipped at the next try (9.4's deferred « a refused station blocks the next one »);
// and a level with one station behaves as it did.

const { chores: choreSettings } = createTestBots();
const OBJECT_IDS = ['stove', 'dishwasher'];
/** More than the retry spacing and the lull: every call below is a fresh try. */
const TRY_EVERY_MS = 5000;

type ChoreState = World['chores'][number]['state'];

/** The world of a frozen two-station level, its chores put in `states` and its clock at `nowMs`. */
async function worldOf(states: readonly ChoreState[], nowMs: number): Promise<World> {
  const sim = await createSim({
    content: createTestContent(),
    geometry: createTestGeometry(),
    level: createTestLevel({
      waves: [testWave([DISHWASHER_OPEN], { fromMs: 500_000 })],
      objects: [...TEST_OBJECTS, TEST_STOVE, TEST_DISHWASHER],
      chores: [TEST_COOKING, TEST_UNLOAD_DISHWASHER],
    }),
    seed: 1,
  });
  const world = sim.world as World;
  world.time.sim = asSimMs(nowMs);
  world.chores = world.chores.slice(0, states.length);
  states.forEach((state, i) => {
    const chore = world.chores[i] as World['chores'][number];
    chore.state = state;
    chore.beatsDone = state === 'done' ? 4 : 0;
  });
  return world;
}

/** One try of the bot: the objects it taps (none, or one). */
function tapsOf(
  world: World,
  memory = createChoreMemory(),
  objectIds: readonly string[] = OBJECT_IDS,
): string[] {
  const out: SimCommand[] = [];
  planChore(world, objectIds, choreSettings, true, out, memory);
  return out.map((command) => (command.type === 'TapObject' ? command.objectId : command.type));
}

describe('the walk of the chores (story 9.6, AC 12)', () => {
  it('starts the first untouched station when none is paused', async () => {
    expect(tapsOf(await worldOf(['untouched', 'untouched'], TRY_EVERY_MS))).toEqual(['stove']);
  });

  it('resumes a paused chore before it starts an untouched one, whatever their order', async () => {
    expect(tapsOf(await worldOf(['untouched', 'paused'], TRY_EVERY_MS))).toEqual(['dishwasher']);
    expect(tapsOf(await worldOf(['paused', 'untouched'], TRY_EVERY_MS))).toEqual(['stove']);
  });

  it('takes the paused chores in index order, and skips the done ones', async () => {
    expect(tapsOf(await worldOf(['paused', 'paused'], TRY_EVERY_MS))).toEqual(['stove']);
    expect(tapsOf(await worldOf(['done', 'paused'], TRY_EVERY_MS))).toEqual(['dishwasher']);
  });

  it('never taps a station that is done, and taps nothing once all are', async () => {
    expect(tapsOf(await worldOf(['done', 'untouched'], TRY_EVERY_MS))).toEqual(['dishwasher']);
    expect(tapsOf(await worldOf(['done', 'done'], TRY_EVERY_MS))).toEqual([]);
  });

  it('taps nothing while a chore is being worked: Papa is not idle', async () => {
    const world = await worldOf(['working', 'untouched'], TRY_EVERY_MS);
    world.papa.state = 'chore';
    expect(tapsOf(world)).toEqual([]);
  });

  it('skips a station whose tap did not put Papa to work, at the next try, and comes back to it after', async () => {
    const memory = createChoreMemory();
    // The first try taps the stove; nothing moves (the chore keeps its `enteredAt` of before the tap).
    expect(tapsOf(await worldOf(['untouched', 'untouched'], TRY_EVERY_MS), memory)).toEqual([
      'stove',
    ]);
    // The next try, a whole retry later, goes to the dishwasher instead of the stove that did nothing…
    expect(tapsOf(await worldOf(['untouched', 'untouched'], 2 * TRY_EVERY_MS), memory)).toEqual([
      'dishwasher',
    ]);
    // …and the one after, the dishwasher having done nothing either, comes back to the stove.
    expect(tapsOf(await worldOf(['untouched', 'untouched'], 3 * TRY_EVERY_MS), memory)).toEqual([
      'stove',
    ]);
  });

  it('does not skip a station Papa worked at and left: it is resumed, not refused', async () => {
    const memory = createChoreMemory();
    expect(tapsOf(await worldOf(['untouched', 'untouched'], TRY_EVERY_MS), memory)).toEqual([
      'stove',
    ]);
    // The stove was worked after the tap (it went working, then paused: entered after the tap).
    const later = await worldOf(['paused', 'untouched'], 2 * TRY_EVERY_MS);
    (later.chores[0] as World['chores'][number]).enteredAt = asSimMs(TRY_EVERY_MS + 600);
    expect(tapsOf(later, memory)).toEqual(['stove']);
  });

  it('keeps tapping the only station there is, whatever it did: a level with one station is as before', async () => {
    const memory = createChoreMemory();
    for (let attempt = 1; attempt <= 3; attempt++) {
      const world = await worldOf(['untouched'], attempt * TRY_EVERY_MS);
      expect(tapsOf(world, memory, ['stove'])).toEqual(['stove']);
    }
  });

  it('does not tap twice within the retry spacing, whichever station it would be', async () => {
    const memory = createChoreMemory();
    expect(tapsOf(await worldOf(['untouched', 'untouched'], TRY_EVERY_MS), memory)).toEqual([
      'stove',
    ]);
    expect(tapsOf(await worldOf(['untouched', 'untouched'], TRY_EVERY_MS + 500), memory)).toEqual(
      [],
    );
  });
});
