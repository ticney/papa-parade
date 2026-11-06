import type { Feel } from '@content/schemas/feel';
import { MS_PER_S, STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  COFFEE_TABLE,
  createTestAbandonableCooking,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  createTestMicroSleep,
  FATIGUE_GAUGES,
  OUTLET,
  SILENCE,
  STAIRS,
  stepN,
  TEST_COOKING,
  TEST_OBJECTS,
  TEST_STOVE,
  testMicroSleepBusyMs,
  testWave,
} from '../../../tests/support/testContent.ts';
import type { StepContext } from '../context.ts';
import { createSim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import type { World } from '../world.ts';
import { applyAfterEffect } from './afterEffects.ts';
import {
  AFTER_EFFECT_OF_GAG,
  applyGag,
  CATASTROPHE_OF_GAG,
  catastropheProblem,
  GAG_IDS,
  type GagId,
  isNearMissGag,
} from './gags.ts';

const content = createTestContent();
const { pushImpulseNs, propReachDistM } = content.feel.gags.tableObjectFall;

/** A gag step on the frozen room, with a port that records the impulses the gag asks for. */
async function setup(feel: Feel = content.feel) {
  const sim = await createSim({
    content: { ...content, feel },
    geometry: createTestGeometry(),
    level: createTestLevel({
      waves: [testWave([OUTLET, STAIRS, COFFEE_TABLE, SILENCE])],
      gauges: FATIGUE_GAUGES,
      carry: CARRY,
      sequences: ['bedtime_duel', 'fake_sleep_duel', 'bomb_drop', 'stealth_exit'],
      // The pot on the stove (story 9.5) is the threat of an abandoned cooking.
      objects: [...TEST_OBJECTS, TEST_STOVE],
      chores: [TEST_COOKING],
      choreDefs: { cooking: createTestAbandonableCooking() },
    }),
    seed: 1,
  });
  const world = sim.world as World;
  world.time.sim = asSimMs(500);
  const events: SimEvent[] = [];
  const impulses: { propIndex: number; xNs: number; yNs: number; zNs: number }[] = [];
  const ctx = {
    feel,
    events,
    strictInvariants: true,
    t: world.time.sim,
    physics: {
      applyImpulse: (propIndex: number, xNs: number, yNs: number, zNs: number) =>
        impulses.push({ propIndex, xNs, yNs, zNs }),
    },
  } as unknown as StepContext;
  const threatOf = (defId: string) => {
    const threat = world.threats.find((candidate) => candidate.defId === defId);
    if (threat === undefined) throw new Error(`no ${defId}`);
    return threat;
  };
  return { sim, world, ctx, events, impulses, threatOf };
}

const withReach = (reachM: number): Feel => ({
  ...content.feel,
  gags: {
    ...content.feel.gags,
    tableObjectFall: { pushImpulseNs, propReachDistM: reachM },
  },
});

/** What each gag does on the threat that owns it: a `Record`, so that a new gag with no row is a type error. */
const OWN_THREAT: Record<GagId, { defId: string; eventCount: number; pushCount: number }> = {
  outlet_hair: { defId: 'outlet', eventCount: 0, pushCount: 0 },
  stairs_slide: { defId: 'stairs', eventCount: 1, pushCount: 0 },
  table_object_fall: { defId: 'coffee_table_object', eventCount: 0, pushCount: 1 },
  // Nothing: the nap is the séquelle of the micro-sleep's def (`applyAfterEffect`, story 3.15).
  papa_asleep: { defId: 'papa_microsleep', eventCount: 0, pushCount: 0 },
  // The surprise mischiefs of the silence: mess only, no near miss (story 1.21 D11).
  tissues_everywhere: { defId: 'silence_mischief', eventCount: 0, pushCount: 0 },
  crayon_scribbles: { defId: 'silence_mischief', eventCount: 0, pushCount: 0 },
  // The pot boiling over (story 9.5): a mischief like the silence's, nothing to push.
  pot_boiled_over: { defId: 'pot_on_stove', eventCount: 0, pushCount: 0 },
  // The cry is the def's `gagCryMs` (story 3.1 D9), not the gag's: nothing else happens (story 4.1).
  arms_wail: { defId: 'arms_cry', eventCount: 0, pushCount: 0 },
  // The retreat is the sequence's (story 4.6): the gag itself does nothing.
  baby_eyes_reopened: { defId: 'bedtime_eyes', eventCount: 0, pushCount: 0 },
  // Same: the retreat is the sequence's and the cry is the def's (story 4.7).
  baby_sat_up: { defId: 'fake_sleep', eventCount: 0, pushCount: 0 },
  // Same: the retreat is the sequence's and the cry is the def's (story 4.8).
  baby_woke_on_drop: { defId: 'bomb_drop_lay', eventCount: 0, pushCount: 0 },
  // Same: the sequence's retreat or failure and the def's cry (story 4.9).
  baby_woke_by_touch: { defId: 'false_alarm_sigh', eventCount: 0, pushCount: 0 },
  baby_woke_crying: { defId: 'real_wake', eventCount: 0, pushCount: 0 },
};

describe('applyGag', () => {
  it('outlet_hair pushes no event and touches no prop', async () => {
    const { world, ctx, events, impulses, threatOf } = await setup();
    applyGag(world, ctx, threatOf('outlet'), 'outlet_hair');
    expect(events).toEqual([]);
    expect(impulses).toEqual([]);
  });

  it('stairs_slide pushes exactly one NearMiss, at the sim time, and touches no prop', async () => {
    const { world, ctx, events, impulses, threatOf } = await setup();
    const threat = threatOf('stairs');
    applyGag(world, ctx, threat, 'stairs_slide');
    expect(events).toEqual([
      { type: 'NearMiss', t: world.time.sim, threatId: threat.id, gag: 'stairs_slide' },
    ]);
    expect(impulses).toEqual([]);
  });

  it.each(GAG_IDS)(
    '%s adds to world.score.nearMisses exactly as many as the NearMiss it pushes (story 1.22)',
    async (gag) => {
      const { defId } = OWN_THREAT[gag];
      const { world, ctx, events, threatOf } = await setup();
      applyGag(world, ctx, threatOf(defId), gag);
      const nearMisses = events.filter((event) => event.type === 'NearMiss').length;
      expect(world.score.nearMisses).toBe(nearMisses);
      expect(world.score.nearMisses).toBe(gag === 'stairs_slide' ? 1 : 0);
      expect(world.score.perfects).toBe(0);
    },
  );

  it.each(GAG_IDS)(
    '%s is a near miss for the end photo exactly when it pushes a NearMiss (story 3.6)',
    async (gag) => {
      const { defId } = OWN_THREAT[gag];
      const { world, ctx, events, threatOf } = await setup();
      applyGag(world, ctx, threatOf(defId), gag);
      expect(isNearMissGag(gag)).toBe(events.some((event) => event.type === 'NearMiss'));
    },
  );

  it.each(GAG_IDS)('%s does what its row says on its own threat', async (gag) => {
    const { defId, eventCount, pushCount } = OWN_THREAT[gag];
    const { world, ctx, events, impulses, threatOf } = await setup();
    applyGag(world, ctx, threatOf(defId), gag);
    expect(events).toHaveLength(eventCount);
    expect(impulses).toHaveLength(pushCount);
  });
});

describe('pot_boiled_over (story 9.5)', () => {
  it('is a mess, not a near miss: one mischief for Mama, no event, nothing pushed', async () => {
    const { world, ctx, events, impulses, threatOf } = await setup();
    applyGag(world, ctx, threatOf('pot_on_stove'), 'pot_boiled_over');
    expect(world.mess.mischiefs).toBe(1);
    expect(world.score.nearMisses).toBe(0);
    expect(isNearMissGag('pot_boiled_over')).toBe(false);
    expect(events).toEqual([]);
    expect(impulses).toEqual([]);
  });

  it('goes with the mess séquelle and the mess catastrophe, and its def says so', async () => {
    expect(CATASTROPHE_OF_GAG.pot_boiled_over).toBe('mess');
    expect(catastropheProblem('pot_on_stove', ['pot_boiled_over'], 'mess')).toBeNull();
    expect(catastropheProblem('pot_on_stove', ['pot_boiled_over'], 'nearMiss')).toMatch(
      /whose catastrophe must be "mess"/,
    );
    const { threatOf } = await setup();
    expect(AFTER_EFFECT_OF_GAG.pot_boiled_over).toBe('mess');
    expect(threatOf('pot_on_stove')).toBeDefined();
  });
});

describe('papa_asleep', () => {
  it('is a gag with nothing to do: the nap belongs to the afterEffect of the micro-sleep', async () => {
    const { world, ctx, events, threatOf } = await setup();
    applyGag(world, ctx, threatOf('papa_microsleep'), 'papa_asleep', createTestMicroSleep());
    expect(world.papa.state).toBe('idle');
    expect(events).toEqual([]);
  });

  it('puts Papa to sleep for the afterEffect busyMs of the micro-sleep, with no near miss and no prop pushed', async () => {
    const { world, ctx, events, impulses } = await setup();
    applyAfterEffect(world, ctx, createTestMicroSleep(), 'papa_asleep');
    expect(world.papa.state).toBe('asleep');
    expect(world.papa.busyUntil).toBe(world.time.sim + testMicroSleepBusyMs());
    expect(events.map((event) => event.type)).toEqual(['PapaStateChanged', 'AfterEffectStarted']);
    expect(events[1]).toEqual({
      type: 'AfterEffectStarted',
      t: world.time.sim,
      kind: 'asleep',
      until: world.papa.busyUntil,
      propId: null,
    });
    expect(impulses).toEqual([]);
  });
});

describe('the surprise mischiefs (story 1.21)', () => {
  it.each(['tissues_everywhere', 'crayon_scribbles'] as const)(
    '%s adds one to mess.mischiefs, once per gag, and emits no NearMiss',
    async (gag) => {
      const { world, ctx, events, impulses, threatOf } = await setup();
      expect(world.mess.mischiefs).toBe(0);
      applyGag(world, ctx, threatOf('silence_mischief'), gag);
      applyGag(world, ctx, threatOf('silence_mischief'), gag);
      expect(world.mess.mischiefs).toBe(2);
      expect(events.some((event) => event.type === 'NearMiss')).toBe(false);
      expect(impulses).toEqual([]);
    },
  );
});

describe('table_object_fall (a scripted port)', () => {
  const mugIndex = 0;
  const vaseIndex = 1;

  it('pushes the mug away from the anchor with the feel impulse, and not the vase', async () => {
    const { world, ctx, events, impulses, threatOf } = await setup();
    expect(world.props.map((prop) => prop.id)).toEqual(['mug_01', 'vase_01']);
    applyGag(world, ctx, threatOf('coffee_table_object'), 'table_object_fall');
    // The mug rests 0.2 m along +x from the anchor: straight along +x, level.
    expect(impulses).toEqual([{ propIndex: mugIndex, xNs: pushImpulseNs, yNs: 0, zNs: 0 }]);
    expect(events).toEqual([]);
  });

  it('skips a broken mug', async () => {
    const { world, ctx, impulses, threatOf } = await setup();
    (world.props[mugIndex] as World['props'][number]).isBroken = true;
    applyGag(world, ctx, threatOf('coffee_table_object'), 'table_object_fall');
    expect(impulses).toEqual([]);
  });

  it('skips a mug that already lies on the floor', async () => {
    const { world, ctx, impulses, threatOf } = await setup();
    (world.props[mugIndex] as World['props'][number]).isOnFloor = true;
    applyGag(world, ctx, threatOf('coffee_table_object'), 'table_object_fall');
    expect(impulses).toEqual([]);
  });

  it('pushes nothing when no off-floor prop is within reach', async () => {
    const { world, ctx, impulses, threatOf } = await setup(withReach(0.1));
    applyGag(world, ctx, threatOf('coffee_table_object'), 'table_object_fall');
    expect(impulses).toEqual([]);
  });

  it('pushes a prop exactly on the anchor along the baby gaze', async () => {
    const { world, ctx, impulses, threatOf } = await setup();
    const threat = threatOf('coffee_table_object');
    const mug = world.props[mugIndex] as World['props'][number];
    mug.xM = threat.xM;
    mug.zM = threat.zM;
    world.baby.gazeX = 0;
    world.baby.gazeZ = 1;
    applyGag(world, ctx, threat, 'table_object_fall');
    expect(impulses).toEqual([{ propIndex: mugIndex, xNs: 0, yNs: 0, zNs: pushImpulseNs }]);
  });

  it('gives a tie to the lower index', async () => {
    const { world, ctx, impulses, threatOf } = await setup();
    const threat = threatOf('coffee_table_object');
    threat.xM = 0;
    threat.zM = 0;
    const mug = world.props[mugIndex] as World['props'][number];
    const vase = world.props[vaseIndex] as World['props'][number];
    mug.xM = -0.25;
    mug.zM = 0;
    vase.xM = 0.25;
    vase.zM = 0;
    vase.isOnFloor = false;
    applyGag(world, ctx, threat, 'table_object_fall');
    expect(impulses).toEqual([{ propIndex: mugIndex, xNs: -pushImpulseNs, yNs: 0, zNs: 0 }]);
  });

  it('prefers the nearer prop over the lower index', async () => {
    const { world, ctx, impulses, threatOf } = await setup();
    const threat = threatOf('coffee_table_object');
    threat.xM = 0;
    threat.zM = 0;
    const mug = world.props[mugIndex] as World['props'][number];
    const vase = world.props[vaseIndex] as World['props'][number];
    mug.xM = 0.4;
    mug.zM = 0;
    vase.xM = 0;
    vase.zM = 0.1;
    vase.isOnFloor = false;
    applyGag(world, ctx, threat, 'table_object_fall');
    expect(impulses).toEqual([{ propIndex: vaseIndex, xNs: 0, yNs: 0, zNs: pushImpulseNs }]);
  });

  it('reaches a prop at exactly propReachDistM', async () => {
    const { world, ctx, impulses, threatOf } = await setup();
    const threat = threatOf('coffee_table_object');
    threat.xM = 0;
    threat.zM = 0;
    (world.props[mugIndex] as World['props'][number]).xM = propReachDistM;
    (world.props[mugIndex] as World['props'][number]).zM = 0;
    applyGag(world, ctx, threat, 'table_object_fall');
    expect(impulses).toHaveLength(1);
  });
});

describe('table_object_fall (real Rapier, through createSim)', () => {
  async function failedTable() {
    const sim = await createSim({
      content,
      geometry: createTestGeometry(),
      level: createTestLevel({ waves: [testWave([COFFEE_TABLE])] }),
      seed: 1,
    });
    const world = sim.world as World;
    const mug = world.props[0] as World['props'][number];
    const vase = world.props[1] as World['props'][number];
    // Step until the step that gags the unanswered threat.
    let gagStepEvents: SimEvent[] = [];
    let before = { xM: mug.xM, zM: mug.zM, vaseXM: vase.xM };
    for (let i = 0; i < 400 && gagStepEvents.length === 0; i++) {
      before = { xM: mug.xM, zM: mug.zM, vaseXM: vase.xM };
      sim.step();
      const events = [...sim.drainEvents()];
      if (events.some((event) => event.type === 'GagTriggered')) gagStepEvents = events;
    }
    // The loop gives up silently: no gag step would otherwise fail on confusing assertions below.
    expect(gagStepEvents.length).toBeGreaterThan(0);
    return { sim, world, mug, vase, gagStepEvents, before };
  }

  it('moves the mug in the gag step: +x, not along z, and the vase stays', async () => {
    const { sim, mug, vase, gagStepEvents, before } = await failedTable();
    expect(gagStepEvents.map((event) => event.type).slice(0, 2)).toEqual([
      'ResponseResolved',
      'GagTriggered',
    ]);
    expect(gagStepEvents.some((event) => event.type === 'NearMiss')).toBe(false);
    // The push is 0.72 N·s on 0.3 kg: centimetres in one step. A resting contact only jitters z by ~1e-6.
    expect(mug.xM - before.xM).toBeGreaterThan(0.01);
    expect(mug.zM).toBeCloseTo(before.zM, 4);
    expect(vase.xM).toBe(before.vaseXM);
    sim.dispose();
  });

  it('drops the mug to the floor within a second of sim', async () => {
    const { sim, mug } = await failedTable();
    stepN(sim, Math.round(MS_PER_S / STEP_MS));
    expect(mug.isOnFloor).toBe(true);
    sim.dispose();
  });
});

describe('CATASTROPHE_OF_GAG (story 3.16)', () => {
  it('has a category for every gag, and the outlet is a nearMiss without being a NearMiss', () => {
    expect(Object.keys(CATASTROPHE_OF_GAG).sort()).toEqual([...GAG_IDS].sort());
    expect(CATASTROPHE_OF_GAG.outlet_hair).toBe('nearMiss');
    expect(isNearMissGag('outlet_hair')).toBe(false);
  });

  it('names the def, the gag and the expected category when a def disagrees', () => {
    expect(catastropheProblem('outlet', ['outlet_hair'], 'nearMiss')).toBeNull();
    expect(catastropheProblem('outlet', ['outlet_hair'], 'mess')).toBe(
      'the threat "outlet" has the gag "outlet_hair", whose catastrophe must be "nearMiss", not "mess"',
    );
  });

  it('checks every gag of a def, and leaves an unknown gag to its own message', () => {
    expect(
      catastropheProblem('silence', ['tissues_everywhere', 'crayon_scribbles'], 'mess'),
    ).toBeNull();
    expect(catastropheProblem('silence', ['tissues_everywhere', 'papa_asleep'], 'mess')).toContain(
      '"papa_asleep"',
    );
    expect(catastropheProblem('x', ['not_a_gag'], 'none')).toBeNull();
  });
});
