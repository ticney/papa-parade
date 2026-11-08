import type { CelebrationSettings, FireworkColorToken } from '@content/schemas/feedback';
import {
  FIREWORK_POOL_SIZE,
  PARTICLE_GRAVITY_MPS2,
  REDUCED_MOTION_PARTICLE_KEEP_PCT,
} from '@shared/constants';
import { log } from '@shared/log';
import {
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  type Object3D,
  OctahedronGeometry,
  Quaternion,
  Vector3,
} from 'three';

// The fireworks of the level's finale (story 7.4, D7): a second pooled mesh beside the particles, so a
// perfect's sparks never steal its slots and it costs one draw call, only while shown. Real time: they
// burst over the frozen room of a `cycleDone` end as well as during play.

/**
 * The colours a firework may use, as `DESIGN.md` gives them (`levelAssets.test.ts` ties the two and holds
 * each away from the reserved hues): never `alert`, `parry` or `dodge`.
 */
export const FIREWORK_TOKEN_HEX: Readonly<Record<FireworkColorToken, number>> = {
  primary: 0x6d3fe0,
  'gauge-calm': 0x1f9e73,
  'mama-calm': 0xd6609a,
  smell: 0x7cc243,
  paper: 0xffffff,
};

/** The golden angle, in radians: successive directions never line up, whatever the count. */
const GOLDEN_ANGLE_RAD = Math.PI * (3 - Math.sqrt(5));
/** A spark falls slower than a crumb: a firework hangs in the air. */
const FIREWORK_GRAVITY_SHARE = 0.25;
/** A unit-wide gem: `sizeM` keeps meaning the spark's width from tip to tip. */
const SPARK_CIRCUMRADIUS = 0.5;
const MS_PER_S = 1000;

/** The floor area the bursts are placed in by `xPct` and `zPct`, in metres (`fireworkAreaOf`). */
export interface FireworkRoom {
  readonly minXM: number;
  readonly minZM: number;
  readonly maxXM: number;
  readonly maxZM: number;
}

export interface Fireworks {
  /**
   * Schedules every burst of `settings` from `startAtReal` (real ms), each at its `atMs`, over `room`.
   * Under reduced motion each keeps `REDUCED_MOTION_PARTICLE_KEEP_PCT` of its sparks. Starting again
   * replaces what was scheduled.
   */
  start(
    settings: CelebrationSettings['fireworks'],
    room: FireworkRoom,
    startAtReal: number,
    isMotionReduced: boolean,
  ): void;
  /** Moves every live spark for `nowReal` (real ms). Allocates nothing; writes nothing when idle. */
  update(nowReal: number): void;
  /** Sparks drawn or waiting to burst as of the last `update` (the debug `fx()` reads it). */
  readonly aliveCount: number;
  /** When the last spark dies, in real ms, or null with nothing scheduled. */
  readonly endsAtReal: number | null;
  /** Hides every spark at once. */
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
 * The square of `areaHalfM` around the floor point `(centreXM, centreZM)` the camera looks at, cut to the
 * room's floor `room`: a follow camera shows a part of a big room, and the bursts must go off in it.
 */
export function fireworkAreaOf(
  room: FireworkRoom,
  centreXM: number,
  centreZM: number,
  areaHalfM: number,
): FireworkRoom {
  const halfXM = Math.min(areaHalfM, (room.maxXM - room.minXM) / 2);
  const halfZM = Math.min(areaHalfM, (room.maxZM - room.minZM) / 2);
  const xM = Math.min(room.maxXM - halfXM, Math.max(room.minXM + halfXM, centreXM));
  const zM = Math.min(room.maxZM - halfZM, Math.max(room.minZM + halfZM, centreZM));
  return { minXM: xM - halfXM, minZM: zM - halfZM, maxXM: xM + halfXM, maxZM: zM + halfZM };
}

/** The sparks a burst draws: all of them, or the reduced-motion share (at least one). */
export function sparkCountOf(sparks: number, isMotionReduced: boolean): number {
  if (!isMotionReduced) return sparks;
  return Math.max(1, Math.round((sparks * REDUCED_MOTION_PARTICLE_KEEP_PCT) / 100));
}

/** The largest number of sparks `settings` ever asks for at once: every burst of it. */
export function fireworkSparksOf(settings: CelebrationSettings['fireworks']): number {
  let total = 0;
  for (const burst of settings.bursts) total += burst.sparks;
  return total;
}

/**
 * The pooled fireworks of a level: one `InstancedMesh` of `FIREWORK_POOL_SIZE` small faceted gems. Each
 * burst lays its sparks over a whole golden-angle sphere (no random number: the same finale looks the
 * same twice), coloured from its tokens in turn. The mesh is hidden while nothing is scheduled.
 */
export function createFireworks(parent: Object3D): Fireworks {
  const geometry = new OctahedronGeometry(SPARK_CIRCUMRADIUS);
  const material = new MeshBasicMaterial();
  const mesh = new InstancedMesh(geometry, material, FIREWORK_POOL_SIZE);
  mesh.name = 'fireworks';
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.visible = false;
  // Every instance gets a colour before the first render, or three draws the mesh black.
  scratchColor.setHex(FIREWORK_TOKEN_HEX.paper);
  for (let i = 0; i < FIREWORK_POOL_SIZE; i++) mesh.setColorAt(i, scratchColor);
  parent.add(mesh);

  const n = FIREWORK_POOL_SIZE;
  const startAtReal = new Float64Array(n);
  const x0 = new Float32Array(n);
  const y0 = new Float32Array(n);
  const z0 = new Float32Array(n);
  const vx = new Float32Array(n);
  const vy = new Float32Array(n);
  const vz = new Float32Array(n);
  let used = 0;
  let lifeMs = 1;
  let sizeM = 0;
  let aliveCount = 0;
  let endsAtReal: number | null = null;

  const hide = (i: number) => {
    scratchMatrix.makeScale(0, 0, 0);
    mesh.setMatrixAt(i, scratchMatrix);
  };
  for (let i = 0; i < n; i++) hide(i);

  const clear = (): void => {
    for (let i = 0; i < used; i++) hide(i);
    used = 0;
    aliveCount = 0;
    endsAtReal = null;
    mesh.count = 0;
    mesh.visible = false;
    mesh.instanceMatrix.needsUpdate = true;
  };

  return {
    start(settings, room, at, isMotionReduced) {
      clear();
      lifeMs = settings.lifeMs;
      sizeM = settings.sizeM;
      const widthM = room.maxXM - room.minXM;
      const depthM = room.maxZM - room.minZM;
      let colour = 0;
      let lastBurstAtMs = 0;
      for (const burst of settings.bursts) {
        const count = sparkCountOf(burst.sparks, isMotionReduced);
        const xM = room.minXM + (burst.xPct / 100) * widthM;
        const zM = room.minZM + (burst.zPct / 100) * depthM;
        for (let k = 0; k < count && used < n; k++) {
          const i = used++;
          // A whole sphere: the height runs from the top pole to the bottom one as k grows.
          const up = 1 - (2 * (k + 0.5)) / count;
          const around = Math.sqrt(1 - up * up);
          const angle = k * GOLDEN_ANGLE_RAD;
          startAtReal[i] = at + burst.atMs;
          x0[i] = xM;
          y0[i] = burst.heightM;
          z0[i] = zM;
          vx[i] = Math.cos(angle) * around * settings.speedMps;
          vy[i] = up * settings.speedMps;
          vz[i] = Math.sin(angle) * around * settings.speedMps;
          const token = settings.colorTokens[colour % settings.colorTokens.length];
          colour++;
          const hex = token === undefined ? undefined : FIREWORK_TOKEN_HEX[token];
          if (hex === undefined) log.warn('render', 'a firework colour is no token', { token });
          scratchColor.setHex(hex ?? FIREWORK_TOKEN_HEX.paper);
          mesh.setColorAt(i, scratchColor);
        }
        lastBurstAtMs = Math.max(lastBurstAtMs, burst.atMs);
      }
      if (used < fireworkSparksOf(settings) && !isMotionReduced) {
        log.warn('render', 'the fireworks ask for more sparks than the pool holds', {
          asked: fireworkSparksOf(settings),
          pool: n,
        });
      }
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
      endsAtReal = used === 0 ? null : at + lastBurstAtMs + lifeMs;
      aliveCount = used;
      mesh.visible = used > 0;
    },
    update(nowReal) {
      if (used === 0) return;
      let alive = 0;
      let top = 0;
      for (let i = 0; i < used; i++) {
        const ageMs = nowReal - (startAtReal[i] as number);
        const progress = ageMs / lifeMs;
        if (progress >= 1) {
          hide(i);
          continue;
        }
        alive++;
        top = i + 1;
        if (progress < 0) {
          // Its burst has not gone off yet: waiting, not drawn.
          hide(i);
          continue;
        }
        const ageS = ageMs / MS_PER_S;
        const fall = 0.5 * PARTICLE_GRAVITY_MPS2 * FIREWORK_GRAVITY_SHARE * ageS * ageS;
        scratchPosition.set(
          (x0[i] as number) + (vx[i] as number) * ageS,
          (y0[i] as number) + (vy[i] as number) * ageS - fall,
          (z0[i] as number) + (vz[i] as number) * ageS,
        );
        const edge = sizeM * (1 - progress);
        scratchScale.set(edge, edge, edge);
        scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
        mesh.setMatrixAt(i, scratchMatrix);
      }
      aliveCount = alive;
      mesh.count = top;
      mesh.instanceMatrix.needsUpdate = true;
      if (alive === 0) clear();
    },
    get aliveCount() {
      return aliveCount;
    },
    get endsAtReal() {
      return endsAtReal;
    },
    reset() {
      clear();
    },
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
