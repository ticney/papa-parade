import { SOUND_WAVE_POOL_SIZE } from '@shared/constants';
import { DoubleSide, Mesh, MeshBasicMaterial, type Object3D, RingGeometry } from 'three';

// Art constants of the provisional ring (E7 replaces it), named with their units.
/** Inner radius of the ring as a share of its outer radius (1): how thick the line is. */
const RING_INNER_RATIO = 0.65;
/** Segments around the ring: enough to look round at the size of a room. */
const RING_SEGMENTS = 48;
/** The ring floats this far above the floor so that it never fights it for the depth buffer, in metres. */
const SOUND_WAVE_LIFT_M = 0.006;

export interface SoundWaves {
  /**
   * A ring on the floor at (`xM`, `zM`) that grows to `maxRadiusM` and fades over `durationMs`,
   * counted from `startAt` (sim ms). It takes a free slot, or the oldest wave's.
   */
  play(xM: number, zM: number, maxRadiusM: number, durationMs: number, startAt: number): void;
  /** Draws every wave at `clockMs` (sim ms): scale, opacity, and hidden once it is over. Allocates nothing. */
  update(clockMs: number): void;
  /** Hides every ring at once: the level is over and the loop no longer runs to finish them. */
  reset(): void;
  /** Frees the shared geometry and every material. */
  dispose(): void;
}

interface Wave {
  readonly mesh: Mesh;
  readonly material: MeshBasicMaterial;
  isActive: boolean;
  startAt: number;
  durationMs: number;
  maxRadiusM: number;
}

/**
 * The pooled sound-wave rings of a level: `SOUND_WAVE_POOL_SIZE` meshes sharing one geometry,
 * hidden at rest (a hidden mesh draws nothing), each with its own material so that each fades on
 * its own. They run on the sim clock the scene passes to `update`, so a pause freezes them and a
 * slow-mo slows them.
 */
export function createSoundWaves(parent: Object3D, color: number): SoundWaves {
  const geometry = new RingGeometry(RING_INNER_RATIO, 1, RING_SEGMENTS);
  geometry.rotateX(-Math.PI / 2); // from the XY plane onto the floor
  const waves: Wave[] = [];
  for (let i = 0; i < SOUND_WAVE_POOL_SIZE; i++) {
    const material = new MeshBasicMaterial({
      color,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    const mesh = new Mesh(geometry, material);
    mesh.name = 'sound_wave';
    mesh.visible = false;
    mesh.position.y = SOUND_WAVE_LIFT_M;
    parent.add(mesh);
    waves.push({ mesh, material, isActive: false, startAt: 0, durationMs: 1, maxRadiusM: 1 });
  }

  const pick = (): Wave => {
    let oldest = waves[0] as Wave;
    for (const wave of waves) {
      if (!wave.isActive) return wave;
      if (wave.startAt < oldest.startAt) oldest = wave;
    }
    return oldest;
  };

  return {
    play(xM, zM, maxRadiusM, durationMs, startAt) {
      const wave = pick();
      wave.isActive = true;
      wave.startAt = startAt;
      wave.durationMs = durationMs;
      wave.maxRadiusM = maxRadiusM;
      wave.mesh.position.x = xM;
      wave.mesh.position.z = zM;
    },
    update(clockMs) {
      for (const wave of waves) {
        if (!wave.isActive) continue;
        const elapsedMs = clockMs - wave.startAt;
        if (elapsedMs >= wave.durationMs) {
          wave.isActive = false;
          wave.mesh.visible = false;
          continue;
        }
        if (elapsedMs < 0) {
          wave.mesh.visible = false;
          continue;
        }
        const progress = elapsedMs / wave.durationMs;
        wave.mesh.visible = true;
        wave.mesh.scale.setScalar(wave.maxRadiusM * progress);
        wave.material.opacity = 1 - progress;
      }
    },
    reset() {
      for (const wave of waves) {
        wave.isActive = false;
        wave.mesh.visible = false;
      }
    },
    dispose() {
      geometry.dispose();
      for (const wave of waves) {
        wave.mesh.removeFromParent();
        wave.material.dispose();
      }
    },
  };
}
