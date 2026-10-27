import type { Feel } from '@content/schemas/feel';
import type { LevelGeometry } from '@content/schemas/levelGeometry';
import {
  MS_PER_S,
  PHYSICS_BOUNDS_WALL_THICKNESS_M,
  PHYSICS_FLOOR_THICKNESS_M,
  STEP_MS,
} from '@shared/constants';
import { invariant } from '@shared/invariant';
import type { PhysicsPort, PropPose } from './physicsPort.ts';

/** The Rapier module, once loaded. Nothing outside this file names one of its types. */
type RapierModule = typeof import('@dimforge/rapier3d-deterministic-compat');
type RapierWorld = InstanceType<RapierModule['World']>;
type RapierEventQueue = InstanceType<RapierModule['EventQueue']>;
type RapierBody = ReturnType<RapierWorld['getRigidBody']>;

/**
 * Runs `load` once and hands the same promise to every caller. A failure (a chunk fetch that
 * dropped on a flaky network) is not remembered: the next call tries again, so a « retry » works.
 */
export function memoizeLoader<T>(load: () => Promise<T>): () => Promise<T> {
  let loading: Promise<T> | null = null;
  return () => {
    if (loading === null) {
      loading = load().catch((cause: unknown) => {
        loading = null;
        throw cause;
      });
    }
    return loading;
  };
}

/**
 * Loads Rapier and initialises its WASM, once per process (Node, chromium, webkit): every call
 * returns the same promise. A dynamic `import()`, so that Vite puts the module (the WASM is inlined
 * in it) in a chunk of its own, fetched during the loading screen.
 */
export const initRapier = memoizeLoader(async (): Promise<RapierModule> => {
  const rapier = await import('@dimforge/rapier3d-deterministic-compat');
  await rapier.init();
  return rapier;
});

export interface RapierPhysicsOptions {
  /** The room: its colliders, its bounds and the props' start poses and sizes. */
  geometry: LevelGeometry;
  /** The feel's physics section: gravity, the impact threshold and the kinds, read once here. */
  physics: Feel['physics'];
}

const STEP_S = STEP_MS / MS_PER_S;

/**
 * The physics of one level in Rapier (the deterministic build, `rapier3d-deterministic-compat`):
 * the geometry's boxes, a floor, a ceiling and the bounds' walls are fixed; each prop is a dynamic body whose
 * shape, mass, friction and restitution come from its kind. The timestep is exactly one sim step.
 * Contact-force events above the impact threshold are what `forEachImpact` reports.
 */
export async function createRapierPhysics(options: RapierPhysicsOptions): Promise<PhysicsPort> {
  const rapier = await initRapier();
  const { geometry, physics } = options;
  const impulseThresholdNs = physics.impactMinImpulseNs;
  const [minX, , minZ] = geometry.boundsMinM;
  const [maxX, maxY, maxZ] = geometry.boundsMaxM;
  invariant(maxY > 0, `level ${geometry.id}: the bounds must reach above the floor`);

  // Every refusal comes before the first WASM allocation, so that a refused level leaks nothing.
  const kinds = geometry.props.map((prop, index) => {
    const kind = Object.hasOwn(physics.kinds, prop.kind) ? physics.kinds[prop.kind] : undefined;
    invariant(
      kind !== undefined,
      `level ${geometry.id}: props[${index}].kind "${prop.kind}" has no feel.physics.kinds entry`,
    );
    return kind;
  });

  let world = new rapier.World({ x: 0, y: -physics.gravityMps2, z: 0 });
  world.timestep = STEP_S;
  const queue: RapierEventQueue = new rapier.EventQueue(true);
  let isDisposed = false;

  // Fixed colliders, with no body: furniture, then the floor, the four walls of the bounds and the ceiling.
  let fixedColliderCount = 0;
  const fixed = (hx: number, hy: number, hz: number, x: number, y: number, z: number): void => {
    world.createCollider(rapier.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z));
    fixedColliderCount++;
  };
  for (const collider of geometry.colliders) {
    const [hx, hy, hz] = collider.halfExtentsM;
    const [x, y, z] = collider.centerM;
    fixed(hx, hy, hz, x, y, z);
  }
  const wallM = PHYSICS_BOUNDS_WALL_THICKNESS_M;
  const halfWidthM = (maxX - minX) / 2;
  const halfDepthM = (maxZ - minZ) / 2;
  const centerXM = (minX + maxX) / 2;
  const centerZM = (minZ + maxZ) / 2;
  const halfHeightM = maxY / 2;
  // The floor: its top is y = 0, and it extends under the walls.
  fixed(
    halfWidthM + wallM,
    PHYSICS_FLOOR_THICKNESS_M / 2,
    halfDepthM + wallM,
    centerXM,
    -PHYSICS_FLOOR_THICKNESS_M / 2,
    centerZM,
  );
  fixed(wallM / 2, halfHeightM, halfDepthM + wallM, minX - wallM / 2, halfHeightM, centerZM);
  fixed(wallM / 2, halfHeightM, halfDepthM + wallM, maxX + wallM / 2, halfHeightM, centerZM);
  fixed(halfWidthM, halfHeightM, wallM / 2, centerXM, halfHeightM, minZ - wallM / 2);
  fixed(halfWidthM, halfHeightM, wallM / 2, centerXM, halfHeightM, maxZ + wallM / 2);
  // The ceiling closes the room at the bounds' top: a push cannot send a prop over the walls.
  fixed(halfWidthM + wallM, wallM / 2, halfDepthM + wallM, centerXM, maxY + wallM / 2, centerZM);

  // Props: one dynamic body each, in the geometry's order. Rapier filters the contacts by force:
  // an impulse under the threshold is a prop settling and never reaches us.
  const propCount = geometry.props.length;
  const forceThresholdN = impulseThresholdNs / STEP_S;
  const bodyHandles: number[] = [];
  /** Collider handle -> prop index. Handles survive a Rapier snapshot, so this stays valid after `restore`. */
  const propOfCollider = new Map<number, number>();
  geometry.props.forEach((prop, index) => {
    const kind = kinds[index] as Feel['physics']['kinds'][string];
    const [hx, hy, hz] = prop.halfExtentsM;
    const [x, y, z] = prop.centerM;
    const body = world.createRigidBody(rapier.RigidBodyDesc.dynamic().setTranslation(x, y, z));
    let shape: InstanceType<RapierModule['ColliderDesc']>;
    if (kind.shape === 'box') shape = rapier.ColliderDesc.cuboid(hx, hy, hz);
    else if (kind.shape === 'cylinder') shape = rapier.ColliderDesc.cylinder(hy, Math.max(hx, hz));
    else shape = rapier.ColliderDesc.ball(Math.min(hx, hy, hz));
    const collider = world.createCollider(
      shape
        .setMass(kind.massKg)
        .setFriction(kind.friction)
        .setRestitution(kind.restitution)
        .setActiveEvents(rapier.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(forceThresholdN),
      body,
    );
    bodyHandles.push(body.handle);
    propOfCollider.set(collider.handle, index);
  });

  // The largest impulse each prop took this step and who it came from; reused, never reallocated.
  const bestImpulseNs = new Float64Array(propCount);
  const bestOther = new Int32Array(propCount).fill(-1);
  const note = (propIndex: number, otherIndex: number, impulseNs: number): void => {
    const best = bestImpulseNs[propIndex] as number;
    // On a tie the lower partner index wins, so the result never depends on Rapier's drain order.
    if (impulseNs > best || (impulseNs === best && otherIndex < (bestOther[propIndex] as number))) {
      bestImpulseNs[propIndex] = impulseNs;
      bestOther[propIndex] = otherIndex;
    }
  };
  const onForce = (event: {
    collider1(): number;
    collider2(): number;
    totalForceMagnitude(): number;
  }): void => {
    const impulseNs = event.totalForceMagnitude() * STEP_S;
    const a = propOfCollider.get(event.collider1()) ?? -1;
    const b = propOfCollider.get(event.collider2()) ?? -1;
    if (a >= 0) note(a, b, impulseNs);
    if (b >= 0) note(b, a, impulseNs);
  };

  const bodyOf = (propIndex: number): RapierBody => {
    invariant(!isDisposed, 'the physics world was disposed');
    invariant(
      Number.isInteger(propIndex) && propIndex >= 0 && propIndex < propCount,
      `no prop at index ${propIndex}`,
    );
    return world.getRigidBody(bodyHandles[propIndex] as number);
  };
  const impulse = { x: 0, y: 0, z: 0 };

  return {
    fixedColliderCount,
    propCount,
    step() {
      invariant(!isDisposed, 'the physics world was disposed');
      bestImpulseNs.fill(0);
      bestOther.fill(-1);
      world.step(queue);
      queue.drainContactForceEvents(onForce);
    },
    applyImpulse(propIndex, xNs, yNs, zNs) {
      impulse.x = xNs;
      impulse.y = yNs;
      impulse.z = zNs;
      bodyOf(propIndex).applyImpulse(impulse, true);
    },
    isSleeping(propIndex) {
      return bodyOf(propIndex).isSleeping();
    },
    readPose(propIndex, out: PropPose) {
      const body = bodyOf(propIndex);
      // Rapier's getters allocate a small object: the caller reads awake bodies only.
      const position = body.translation();
      const rotation = body.rotation();
      out.xM = position.x;
      out.yM = position.y;
      out.zM = position.z;
      out.qx = rotation.x;
      out.qy = rotation.y;
      out.qz = rotation.z;
      out.qw = rotation.w;
    },
    forEachImpact(visit) {
      invariant(!isDisposed, 'the physics world was disposed');
      for (let i = 0; i < propCount; i++) {
        const impulseNs = bestImpulseNs[i] as number;
        if (impulseNs > 0) visit(i, bestOther[i] as number, impulseNs);
      }
    },
    snapshot() {
      invariant(!isDisposed, 'the physics world was disposed');
      return world.takeSnapshot();
    },
    restore(bytes) {
      invariant(!isDisposed, 'the physics world was disposed');
      invariant(bytes instanceof Uint8Array && bytes.length > 0, 'the physics snapshot is empty');
      const restored = rapier.World.restoreSnapshot(bytes);
      const fits =
        restored !== undefined &&
        restored.bodies.len() === propCount &&
        restored.colliders.len() === fixedColliderCount + propCount &&
        bodyHandles.every((handle) => restored.bodies.contains(handle));
      if (!fits) {
        restored?.free();
        invariant(false, 'the physics snapshot does not fit this level');
      }
      world.free();
      world = restored;
      bestImpulseNs.fill(0);
      bestOther.fill(-1);
    },
    dispose() {
      if (isDisposed) return;
      isDisposed = true;
      queue.free();
      world.free();
    },
  };
}
