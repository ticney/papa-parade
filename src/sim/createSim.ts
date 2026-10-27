import type { ContentBundle } from '@content/contentBundle';
import { cloneJson, hashJson } from '@shared/hash';
import { defaultStrictInvariants, invariant } from '@shared/invariant';
import { computeApplyAt, createCommandQueue } from './commandQueue.ts';
import { commandProblem, type SimCommand } from './commands.ts';
import type { StepContext, System } from './context.ts';
import type { SimEvent } from './events.ts';
import {
  createJournal,
  entryProblem,
  type Journal,
  type JournalEntry,
  journalProblem,
} from './journal.ts';
import { type SimSnapshot, takeSnapshot, worldFromSnapshot } from './snapshot.ts';
import { SYSTEMS, step } from './step.ts';
import { consumeFreeze, createFreezeState, requestFreeze } from './time/hitstop.ts';
import { createWorld, type World } from './world.ts';

export interface CreateSimOptions {
  content: ContentBundle;
  /** An integer in `[0, 2**32)`. */
  seed: number;
  /** Replay mode: pre-loads these entries, with their recorded `applyAt`. Needs the same seed and feel. */
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
  /** The current world (a different object after `restore`). */
  readonly world: Readonly<World>;
  readonly timeScale: number;
  /** Remaining hitstop, in real ms. The client loop consumes it; headless ignores it. */
  readonly freezeRealMs: number;
  consumeFreeze(realMs: number): void;
  snapshot(): SimSnapshot;
  /**
   * Replaces the world with a copy of the snapshot's (refused if it was taken by a sim with
   * another seed or feel), and clears pending commands, events and freeze. The journal restarts
   * from the snapshot time (`startSimMs`) and holds `tail`: the journal entries still to apply,
   * with their recorded `applyAt` (each must be later than the snapshot time). Re-enqueueing them
   * through `enqueue` would recompute `applyAt` and could apply a late command too early.
   */
  restore(snapshot: SimSnapshot, tail?: readonly JournalEntry[]): void;
  /** A deep copy of the journal. */
  journal(): Journal;
}

/** Internal factory: tests inject extra systems here. The public API is {@link createSim}. */
export async function createSimWithSystems(
  options: CreateSimOptions,
  systems: readonly System[],
): Promise<Sim> {
  const { content, seed, journal: source } = options;
  let world = createWorld(seed);
  const feelHash = hashJson(content.feel);
  if (source) {
    const problem = journalProblem(source);
    invariant(problem === null, `invalid journal: ${String(problem)}`);
    invariant(source.seed === seed, 'the journal was recorded with another seed');
    invariant(source.feelHash === feelHash, 'the journal was recorded with another feel');
    invariant(source.startSimMs === 0, 'only a journal recorded from the start can be replayed');
  }

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

  if (source) for (const entry of source.entries) record(entry);

  return {
    enqueue(cmd) {
      const problem = commandProblem(cmd);
      invariant(problem === null, `invalid command: ${String(problem)}`);
      record({ applyAt: computeApplyAt(cmd.t, world.time.sim), command: cmd });
    },
    step() {
      step(world, ctx, systems);
    },
    drainEvents() {
      drained.length = 0;
      for (let i = 0; i < events.length; i++) drained.push(events[i] as SimEvent);
      events.length = 0;
      return drained;
    },
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
      return takeSnapshot(world, seed, feelHash);
    },
    restore(snapshot, tail = []) {
      const restored = worldFromSnapshot(snapshot, seed, feelHash);
      for (const entry of tail) {
        const problem = entryProblem(entry);
        invariant(problem === null, `invalid journal entry: ${String(problem)}`);
        invariant(
          entry.applyAt > restored.time.sim,
          `journal entry at ${entry.applyAt} was already applied at ${restored.time.sim}`,
        );
      }
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
    journal() {
      const copy = createJournal(seed, feelHash, startSimMs);
      copy.entries = cloneJson(entries);
      return copy;
    },
  };
}

export function createSim(options: CreateSimOptions): Promise<Sim> {
  return createSimWithSystems(options, SYSTEMS);
}
