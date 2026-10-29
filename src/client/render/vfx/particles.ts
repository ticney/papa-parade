import { PARTICLE_GRAVITY_MPS2, PARTICLE_POOL_SIZE } from '@shared/constants';
import {
  BoxGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { PALETTE } from '../materials/palette.ts';

// Art constants of the provisional particles (E7 swaps the geometry and anchors on the real
// response point), named with their units.
/** A burst starts this high above the anchor's floor point, in metres. */
const PARTICLE_ORIGIN_LIFT_M = 0.25;
/** Every third spark is ink, so that the sparks read on a pale floor as well as on a dark one. */
const INK_EVERY = 3;
/** The golden angle, in radians: successive directions never line up, whatever the count. */
const GOLDEN_ANGLE_RAD = Math.PI * (3 - Math.sqrt(5));
/** A puff drifts sideways rather than up: its vertical speed is this share of a spark's. */
const PUFF_RISE_RATIO = 0.25;
/** A puff is at its largest, twice its size, at this share of its life. */
const PUFF_PEAK_AT = 0.5;
const PUFF_PEAK_SCALE = 2;
const MS_PER_S = 1000;

export type ParticleStyle = 'spark' | 'puff';

export interface Particles {
  /**
   * A burst of `count` particles from the floor point (`xM`, `zM`) lifted by a fixed height, from
   * `startAtReal` (real ms). Directions are a golden-angle spiral over the upper hemisphere (no
   * random number: the same burst looks the same twice). It takes the free slots, then the oldest
   * particles, so a new burst never loses to a stale one.
   */
  burst(
    style: ParticleStyle,
    count: number,
    speedMps: number,
    lifeMs: number,
    sizeM: number,
    xM: number,
    zM: number,
    startAtReal: number,
  ): void;
  /** Moves every live particle for `nowReal` (real ms). Allocates nothing; writes nothing when idle. */
  update(nowReal: number): void;
  /** Particles drawn or waiting to start as of the last `update` (the debug `fx()` reads it). */
  readonly aliveCount: number;
  /** Hides every particle at once: the level is over and the loop no longer runs to finish them. */
  reset(): void;
  /** Frees the geometry and the material. */
  dispose(): void;
}

// Scratch objects, shared by every call: `update` allocates nothing.
const scratchMatrix = new Matrix4();
const scratchPosition = new Vector3();
const scratchScale = new Vector3();
const scratchQuaternion = new Quaternion();
const scratchColor = new Color();

/**
 * The pooled particles of a level: one `InstancedMesh` of `PARTICLE_POOL_SIZE` small boxes (« même
 * avec des cubes »), so every burst costs one draw call. They run on the real time the scene
 * passes to `update`, so they play during the hitstop, when the sim clock stands still.
 */
export function createParticles(parent: Object3D): Particles {
  const geometry = new BoxGeometry(1, 1, 1);
  // White: the colour of each instance is what shows (the material colour multiplies it).
  const material = new MeshBasicMaterial();
  const mesh = new InstancedMesh(geometry, material, PARTICLE_POOL_SIZE);
  mesh.name = 'particles';
  // The instanced bounds are computed once: they would cull particles that move out of them.
  mesh.frustumCulled = false;
  mesh.count = 0;
  scratchColor.setHex(PALETTE.paper);
  for (let i = 0; i < PARTICLE_POOL_SIZE; i++) mesh.setColorAt(i, scratchColor);
  parent.add(mesh);

  const n = PARTICLE_POOL_SIZE;
  const isAlive = new Uint8Array(n);
  const isPuff = new Uint8Array(n);
  const startAtReal = new Float64Array(n);
  const lifeMs = new Float64Array(n);
  const sizeM = new Float32Array(n);
  const x0 = new Float32Array(n);
  const y0 = new Float32Array(n);
  const z0 = new Float32Array(n);
  const vx = new Float32Array(n);
  const vy = new Float32Array(n);
  const vz = new Float32Array(n);
  let span = 0;
  let aliveCount = 0;
  let isDirty = false;

  const hide = (i: number) => {
    scratchMatrix.makeScale(0, 0, 0);
    mesh.setMatrixAt(i, scratchMatrix);
  };
  const slotFor = (): number => {
    let oldest = 0;
    for (let i = 0; i < n; i++) {
      if (isAlive[i] === 0) return i;
      if ((startAtReal[i] as number) < (startAtReal[oldest] as number)) oldest = i;
    }
    return oldest;
  };
  for (let i = 0; i < n; i++) hide(i);

  return {
    burst(style, count, speedMps, life, size, xM, zM, at) {
      const puff = style === 'puff';
      for (let k = 0; k < count; k++) {
        const i = slotFor();
        // Upper hemisphere: the height runs from the pole down to the horizon as k grows.
        const up = 1 - (k + 0.5) / count;
        const around = Math.sqrt(1 - up * up);
        const angle = k * GOLDEN_ANGLE_RAD;
        isAlive[i] = 1;
        isPuff[i] = puff ? 1 : 0;
        startAtReal[i] = at;
        lifeMs[i] = life;
        sizeM[i] = size;
        x0[i] = xM;
        y0[i] = PARTICLE_ORIGIN_LIFT_M;
        z0[i] = zM;
        vx[i] = Math.cos(angle) * around * speedMps;
        vy[i] = up * speedMps * (puff ? PUFF_RISE_RATIO : 1);
        vz[i] = Math.sin(angle) * around * speedMps;
        scratchColor.setHex(
          puff ? PALETTE.cream : k % INK_EVERY === 2 ? PALETTE.ink : PALETTE.paper,
        );
        mesh.setColorAt(i, scratchColor);
        if (i >= span) span = i + 1;
      }
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
      isDirty = true;
    },
    update(nowReal) {
      if (aliveCount === 0 && !isDirty) return;
      let alive = 0;
      let top = 0;
      for (let i = 0; i < span; i++) {
        if (isAlive[i] === 0) continue;
        const ageMs = nowReal - (startAtReal[i] as number);
        const progress = ageMs / (lifeMs[i] as number);
        if (progress >= 1) {
          isAlive[i] = 0;
          hide(i);
          continue;
        }
        alive++;
        top = i + 1;
        if (progress < 0) {
          // Not started yet (or the clock went back): waiting, not drawn.
          hide(i);
          continue;
        }
        const ageS = ageMs / MS_PER_S;
        const gravity = isPuff[i] === 1 ? 0 : 0.5 * PARTICLE_GRAVITY_MPS2 * ageS * ageS;
        scratchPosition.set(
          (x0[i] as number) + (vx[i] as number) * ageS,
          (y0[i] as number) + (vy[i] as number) * ageS - gravity,
          (z0[i] as number) + (vz[i] as number) * ageS,
        );
        const grow =
          isPuff[i] === 1
            ? progress < PUFF_PEAK_AT
              ? 1 + (progress / PUFF_PEAK_AT) * (PUFF_PEAK_SCALE - 1)
              : (PUFF_PEAK_SCALE * (1 - progress)) / (1 - PUFF_PEAK_AT)
            : 1 - progress;
        const edge = (sizeM[i] as number) * grow;
        scratchScale.set(edge, edge, edge);
        scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
        mesh.setMatrixAt(i, scratchMatrix);
      }
      span = top;
      mesh.count = top;
      aliveCount = alive;
      mesh.instanceMatrix.needsUpdate = true;
      // One more pass was needed to write the last state (a burst, or the last death).
      isDirty = false;
    },
    get aliveCount() {
      return aliveCount;
    },
    reset() {
      isAlive.fill(0);
      for (let i = 0; i < span; i++) hide(i);
      span = 0;
      aliveCount = 0;
      mesh.count = 0;
      mesh.instanceMatrix.needsUpdate = true;
      isDirty = false;
    },
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
