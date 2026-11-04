import { readFileSync } from 'node:fs';
import { playGame } from '@bots/playGame';
import { parseContentFile } from '@content/parseContentFile';
import { FeelSchema } from '@content/schemas/feel';
import { type LevelGeometry, LevelGeometrySchema } from '@content/schemas/levelGeometry';
import { STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../../src/sim/createSim.ts';
import type { SimEvent } from '../../src/sim/events.ts';
import type { World } from '../../src/sim/world.ts';
import { botSetup, makeBot } from '../support/botSupport.ts';
import { createTestContent, createTestLevel, testWave } from '../support/testContent.ts';

// The props of the final rush (story 3.5, AC 25 to 29) are a test on the LIVE geometry and the LIVE feel,
// like the boards of the stealth exit: when Geo moves a prop in Blender and re-exports, or retunes
// `feel.json › physics`, this is what says whether every prop still falls to the floor, can be tidied
// and stays where it stands until then. Positions in the Blender files are a starting point.
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

function liveGeometry(levelId: string): LevelGeometry {
  const parsed = parseContentFile(
    `content/levels/${levelId}.geometry.json`,
    read(`content/levels/${levelId}.geometry.json`),
    LevelGeometrySchema,
  );
  if (!parsed.ok) throw new Error('the live geometry is invalid');
  return parsed.value;
}

function liveFeel() {
  const parsed = parseContentFile('content/feel.json', read('content/feel.json'), FeelSchema);
  if (!parsed.ok) throw new Error('the live feel is invalid');
  return parsed.value;
}

/** The table of each live level: its anchor, and the props that stand on it. */
const LEVELS = [
  {
    levelId: 'salon_crawler',
    anchor: 'coffee_table',
    tableProps: ['mug_01', 'toy_01', 'mug_02', 'book_01'],
  },
  { levelId: 'chambre_night', anchor: 'nightstand', tableProps: ['mug_01', 'toy_01', 'book_01'] },
  {
    levelId: 'salon_kitchen',
    anchor: 'coffee_table',
    tableProps: ['mug_01', 'toy_01', 'mug_02', 'book_01'],
  },
] as const;

const DURATION_MS = 120_000;

async function liveSim(levelId: string, anchor: string, withGags: boolean): Promise<Sim> {
  const content = createTestContent();
  content.feel = liveFeel();
  const geometry = liveGeometry(levelId);
  const level = createTestLevel({
    durationMs: DURATION_MS,
    waves: withGags
      ? [testWave([{ def: 'coffee_table_object', anchor }], { gapMinMs: 0, gapMaxMs: 0 })]
      : [],
    finalRush: { spillAnchor: anchor },
  });
  return createSim({
    content,
    geometry,
    level: { ...level, level: { ...level.level, id: levelId } },
    seed: 7,
    strictInvariants: true,
  });
}

const propOf = (sim: Sim, id: string) => {
  const prop = sim.world.props.find((candidate) => candidate.id === id);
  if (prop === undefined) throw new Error(`no prop ${id}`);
  return prop;
};

function runUntil(sim: Sim, test: () => boolean, events: SimEvent[], maxSteps = 20_000): void {
  for (let i = 0; i < maxSteps && !test(); i++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
}

describe.each(LEVELS)('the props of $levelId (story 3.5)', ({ levelId, anchor, tableProps }) => {
  const geometry = liveGeometry(levelId);
  const anchorPosition = geometry.anchors.find((candidate) => candidate.id === anchor)
    ?.positionM as [number, number, number];

  it('declares its final rush on the table’s anchor, in its own level file (AC 1)', () => {
    const level = JSON.parse(read(`content/levels/${levelId}.json`)) as {
      finalRush?: { spillAnchor?: string };
    };
    expect(level.finalRush).toEqual({ spillAnchor: anchor });
    expect(geometry.anchors.map((candidate) => candidate.id)).toContain(anchor);
  });

  it('has the table props of AC 25, with the kinds the live feel knows', () => {
    const ids = geometry.props.map((prop) => prop.id);
    for (const id of tableProps) expect(ids, id).toContain(id);
    for (const prop of geometry.props) {
      expect(Object.keys(liveFeel().physics.kinds), prop.id).toContain(prop.kind);
    }
    expect(liveFeel().physics.kinds.book).toMatchObject({ shape: 'box', breakable: false });
    expect(liveFeel().physics.kinds.toy).toMatchObject({ shape: 'box', breakable: false });
  });

  it('keeps mug_01 the nearest prop to the table’s anchor, so the first fall does not change (AC 28)', () => {
    const distanceOf = (id: string) => {
      const prop = geometry.props.find((candidate) => candidate.id === id);
      const [x, , z] = prop?.centerM ?? [Number.NaN, 0, Number.NaN];
      return Math.hypot(x - anchorPosition[0], z - anchorPosition[2]);
    };
    const others = tableProps.filter((id) => id !== 'mug_01');
    for (const id of others) expect(distanceOf('mug_01'), id).toBeLessThan(distanceOf(id));
    // Ties would go to the lower index: mug_01 is strictly the nearest, so it does not depend on it.
  });

  it('keeps every prop where it stands until something moves it: no impact, no noise, no move (AC 29)', async () => {
    const sim = await liveSim(levelId, anchor, false);
    const events: SimEvent[] = [];
    const spawn = new Map(geometry.props.map((prop) => [prop.id, prop.centerM]));
    runUntil(
      sim,
      () => sim.world.time.sim >= DURATION_MS - liveFeel().endOfLevel.finalRushMs - STEP_MS,
      events,
    );
    expect(events.filter((event) => event.type === 'PropImpact')).toEqual([]);
    expect(events.filter((event) => event.type === 'NoiseChanged')).toEqual([]);
    expect(sim.world.mess.propsOnFloor).toBe(0);
    for (const prop of sim.world.props) {
      const [x, y, z] = spawn.get(prop.id) as [number, number, number];
      expect(Math.abs(prop.xM - x), `${prop.id} x`).toBeLessThan(0.01);
      expect(Math.abs(prop.zM - z), `${prop.id} z`).toBeLessThan(0.01);
      expect(Math.abs(prop.yM - y), `${prop.id} y`).toBeLessThan(0.01);
    }
  });

  it('drops every prop of the table, one gag per prop, each ending on the floor as a mess; then each can be tidied back onto the table (AC 27)', async () => {
    const sim = await liveSim(levelId, anchor, true);
    const events: SimEvent[] = [];
    const spawn = new Map(geometry.props.map((prop) => [prop.id, prop.centerM]));
    const fallen: string[] = [];
    for (let gag = 1; gag <= tableProps.length; gag++) {
      runUntil(
        sim,
        () => events.filter((event) => event.type === 'GagTriggered').length >= gag,
        events,
      );
      // Let the prop fall and settle.
      const until = sim.world.time.sim + 3000;
      runUntil(sim, () => sim.world.time.sim >= until, events);
      const nowOnFloor = sim.world.props
        .filter((prop) => tableProps.includes(prop.id as never) && prop.isOnFloor)
        .map((prop) => prop.id);
      // One more prop on the floor with each gag.
      expect(nowOnFloor.length, `after gag ${gag}`).toBe(gag);
      const added = nowOnFloor.filter((id) => !fallen.includes(id));
      expect(added, `after gag ${gag}`).toHaveLength(1);
      fallen.push(...added);
    }
    // No more gag from here on: the rest of the game is the tidying.
    (sim.world as World).director.nextAt = asSimMs(1e9);
    // The first fall is the mug's (AC 28), and the break of none is possible for a book or a toy.
    expect(fallen[0]).toBe('mug_01');
    for (const id of tableProps) {
      const prop = propOf(sim, id);
      expect(prop.isOnFloor, `${id} on the floor`).toBe(true);
      expect(prop.isBroken, `${id} not broken`).toBe(false);
      expect(prop.isMess, `${id} is a mess`).toBe(true);
    }
    expect(sim.world.mess.propsOnFloor).toBe(tableProps.length);
    // Tidied in the rush: each goes back to its table.
    runUntil(sim, () => sim.world.flow.state === 'finalRush', events, 60_000);
    expect(sim.world.flow.state).toBe('finalRush');
    for (const id of tableProps) {
      sim.enqueue({ type: 'TapObject', t: asSimMs(sim.world.time.sim), objectId: id });
      runUntil(sim, () => !propOf(sim, id).isMess && sim.world.papa.state === 'idle', events, 3000);
      expect(propOf(sim, id).isMess, `${id} tidied`).toBe(false);
    }
    const settleUntil = sim.world.time.sim + 3000;
    runUntil(sim, () => sim.world.time.sim >= settleUntil, events);
    expect(sim.world.score.propsTidied).toBe(tableProps.length);
    for (const id of tableProps) {
      const prop = propOf(sim, id);
      const [x, y, z] = spawn.get(id) as [number, number, number];
      expect(prop.isOnFloor, `${id} sits on the table`).toBe(false);
      expect(Math.abs(prop.xM - x), `${id} x`).toBeLessThan(0.02);
      expect(Math.abs(prop.yM - y), `${id} y`).toBeLessThan(0.02);
      expect(Math.abs(prop.zM - z), `${id} z`).toBeLessThan(0.02);
    }
  }, 60_000);
});

// The door's spill (story 3.5, D10, AC 30 and 31) on the live rooms and the live feel: a game with no
// gag at all, so that the only thing that falls is what the door knocks over.
describe.each(LEVELS)('the door’s spill in $levelId (story 3.5)', ({ levelId, anchor }) => {
  const geometry = liveGeometry(levelId);
  const RUSH_AT = DURATION_MS - liveFeel().endOfLevel.finalRushMs;
  const { sighPerPropOnFloorPoints } = liveFeel().mama;

  async function noGagSim(doorSpillCount: number) {
    const content = createTestContent();
    content.feel = liveFeel();
    content.feel.endOfLevel.doorSpillCount = doorSpillCount;
    const level = createTestLevel({ durationMs: DURATION_MS, finalRush: { spillAnchor: anchor } });
    return createSim({
      content,
      geometry,
      level: { ...level, level: { ...level.level, id: levelId } },
      seed: 3,
      strictInvariants: true,
    });
  }

  it('knocks over exactly the toy and the book: nothing breaks, the mugs and the vase stay where they are, both are a mess', async () => {
    const sim = await noGagSim(2);
    const events: SimEvent[] = [];
    runUntil(sim, () => sim.world.time.sim >= RUSH_AT, events);
    const before = sim.world.props.map((prop) => [prop.id, prop.xM, prop.yM, prop.zM]);
    runUntil(sim, () => sim.world.time.sim >= RUSH_AT + 4000, events);
    const fallen = sim.world.props
      .filter((prop) => prop.isOnFloor && prop.isMess)
      .map((prop) => prop.id);
    expect(fallen.sort()).toEqual(['book_01', 'toy_01']);
    expect(events.filter((event) => event.type === 'PropBroken')).toEqual([]);
    expect(sim.world.mess).toMatchObject({ propsOnFloor: 2, propsBroken: 0 });
    for (const [id, x, y, z] of before) {
      if (id === 'toy_01' || id === 'book_01') continue;
      const prop = propOf(sim, id as string);
      expect(Math.abs(prop.xM - (x as number)), `${id} x`).toBeLessThan(0.01);
      expect(Math.abs(prop.yM - (y as number)), `${id} y`).toBeLessThan(0.01);
      expect(Math.abs(prop.zM - (z as number)), `${id} z`).toBeLessThan(0.01);
    }
  });

  it('spills nothing with doorSpillCount 0', async () => {
    const sim = await noGagSim(0);
    const events: SimEvent[] = [];
    runUntil(sim, () => sim.world.time.sim >= RUSH_AT + 4000, events);
    expect(events.filter((event) => event.type === 'PropImpact')).toEqual([]);
    expect(sim.world.mess.propsOnFloor).toBe(0);
  });

  it.each(['perfect', 'human'] as const)(
    'lets %s tidy both before the photo: its sigh ends as if nothing had spilled',
    async (id) => {
      const play = async (doorSpillCount: number) => {
        const sim = await noGagSim(doorSpillCount);
        playGame(sim, makeBot(id, botSetup(3)), DURATION_MS * 2);
        return sim;
      };
      const spilled = await play(2);
      const clean = await play(0);
      expect(spilled.world.flow.state).toBe('photo');
      expect(spilled.world.score.propsTidied).toBe(2);
      expect(clean.world.score.propsTidied).toBe(0);
      expect(spilled.world.score.final?.sighPoints).toBe(clean.world.score.final?.sighPoints);
      expect(spilled.world.mess.propsOnFloor).toBe(0);
    },
  );

  it('costs an idle game 2 × sighPerPropOnFloorPoints against the same game without the spill', async () => {
    const play = async (doorSpillCount: number) => {
      const sim = await noGagSim(doorSpillCount);
      playGame(sim, makeBot('idle', botSetup(3)), DURATION_MS * 2);
      return sim.world.score.final?.sighPoints ?? Number.NaN;
    };
    const spilled = await play(2);
    const clean = await play(0);
    expect(spilled - clean).toBe(2 * sighPerPropOnFloorPoints);
  });

  it('spills nothing more when the gags already dropped the props of the table', async () => {
    const content = createTestContent();
    content.feel = liveFeel();
    const level = createTestLevel({
      durationMs: DURATION_MS,
      waves: [testWave([{ def: 'coffee_table_object', anchor }], { gapMinMs: 0, gapMaxMs: 0 })],
      finalRush: { spillAnchor: anchor },
    });
    const sim = await createSim({
      content,
      geometry,
      level: { ...level, level: { ...level.level, id: levelId } },
      seed: 7,
      strictInvariants: true,
    });
    const events: SimEvent[] = [];
    runUntil(sim, () => sim.world.time.sim >= RUSH_AT - STEP_MS, events);
    // The gags have knocked over everything on the table by now (a gag every few seconds for 110 s).
    const tableProps = sim.world.props.filter((prop) => prop.id !== 'vase_01');
    expect(tableProps.every((prop) => prop.isOnFloor || prop.isBroken)).toBe(true);
    const impactsBefore = events.filter((event) => event.type === 'PropImpact').length;
    expect(impactsBefore).toBeGreaterThan(0);
    runUntil(sim, () => sim.world.time.sim >= RUSH_AT + 3000, events);
    // The door has nothing left to knock over (no unbroken prop off the floor), so it adds no impact.
    expect(events.filter((event) => event.type === 'PropImpact')).toHaveLength(impactsBefore);
    expect(events.filter((event) => event.type === 'FinalRushStarted')).toHaveLength(1);
  });
});
