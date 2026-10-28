import type { ContentBundle, LevelContent } from '@content/contentBundle';
import type { Feel } from '@content/schemas/feel';
import type { LevelGeometry } from '@content/schemas/levelGeometry';
import { PAPA_TARGET_ANCHOR_ID, PROP_ON_FLOOR_TOLERANCE_M } from '@shared/constants';
import { cloneJson, hashJson } from '@shared/hash';
import { defaultStrictInvariants, invariant } from '@shared/invariant';
import { asSimMs } from '@shared/time';
import { computeApplyAt, createCommandQueue } from './commandQueue.ts';
import { commandProblem, type SimCommand } from './commands.ts';
import type { SimLevel, SimObjectSpec, StepContext, System } from './context.ts';
import { DISRUPTION_HANDLER_KINDS } from './disruptions/disruptionsSystem.ts';
import type { SimEvent } from './events.ts';
import {
  createJournal,
  entryProblem,
  type Journal,
  type JournalEntry,
  journalProblem,
} from './journal.ts';
import { createNavGrid, type NavGrid } from './nav/navGrid.ts';
import { OBJECT_ACTION_KINDS } from './papa/papaSystem.ts';
import { createRapierPhysics } from './physics/rapierPhysics.ts';
import { type SimSnapshot, takeSnapshot, worldFromSnapshot } from './snapshot.ts';
import { SYSTEMS, step } from './step.ts';
import { GAG_IDS, PAPA_ASLEEP_GAG_ID } from './threats/gags.ts';
import { consumeFreeze, createFreezeState, requestFreeze } from './time/hitstop.ts';
import { allocateId, createWorld, type World } from './world.ts';

export interface CreateSimOptions {
  content: ContentBundle;
  /**
   * The level's geometry (fetched per level, not part of `ContentBundle`). A journal or snapshot
   * carries its hash and is refused on another room. Needed because a sim without a room has no Papa.
   */
  geometry: LevelGeometry;
  /**
   * What the level plans: its threats and their defs (`loadLevelContent`). A journal or snapshot
   * carries its hash and is refused on another level, because the planned threats are part of what
   * a replay needs. A level that plans nothing is fine.
   */
  level: LevelContent;
  /** An integer in `[0, 2**32)`. */
  seed: number;
  /** Replay mode: pre-loads these entries, with their recorded `applyAt`. Needs the same seed, feel and geometry. */
  journal?: Journal;
  /** Throw on an invariant violation (default: yes, except in a `vite build`). */
  strictInvariants?: boolean;
}

export interface Sim {
  /** Deep-copies `cmd`, computes its `applyAt`, records it in the journal. */
  enqueue(cmd: SimCommand): void;
  /** Exactly one `STEP_MS` of sim time. Never refuses to run because of a freeze. */
  step(): void;
  /**
   * The events pushed since the last drain. The returned array is reused: it is valid until the
   * next call, copy what you keep. Nothing drains automatically.
   */
  drainEvents(): readonly SimEvent[];
  /** The level's interactive objects (constant): the client projects them for its touch hit test. */
  readonly objects: readonly SimObjectSpec[];
  /** The current world (a different object after `restore`). */
  readonly world: Readonly<World>;
  readonly timeScale: number;
  /** Remaining hitstop, in real ms. The client loop consumes it; headless ignores it. */
  readonly freezeRealMs: number;
  consumeFreeze(realMs: number): void;
  snapshot(): SimSnapshot;
  /**
   * Replaces the world with a copy of the snapshot's and the physics world with the snapshot's
   * Rapier state (refused if it was taken by a sim with another seed, feel, geometry or level, or
   * if either half is damaged: everything is checked first, a refused snapshot changes nothing),
   * and clears pending commands, events and freeze. The journal restarts
   * from the snapshot time (`startSimMs`) and holds `tail`: the journal entries still to apply,
   * with their recorded `applyAt` (each must be later than the snapshot time). Re-enqueueing them
   * through `enqueue` would recompute `applyAt` and could apply a late command too early.
   */
  restore(snapshot: SimSnapshot, tail?: readonly JournalEntry[]): void;
  /** A deep copy of the journal. */
  journal(): Journal;
  /**
   * Frees the physics world (WASM memory is not garbage-collected): call it when the sim is
   * dropped, a restart, a level change, the end of a run in a CLI. Idempotent. A `step`,
   * `snapshot` or `restore` after it fails an invariant. The sim returned by `replayJournal` is
   * the caller's to dispose.
   */
  dispose(): void;
}

/**
 * Where an agent starts: the `anchorId` anchor, moved to the centre of the nearest open cell of its
 * grid if its clearance closes it. A level where it has nowhere to stand is a broken level.
 */
function spawnOf(
  geometry: LevelGeometry,
  grid: NavGrid,
  anchorId: string,
  who: string,
): { xM: number; zM: number } {
  const anchor = geometry.anchors.find((candidate) => candidate.id === anchorId);
  invariant(anchor !== undefined, `level ${geometry.id} has no ${anchorId} anchor`);
  const xM = anchor.positionM[0];
  const zM = anchor.positionM[2];
  if (grid.isOpenAt(xM, zM)) return { xM, zM };
  const cell = grid.nearestOpenCell(xM, zM, -1);
  invariant(cell >= 0, `level ${geometry.id} has no cell where ${who} can stand`);
  return { xM: grid.centerXM(cell), zM: grid.centerZM(cell) };
}

/** One threat entry of a wave, flattened: where it sits in the level file (for the messages) and what it names. */
interface PlannedEntry {
  readonly where: string;
  readonly def: string;
  readonly anchor: string;
  readonly waveIndex: number;
}

function plannedEntriesOf(level: LevelContent): PlannedEntry[] {
  return level.level.waves.flatMap((wave, w) =>
    wave.threats.map((entry, i) => ({
      where: `level ${level.level.id} › waves[${w}].threats[${i}]`,
      def: entry.def,
      anchor: entry.anchor,
      waveIndex: w,
    })),
  );
}

/** One disruption entry of a wave, flattened: where it sits in the level file (for the messages) and what it names. */
interface PlannedDisruptionEntry {
  readonly where: string;
  readonly def: string;
  readonly object: string;
  readonly atMs: number;
  readonly waveIndex: number;
}

function plannedDisruptionsOf(level: LevelContent): PlannedDisruptionEntry[] {
  return level.level.waves.flatMap((wave, w) =>
    wave.disruptions.map((entry, i) => ({
      where: `level ${level.level.id} › waves[${w}].disruptions[${i}]`,
      def: entry.def,
      object: entry.object,
      atMs: entry.atMs,
      waveIndex: w,
    })),
  );
}

/**
 * What the level plans, checked against the room: it is the level of this geometry, every planned
 * def is loaded, every anchor exists (an object's too, and object ids are unique), no anchor is
 * planned twice and every gag is one the sim knows. Every planned disruption has its def loaded, rings
 * at an object of the level, of the same kind, and an object is planned once (story 1.20). A level that breaks one is a
 * broken level (`content:check` catches it statically). One instance per planned anchor, in order
 * of first appearance across the waves.
 */
function simLevelOf(
  level: LevelContent,
  geometry: LevelGeometry,
  physics: Feel['physics'],
): SimLevel {
  invariant(
    level.level.id === geometry.id,
    `level ${level.level.id} was given the geometry of ${geometry.id}`,
  );
  invariant(
    !geometry.anchors.some((anchor) => anchor.id === PAPA_TARGET_ANCHOR_ID),
    `level ${level.level.id}: the geometry has an anchor named "${PAPA_TARGET_ANCHOR_ID}", which the sim reserves for the threat that stands on Papa`,
  );
  const planned = plannedEntriesOf(level);
  const waves = level.level.waves;
  const microSleepDef = level.level.gauges.fatigue?.microSleepDef;
  const threats: SimLevel['threats'][number][] = planned.map((entry, index) => {
    const def = Object.hasOwn(level.threats, entry.def) ? level.threats[entry.def] : undefined;
    invariant(def !== undefined, `${entry.where}: the threat ${entry.def} is not loaded`);
    invariant(
      geometry.anchors.some((anchor) => anchor.id === entry.anchor),
      `${entry.where}: threat ${entry.def} is planned at ${entry.anchor}, which ${geometry.id} does not have`,
    );
    // The wording of these is the one `content:check` and the schema use.
    invariant(
      (GAG_IDS as readonly string[]).includes(def.gag),
      `${entry.where}: the threat "${entry.def}" has the gag "${def.gag}", which the sim does not know (${GAG_IDS.join(', ')})`,
    );
    invariant(
      def.target !== 'papa',
      `${entry.where}: the threat "${entry.def}" has target "papa": only the sim spawns it (gauges.fatigue.microSleepDef), a wave cannot plan it`,
    );
    invariant(
      def.gag !== PAPA_ASLEEP_GAG_ID,
      `${entry.where}: the threat "${entry.def}" has the gag "${PAPA_ASLEEP_GAG_ID}": only the micro-sleep (target "papa") may end in it`,
    );
    const first = planned.findIndex((other) => other.anchor === entry.anchor);
    invariant(
      first === index,
      `${entry.where}: the anchor "${entry.anchor}" is already planned by ${(planned[first] as { where: string }).where}`,
    );
    return { def, anchorId: entry.anchor, firstWaveIndex: entry.waveIndex };
  });
  if (microSleepDef !== undefined) {
    const where = `level ${level.level.id} › gauges.fatigue.microSleepDef`;
    const def = Object.hasOwn(level.threats, microSleepDef)
      ? level.threats[microSleepDef]
      : undefined;
    invariant(def !== undefined, `${where}: the threat ${microSleepDef} is not loaded`);
    invariant(
      def.target === 'papa',
      `${where}: the threat "${microSleepDef}" has target "${def.target}", but a micro-sleep must have target "papa"`,
    );
    invariant(
      (GAG_IDS as readonly string[]).includes(def.gag),
      `${where}: the threat "${microSleepDef}" has the gag "${def.gag}", which the sim does not know (${GAG_IDS.join(', ')})`,
    );
    invariant(
      def.gag === PAPA_ASLEEP_GAG_ID,
      `${where}: the threat "${microSleepDef}" has the gag "${def.gag}", but a micro-sleep must have the gag "${PAPA_ASLEEP_GAG_ID}"`,
    );
    threats.push({ def, anchorId: PAPA_TARGET_ANCHOR_ID, firstWaveIndex: -1 });
  }
  const disruptions: SimLevel['disruptions'][number][] = [];
  for (const entry of plannedDisruptionsOf(level)) {
    // The wording of these is the one `content:check` and the schema use.
    const def = Object.hasOwn(level.disruptions, entry.def)
      ? level.disruptions[entry.def]
      : undefined;
    invariant(def !== undefined, `${entry.where}: the disruption ${entry.def} is not loaded`);
    const object = level.level.objects.find((candidate) => candidate.id === entry.object);
    invariant(
      object !== undefined,
      `${entry.where}: the object "${entry.object}" is not in the level objects`,
    );
    invariant(
      def.kind === object.kind,
      `${entry.where}: the disruption "${entry.def}" has the kind "${def.kind}", but the object "${entry.object}" has the kind "${object.kind}"`,
    );
    invariant(
      (DISRUPTION_HANDLER_KINDS as readonly string[]).includes(def.kind),
      `${entry.where}: the disruption "${entry.def}" has the kind "${def.kind}", which the sim does not know (${DISRUPTION_HANDLER_KINDS.join(', ')})`,
    );
    // A level built without the schema (a test, a tool) must not slip a start time that never comes or comes at once.
    const wave = waves[entry.waveIndex] as (typeof waves)[number];
    const waveEndMs = waves[entry.waveIndex + 1]?.fromMs ?? level.level.durationMs;
    invariant(
      Number.isFinite(entry.atMs) && entry.atMs >= wave.fromMs && entry.atMs < waveEndMs,
      `${entry.where}: atMs (${entry.atMs}) must be inside its wave, from ${wave.fromMs} up to ${waveEndMs} ms`,
    );
    const earlier = disruptions.find((other) => other.objectId === entry.object);
    invariant(
      earlier === undefined,
      `${entry.where}: the object "${entry.object}" is already planned by another disruption`,
    );
    disruptions.push({ def, objectId: entry.object, atMs: entry.atMs, waveIndex: entry.waveIndex });
  }
  return {
    microSleepIndex: microSleepDef === undefined ? -1 : threats.length - 1,
    durationMs: level.level.durationMs,
    waves: waves.map((wave, w) => {
      const endMs = waves[w + 1]?.fromMs ?? level.level.durationMs;
      return {
        fromMs: wave.fromMs,
        endMs,
        closesAtMs: endMs - wave.lullMs,
        maxSimultaneous: wave.maxSimultaneous,
        gapMinMs: wave.gapMinMs,
        gapMaxMs: wave.gapMaxMs,
      };
    }),
    threats,
    disruptions,
    objects: level.level.objects.map((object, index) => {
      const where = `level ${level.level.id} › objects[${index}]`;
      invariant(
        level.level.objects.findIndex((other) => other.id === object.id) === index,
        `${where}: the object "${object.id}" is listed twice`,
      );
      const anchor = geometry.anchors.find((candidate) => candidate.id === object.anchor);
      invariant(
        anchor !== undefined,
        `${where}: the object "${object.id}" is at ${object.anchor}, which ${geometry.id} does not have`,
      );
      invariant(
        (OBJECT_ACTION_KINDS as readonly string[]).includes(object.kind),
        `${where}: the object "${object.id}" has the kind "${object.kind}", which the sim has no action for (${OBJECT_ACTION_KINDS.join(', ')})`,
      );
      return {
        id: object.id,
        kind: object.kind,
        xM: anchor.positionM[0],
        zM: anchor.positionM[2],
        yM: anchor.positionM[1],
      };
    }),
    props: geometry.props.map((prop, index) => {
      const kind = Object.hasOwn(physics.kinds, prop.kind) ? physics.kinds[prop.kind] : undefined;
      invariant(
        kind !== undefined,
        `level ${geometry.id}: props[${index}].kind "${prop.kind}" has no feel.physics.kinds entry`,
      );
      return {
        id: prop.id,
        kind: prop.kind,
        halfExtentsM: prop.halfExtentsM,
        spawnedAboveFloor: prop.centerM[1] - prop.halfExtentsM[1] > PROP_ON_FLOOR_TOLERANCE_M,
        physics: kind,
      };
    }),
  };
}

/**
 * Every planned threat anchor must be somewhere the baby can crawl to from where it starts: its
 * nearest open cell has to be in the region of the baby's spawn cell (a threat the baby can never
 * reach would lock it up for ever). `content:check` builds no nav grid, so this is the sim's check.
 */
function checkReachable(
  level: LevelContent,
  geometry: LevelGeometry,
  grid: NavGrid,
  baby: { xM: number; zM: number },
): void {
  const spawnCell = grid.cellAt(baby.xM, baby.zM);
  const spawnRegion = spawnCell >= 0 ? grid.region[spawnCell] : -1;
  for (const entry of plannedEntriesOf(level)) {
    const anchor = geometry.anchors.find((candidate) => candidate.id === entry.anchor);
    if (anchor === undefined) continue; // `simLevelOf` has refused it
    invariant(
      spawnCell >= 0,
      `${entry.where}: the baby's spawn point is outside the navigation grid, so threat ${entry.def} at ${entry.anchor} cannot be checked for reach`,
    );
    const cell = grid.nearestOpenCell(anchor.positionM[0], anchor.positionM[2], -1);
    invariant(
      cell >= 0 && grid.region[cell] === spawnRegion,
      `${entry.where}: threat ${entry.def} is planned at ${entry.anchor}, which the baby cannot reach from where it starts`,
    );
  }
}

/** Internal factory: tests inject extra systems here. The public API is {@link createSim}. */
export async function createSimWithSystems(
  options: CreateSimOptions,
  systems: readonly System[],
): Promise<Sim> {
  const { content, geometry, level, seed, journal: source } = options;
  const feelHash = hashJson(content.feel);
  const geometryHash = hashJson(geometry);
  const levelHash = hashJson(level);
  const simLevel = simLevelOf(level, geometry, content.feel.physics);
  const papaGrid = createNavGrid(geometry, content.feel.movement.papaRadiusM);
  const babyGrid = createNavGrid(geometry, content.feel.baby.bodyRadiusM);
  let world = createWorld({
    seed,
    papaSpawn: spawnOf(geometry, papaGrid, 'papa_spawn', 'Papa'),
    babySpawn: spawnOf(geometry, babyGrid, 'baby_spawn', 'the baby'),
    firstWanderAt: asSimMs(content.feel.baby.babbleMinMs),
    // A level with no fatigue gauge does not carry the feel's start value around in its world.
    fatiguePoints: simLevel.microSleepIndex < 0 ? 0 : content.feel.fatigue.startPoints,
    props: geometry.props,
  });
  checkReachable(level, geometry, babyGrid, world.baby);
  simLevel.threats.forEach((planned) => {
    // The micro-sleep stands on Papa; every other threat on its anchor.
    const anchor =
      planned.def.target === 'papa'
        ? { positionM: [world.papa.xM, 0, world.papa.zM] }
        : geometry.anchors.find((candidate) => candidate.id === planned.anchorId);
    invariant(anchor !== undefined, 'a planned threat has an anchor');
    world.threats.push({
      id: allocateId(world),
      defId: planned.def.id,
      anchorId: planned.anchorId,
      xM: anchor.positionM[0],
      zM: anchor.positionM[2],
      state: 'idle',
      enteredAt: asSimMs(0),
      windowOpenAt: asSimMs(0),
      responseWindow: null,
      press: null,
      waveIndex: -1,
    });
  });
  simLevel.disruptions.forEach(() => {
    world.disruptions.push({
      state: 'pending',
      enteredAt: asSimMs(0),
      untilAt: asSimMs(0),
      nextRingingAt: asSimMs(0),
    });
  });
  if (source) {
    const problem = journalProblem(source);
    invariant(problem === null, `invalid journal: ${String(problem)}`);
    invariant(source.seed === seed, 'the journal was recorded with another seed');
    invariant(source.feelHash === feelHash, 'the journal was recorded with another feel');
    invariant(
      source.geometryHash === geometryHash,
      'the journal was recorded with another level geometry',
    );
    invariant(source.levelHash === levelHash, 'the journal was recorded with another level');
    invariant(source.startSimMs === 0, 'only a journal recorded from the start can be replayed');
  }

  // Last, so that a refused level or journal above never leaves a physics world behind.
  const physics = await createRapierPhysics({ geometry, physics: content.feel.physics });
  let isDisposed = false;
  const queue = createCommandQueue();
  const freeze = createFreezeState();
  const entries: JournalEntry[] = [];
  let startSimMs = 0;
  const events: SimEvent[] = [];
  const drained: SimEvent[] = [];

  const ctx: StepContext = {
    feel: content.feel,
    events,
    queue,
    commands: [],
    nav: { papa: papaGrid, baby: babyGrid },
    level: simLevel,
    physics,
    strictInvariants: options.strictInvariants ?? defaultStrictInvariants(),
    get t() {
      return world.time.sim;
    },
    requestFreezeRealMs(ms) {
      requestFreeze(freeze, ctx, ms);
    },
  };

  // The journal and the queue never share an object: a system that mutates a command handed to
  // it must not rewrite the recorded history.
  const record = (entry: JournalEntry): void => {
    entries.push(cloneJson(entry));
    queue.push(cloneJson(entry));
  };

  try {
    if (source) for (const entry of source.entries) record(entry);
  } catch (cause) {
    physics.dispose();
    throw cause;
  }

  return {
    enqueue(cmd) {
      const problem = commandProblem(cmd);
      invariant(problem === null, `invalid command: ${String(problem)}`);
      record({ applyAt: computeApplyAt(cmd.t, world.time.sim), command: cmd });
    },
    step() {
      invariant(!isDisposed, 'the sim was disposed');
      step(world, ctx, systems);
    },
    drainEvents() {
      drained.length = 0;
      for (let i = 0; i < events.length; i++) drained.push(events[i] as SimEvent);
      events.length = 0;
      return drained;
    },
    objects: simLevel.objects,
    get world() {
      return world;
    },
    get timeScale() {
      return world.time.scale;
    },
    get freezeRealMs() {
      return freeze.remainingMs;
    },
    consumeFreeze(realMs) {
      consumeFreeze(freeze, realMs);
    },
    snapshot() {
      invariant(!isDisposed, 'the sim was disposed');
      return takeSnapshot(world, seed, feelHash, geometryHash, levelHash, physics.snapshot());
    },
    restore(snapshot, tail = []) {
      invariant(!isDisposed, 'the sim was disposed');
      // Everything is checked before anything changes: a refused snapshot leaves the sim untouched.
      const { world: restored, physics: physicsBytes } = worldFromSnapshot(
        snapshot,
        seed,
        feelHash,
        geometryHash,
        levelHash,
        ctx.level,
      );
      for (const entry of tail) {
        const problem = entryProblem(entry);
        invariant(problem === null, `invalid journal entry: ${String(problem)}`);
        invariant(
          entry.applyAt > restored.time.sim,
          `journal entry at ${entry.applyAt} was already applied at ${restored.time.sim}`,
        );
      }
      physics.restore(physicsBytes);
      world = restored;
      queue.clear();
      ctx.commands.length = 0;
      events.length = 0;
      drained.length = 0;
      freeze.remainingMs = 0;
      entries.length = 0;
      startSimMs = restored.time.sim;
      for (const entry of tail) record(entry);
    },
    dispose() {
      isDisposed = true;
      physics.dispose();
    },
    journal() {
      const copy = createJournal(seed, feelHash, geometryHash, levelHash, startSimMs);
      copy.entries = cloneJson(entries);
      return copy;
    },
  };
}

export function createSim(options: CreateSimOptions): Promise<Sim> {
  return createSimWithSystems(options, SYSTEMS);
}
