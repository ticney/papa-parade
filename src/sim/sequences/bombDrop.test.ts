import type { LevelGeometry } from '@content/schemas/levelGeometry';
import { STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  createTestBombDrop,
  createTestBombDropLay,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  NOISE_GAUGES,
} from '../../../tests/support/testContent.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import type { World } from '../world.ts';

// « Dépose-bombe » (story 4.8) through the real sim, on the frozen defs: a 2000 ms rest, a 2600 ms
// descent, a press within 700 ms of the telegraph, a release in a 300 ms window, slow motion at 0.4.
// Every instant comes from the def and the frozen feel, never from a literal of the live content.
const content = createTestContent();
const SEQUENCE = createTestBombDrop();
const LAY = createTestBombDropLay();
const step = SEQUENCE.steps[0];
if (step?.kind !== 'duel' || step.slowMo === undefined) {
  throw new Error('the frozen bomb drop lost its duel step or its slow motion');
}
const { restMs, slowMo } = step;
const { gagCryMs } = LAY;
if (gagCryMs === undefined) throw new Error('the frozen bomb drop lost its gag cry');
const windowMs = LAY.windowMs ?? content.feel.timing.windowMs;
const { toleranceMs } = content.feel.timing;
const CENTRE_MS = windowMs / 2;

type Of<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;
const only = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Of<T>[] =>
  events.filter((event): event is Of<T> => event.type === type);

interface Options {
  readonly geometry?: LevelGeometry;
  readonly hasNoise?: boolean;
  readonly durationMs?: number;
  readonly seed?: number;
}

async function newSim({
  geometry = createTestGeometry(),
  hasNoise = false,
  durationMs,
  seed = 1,
}: Options = {}): Promise<Sim> {
  return createSim({
    content,
    geometry,
    level: createTestLevel({
      carry: CARRY,
      sequences: ['bomb_drop'],
      ...(hasNoise ? { gauges: NOISE_GAUGES } : {}),
      ...(durationMs === undefined ? {} : { durationMs }),
    }),
    seed,
  });
}

const worldOf = (sim: Sim) => sim.world as World;
const layOf = (sim: Sim) => {
  const threat = worldOf(sim).threats.find((candidate) => candidate.defId === LAY.id);
  if (threat === undefined) throw new Error('no bomb drop instance');
  return threat;
};

/** Steps `sim` until `isDone`, collecting its events (at most `limit` steps). */
function stepUntil(sim: Sim, isDone: () => boolean, limit = 3000): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < limit && !isDone(); i++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  return events;
}

/** Starts the sequence and steps to the telegraph of the first round of the descent. */
async function telegraphed(options?: Options) {
  const sim = await newSim(options);
  const events: SimEvent[] = [];
  sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: 'bomb_drop' });
  const lay = layOf(sim);
  events.push(...stepUntil(sim, () => lay.state === 'telegraph'));
  expect(lay.state).toBe('telegraph');
  return { sim, world: worldOf(sim), lay, events };
}

type Round = Awaited<ReturnType<typeof telegraphed>>;

/** A press a little after the telegraph and a release at the centre of the window: a perfect drop. */
function dropPerfectly({ sim, lay }: Round): void {
  sim.enqueue({ type: 'PressThreat', t: asSimMs(lay.enteredAt + 100), threatId: lay.id });
  sim.enqueue({ type: 'Release', t: asSimMs(lay.windowOpenAt + CENTRE_MS) });
}

/** A press and a release 40 ms later: the finger came up long before the pose. */
function tapQuickly({ sim, lay }: Round): void {
  sim.enqueue({ type: 'PressThreat', t: asSimMs(lay.enteredAt + 100), threatId: lay.id });
  sim.enqueue({ type: 'Release', t: asSimMs(lay.enteredAt + 140) });
}

describe('winning the bomb drop (story 4.8, AC 6)', () => {
  it('lays the baby down and cashes the combo in, in the step of the release, in order', async () => {
    const round = await telegraphed();
    dropPerfectly(round);
    const events = stepUntil(round.sim, () => round.world.sequence.id === null);
    const resolvedAt = only(events, 'ResponseResolved')[0]?.t;
    expect(resolvedAt).toBeDefined();
    const ofStep = events.filter((event) => event.t === resolvedAt);
    const order = ofStep
      .filter((event) =>
        [
          'ResponseResolved',
          'SequenceEnded',
          'BabyStateChanged',
          'BabyPutDown',
          'ComboCashedIn',
          'ComboChanged',
        ].includes(event.type),
      )
      .map((event) =>
        event.type === 'ComboChanged' ? `ComboChanged:${event.reason}` : event.type,
      );
    // The response raises the multiplier first (`resolveThreat`), the put-down then cashes it in.
    expect(order).toEqual([
      'ResponseResolved',
      'ComboChanged:response',
      'SequenceEnded',
      'BabyStateChanged',
      'BabyPutDown',
      'ComboCashedIn',
      'ComboChanged:cashIn',
    ]);
    expect(only(ofStep, 'ResponseResolved')[0]).toMatchObject({
      response: 'firm',
      quality: 'perfect',
      offsetMs: 0,
    });
    expect(only(ofStep, 'SequenceEnded')).toEqual([
      expect.objectContaining({ id: 'bomb_drop', outcome: 'succeeded' }),
    ]);
    expect(only(ofStep, 'BabyStateChanged')).toEqual([
      expect.objectContaining({ from: 'carried', to: 'babble' }),
    ]);
    expect(only(ofStep, 'BabyPutDown')).toEqual([expect.objectContaining({ safe: true })]);
  });

  it('cashes in at x2 at least, the response having raised the multiplier first', async () => {
    const round = await telegraphed();
    dropPerfectly(round);
    const events = stepUntil(round.sim, () => round.world.sequence.id === null);
    const [cashedIn] = only(events, 'ComboCashedIn');
    expect(cashedIn).toBeDefined();
    expect(cashedIn?.multiplier).toBeGreaterThanOrEqual(content.feel.combo.minMultiplier + 1);
    expect(cashedIn?.points).toBe((cashedIn?.multiplier ?? 0) * (cashedIn?.basePoints ?? 0));
    expect(round.world.score.comboPoints).toBe(cashedIn?.points);
  });

  it('leaves Papa free and the baby down in his normal FSM, with the resume gap applied', async () => {
    const round = await telegraphed();
    dropPerfectly(round);
    stepUntil(round.sim, () => round.world.sequence.id === null);
    const { world } = round;
    expect(world.flow.state).toBe('playing');
    expect(world.baby.state).toBe('babble');
    expect(world.papa.state).toBe('idle');
    expect(world.sequence.lastId).toBe('bomb_drop');
    expect(world.director.nextAt).toBeGreaterThanOrEqual(
      world.time.sim + content.feel.sequences.resumeGapMs - STEP_MS,
    );
    // Free: a tap on the floor walks him again.
    round.sim.enqueue({
      type: 'TapFloor',
      t: world.time.sim,
      xM: world.papa.xM + 0.5,
      zM: world.papa.zM,
    });
    const events = stepUntil(round.sim, () => false, 2);
    expect(only(events, 'PapaPathPlanned')).toHaveLength(1);
  });
});

describe('a tap on the baby in the step that lays him (story 4.8, review)', () => {
  it("does not take him back from the mattress: the step that lays him is the sequence's last, still held", async () => {
    const round = await telegraphed();
    const { sim, world, lay } = round;
    dropPerfectly(round);
    const events: SimEvent[] = [];
    // A `TapBaby` in every step around the pose, until the sequence is over: one of them lands in the
    // step of the release, which is the step that lays the baby down.
    for (let i = 0; i < 3000 && world.sequence.id !== null; i++) {
      if (world.time.sim >= lay.windowOpenAt - 3 * STEP_MS) {
        sim.enqueue({ type: 'TapBaby', t: world.time.sim });
      }
      sim.step();
      events.push(...sim.drainEvents());
    }
    expect(only(events, 'SequenceEnded')).toEqual([
      expect.objectContaining({ outcome: 'succeeded' }),
    ]);
    expect(only(events, 'BabyPutDown')).toHaveLength(1);
    expect(only(events, 'ComboCashedIn')).toHaveLength(1);
    expect(only(events, 'BabyPickedUp')).toEqual([]);
    expect(world.baby.state).toBe('babble');
  });
});

describe('the start: Papa over the mattress (story 4.8, AC 6, D3)', () => {
  it('places Papa at the centre of the safe zone when he starts outside it, with no event', async () => {
    const sim = await newSim();
    const world = worldOf(sim);
    const zone = createTestGeometry().zones.find((candidate) => candidate.kind === 'safe');
    if (zone === undefined) throw new Error('no safe zone in the frozen room');
    expect(Math.abs(world.papa.xM - zone.centerM[0])).toBeGreaterThan(zone.halfExtentsM[0]);
    sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: 'bomb_drop' });
    sim.step();
    const events = sim.drainEvents();
    expect(world.papa.xM).toBe(zone.centerM[0]);
    expect(world.papa.zM).toBe(zone.centerM[2]);
    expect(world.papa.prevXM).toBe(world.papa.xM);
    expect(
      events.some((event) => event.type.startsWith('Papa') && event.type !== 'PapaStateChanged'),
    ).toBe(false);
    expect(only(events, 'BabyPickedUp')).toHaveLength(1);
    expect(world.baby.xM).toBe(world.papa.xM);
  });

  it('leaves Papa where he is when he already stands in the safe zone', async () => {
    const sim = await newSim();
    const world = worldOf(sim);
    const zone = createTestGeometry().zones.find((candidate) => candidate.kind === 'safe');
    if (zone === undefined) throw new Error('no safe zone in the frozen room');
    world.papa.xM = zone.centerM[0] + zone.halfExtentsM[0] / 2;
    world.papa.zM = zone.centerM[2] - zone.halfExtentsM[2] / 2;
    const at = { xM: world.papa.xM, zM: world.papa.zM };
    sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: 'bomb_drop' });
    sim.step();
    expect({ xM: world.papa.xM, zM: world.papa.zM }).toEqual(at);
  });

  it('goes to the nearest of two safe zones', async () => {
    const geometry = createTestGeometry();
    const papaSpawn = geometry.anchors.find((anchor) => anchor.id === 'papa_spawn');
    if (papaSpawn === undefined) throw new Error('no papa_spawn in the frozen room');
    // A second mattress a step from where Papa starts: nearer than the playpen.
    const near = {
      id: 'near_mattress',
      kind: 'safe' as const,
      centerM: [papaSpawn.positionM[0] - 0.5, 0.3, papaSpawn.positionM[2]] as [
        number,
        number,
        number,
      ],
      halfExtentsM: [0.2, 0.3, 0.2] as [number, number, number],
    };
    const sim = await newSim({ geometry: { ...geometry, zones: [...geometry.zones, near] } });
    const world = worldOf(sim);
    sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: 'bomb_drop' });
    sim.step();
    expect(world.papa.xM).toBe(near.centerM[0]);
    expect(world.papa.zM).toBe(near.centerM[2]);
  });
});

describe('the slow motion of the round (story 4.8, AC 5)', () => {
  it('starts at the telegraph for the whole descent, the pose and the window, and no more', async () => {
    const { world, lay } = await telegraphed();
    const running = world.time.slowMos.find((candidate) => candidate.source === 'sequence');
    expect(running).toBeDefined();
    expect(running?.scale).toBe(slowMo.timeScale);
    const closesAt = lay.windowOpenAt + windowMs + toleranceMs + world.input.lagMs;
    expect(running?.holdUntil).toBe(closesAt);
    expect(running?.endsAt).toBe(closesAt + slowMo.returnMs);
    expect(world.time.scale).toBe(slowMo.timeScale);
  });

  it('ends with the drop: the hold stops at the release and the return runs out', async () => {
    const round = await telegraphed();
    dropPerfectly(round);
    stepUntil(round.sim, () => round.world.sequence.id === null);
    const ended = round.world.time.slowMos.find((candidate) => candidate.source === 'sequence');
    expect(ended?.holdUntil).toBe(round.world.time.sim);
    expect(ended?.endsAt).toBe(round.world.time.sim + slowMo.returnMs);
    // The perfect's own slow motion and the combo's may still run: the sequence's must be gone.
    stepUntil(round.sim, () => round.world.time.sim >= (ended?.endsAt ?? 0) + STEP_MS);
    expect(round.world.time.slowMos.some((candidate) => candidate.source === 'sequence')).toBe(
      false,
    );
  });

  it('starts none in a duel with no slowMo: the bedtime duel keeps its speed', async () => {
    const sim = await createSim({
      content,
      geometry: createTestGeometry(),
      level: createTestLevel({ carry: CARRY, sequences: ['bedtime_duel'] }),
      seed: 1,
    });
    sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: 'bedtime_duel' });
    const eyes = worldOf(sim).threats.find((candidate) => candidate.defId === 'bedtime_eyes');
    stepUntil(sim, () => eyes?.state === 'telegraph');
    expect(eyes?.state).toBe('telegraph');
    expect(worldOf(sim).time.slowMos).toEqual([]);
    expect(worldOf(sim).time.scale).toBe(1);
  });
});

describe('failing the bomb drop (story 4.8, AC 7)', () => {
  it('retreats on a quick tap: the gag, the retreat to step 0, the baby still in the arms', async () => {
    const round = await telegraphed();
    tapQuickly(round);
    const events = stepUntil(round.sim, () => round.world.sequence.duel.retreats === 1);
    expect(only(events, 'GagTriggered')).toEqual([
      expect.objectContaining({ gag: 'baby_woke_on_drop', reason: 'released' }),
    ]);
    expect(only(events, 'SequenceStepRetreated')).toEqual([
      expect.objectContaining({ fromStepIndex: 0, stepIndex: 0, retreats: 1 }),
    ]);
    expect(round.world.sequence.id).toBe('bomb_drop');
    expect(round.world.baby.state).toBe('carried');
    expect(only(events, 'ComboCashedIn')).toEqual([]);
  });

  it('ends the slow motion at the retreat and restarts it with the next descent', async () => {
    const round = await telegraphed();
    tapQuickly(round);
    stepUntil(round.sim, () => round.world.sequence.duel.retreats === 1);
    const ended = round.world.time.slowMos.find((candidate) => candidate.source === 'sequence');
    // Ended now: its hold is over, and it is back to normal within `returnMs` at most.
    expect(ended === undefined || ended.holdUntil <= round.world.time.sim).toBe(true);
    expect(ended === undefined || ended.endsAt <= round.world.time.sim + slowMo.returnMs).toBe(
      true,
    );
    stepUntil(round.sim, () => layOf(round.sim).state === 'telegraph');
    const again = round.world.time.slowMos.find((candidate) => candidate.source === 'sequence');
    expect(again?.scale).toBe(slowMo.timeScale);
    expect(again?.holdUntil).toBeGreaterThan(round.world.time.sim);
  });

  it('starts the descent over after restMs', async () => {
    const round = await telegraphed();
    tapQuickly(round);
    const events = stepUntil(round.sim, () => round.world.sequence.duel.retreats === 1);
    const retreatAt = only(events, 'SequenceStepRetreated')[0]?.t ?? 0;
    const next = stepUntil(round.sim, () => layOf(round.sim).state === 'telegraph');
    const telegraphAt = only(next, 'ThreatTelegraphed')[0]?.t ?? 0;
    expect(telegraphAt).toBeGreaterThanOrEqual(retreatAt + restMs);
  });

  it('wakes the baby at the third failure: BabyWoke, failed, and he stays carried, no cash-in', async () => {
    const round = await telegraphed();
    const all: SimEvent[] = [...round.events];
    for (let retreat = 1; retreat <= 3; retreat++) {
      tapQuickly(round);
      all.push(
        ...stepUntil(
          round.sim,
          () => round.world.sequence.id === null || round.world.sequence.duel.retreats === retreat,
        ),
      );
      if (retreat < 3) {
        all.push(...stepUntil(round.sim, () => layOf(round.sim).state === 'telegraph'));
      }
    }
    expect(only(all, 'BabyWoke')).toHaveLength(1);
    expect(only(all, 'SequenceStepRetreated')).toHaveLength(2);
    expect(only(all, 'SequenceEnded')).toEqual([
      expect.objectContaining({ id: 'bomb_drop', outcome: 'failed' }),
    ]);
    expect(round.world.baby.state).toBe('carried');
    expect(only(all, 'BabyPutDown')).toEqual([]);
    expect(only(all, 'ComboCashedIn')).toEqual([]);
    expect(round.world.flow.state).toBe('playing');
  });

  it('resets the combo on the gag', async () => {
    const round = await telegraphed();
    round.world.combo.multiplier = content.feel.combo.minMultiplier + 2;
    tapQuickly(round);
    const events = stepUntil(round.sim, () => round.world.sequence.duel.retreats === 1);
    expect(round.world.combo.multiplier).toBe(content.feel.combo.minMultiplier);
    expect(only(events, 'ComboChanged')).toEqual([
      expect.objectContaining({ reason: 'gag', multiplier: content.feel.combo.minMultiplier }),
    ]);
  });

  it('makes noise: the cry of the gag comes through in a level with noise', async () => {
    const round = await telegraphed({ hasNoise: true });
    const before = round.world.gauges.noisePct;
    tapQuickly(round);
    const events = stepUntil(round.sim, () => round.world.sequence.duel.retreats === 1);
    stepUntil(round.sim, () => round.world.time.sim >= (events.at(-1)?.t ?? 0) + gagCryMs + 1000);
    expect(round.world.gauges.noisePct).toBeGreaterThan(before);
  });

  it('rests for at least as long as the cry, so that a cry never covers the next descent cue', () => {
    expect(restMs).toBeGreaterThanOrEqual(gagCryMs);
  });
});

describe('the end of the level during the drop (story 4.8)', () => {
  it('closes the sequence and its slow motion when Mama wakes mid-descent', async () => {
    const round = await telegraphed({ hasNoise: true });
    round.sim.enqueue({ type: 'SetNoise', t: round.world.time.sim, pct: 100 });
    const events = stepUntil(round.sim, () => round.world.flow.state === 'ended');
    expect(only(events, 'SequenceEnded')).toEqual([
      expect.objectContaining({ id: 'bomb_drop', outcome: 'levelEnded' }),
    ]);
    expect(round.world.sequence.id).toBe(null);
    stepUntil(round.sim, () => false, 50);
    expect(round.world.time.slowMos.some((candidate) => candidate.source === 'sequence')).toBe(
      false,
    );
    expect(round.world.time.scale).toBe(1);
  });
});
