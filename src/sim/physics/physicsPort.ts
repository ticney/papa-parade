/** Where a prop is: its position in metres and its rotation as a unit quaternion. */
export interface PropPose {
  xM: number;
  yM: number;
  zM: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

/**
 * What the sim asks of the physics engine, and nothing of its types (ADR-005): the sim never sees
 * a Rapier body. Props are named by their index in `geometry.props`, which `world.props` shares.
 * The engine lives outside `World`, like the navigation grids, and rides in `SimSnapshot.physics`.
 */
export interface PhysicsPort {
  /** Fixed colliders of the level: furniture and walls from the geometry, the floor and the four bounds walls. */
  readonly fixedColliderCount: number;
  /** Dynamic bodies: one per prop of the geometry. */
  readonly propCount: number;
  /** One engine step of exactly `STEP_MS`, whatever the time scale is. */
  step(): void;
  /** Pushes the prop at its centre of mass and wakes it. */
  applyImpulse(propIndex: number, xNs: number, yNs: number, zNs: number): void;
  isSleeping(propIndex: number): boolean;
  /** Writes the body's pose into `out`. */
  readPose(propIndex: number, out: PropPose): void;
  /**
   * Calls `visit` in prop index order for each prop that took a contact reaching the impact
   * threshold during the last `step`: the largest such impulse (N·s) and the partner of that
   * contact, the other prop's index or -1 for the floor, a wall or furniture. A contact between two
   * props is reported on both sides. Allocates nothing.
   */
  forEachImpact(visit: (propIndex: number, otherIndex: number, impulseNs: number) => void): void;
  /** The whole engine state, to be given back to {@link restore}. */
  snapshot(): Uint8Array;
  /** Replaces the engine state. Throws and leaves the current one untouched if `bytes` do not fit this level. */
  restore(bytes: Uint8Array): void;
  /** Frees the engine (WASM memory is not garbage-collected). Idempotent; any other call then throws. */
  dispose(): void;
}
