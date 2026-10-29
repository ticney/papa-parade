import { SOUND_WAVE_POOL_SIZE } from '@shared/constants';
import { Group, type Mesh, type MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { createSoundWaves } from './soundWaves.ts';

function build() {
  const parent = new Group();
  const waves = createSoundWaves(parent, 0x2a2140);
  const meshes = parent.children as Mesh[];
  return { parent, waves, meshes };
}

describe('createSoundWaves', () => {
  it('is hidden at rest: a pool of meshes, none visible', () => {
    const { waves, meshes } = build();
    expect(meshes).toHaveLength(SOUND_WAVE_POOL_SIZE);
    waves.update(5000);
    expect(meshes.every((mesh) => !mesh.visible)).toBe(true);
  });

  it('lies flat just above the floor, in ink, transparent, without writing depth', () => {
    const { meshes } = build();
    const material = meshes[0]?.material as MeshBasicMaterial;
    expect(meshes[0]?.position.y).toBeGreaterThan(0);
    expect(meshes[0]?.position.y).toBeLessThan(0.05);
    expect(material.color.getHex()).toBe(0x2a2140);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
  });

  it('shares one geometry between the rings', () => {
    const { meshes } = build();
    expect(new Set(meshes.map((mesh) => mesh.geometry)).size).toBe(1);
  });

  it('puts a wave at the point, hidden before its time, growing and fading, hidden after', () => {
    const { waves, meshes } = build();
    waves.play(2, -3, 0.6, 350, 1000);
    const wave = meshes[0] as Mesh;
    const material = wave.material as MeshBasicMaterial;
    expect([wave.position.x, wave.position.z]).toEqual([2, -3]);

    waves.update(900);
    expect(wave.visible).toBe(false);

    waves.update(1100);
    expect(wave.visible).toBe(true);
    expect(wave.scale.x).toBeCloseTo(0.6 * (100 / 350), 9);
    expect(wave.scale.z).toBeCloseTo(wave.scale.x, 9);
    expect(material.opacity).toBeCloseTo(1 - 100 / 350, 9);

    waves.update(1250);
    expect(wave.scale.x).toBeGreaterThan(0.6 * (100 / 350));
    expect(material.opacity).toBeLessThan(1 - 100 / 350);

    waves.update(1350);
    expect(wave.visible).toBe(false);
    // Over for good: a clock that goes back does not bring it back.
    waves.update(1100);
    expect(wave.visible).toBe(false);
  });

  it('is frozen with the clock: the same clock draws the same wave', () => {
    const { waves, meshes } = build();
    waves.play(0, 0, 1, 1000, 0);
    waves.update(500);
    const scale = (meshes[0] as Mesh).scale.x;
    waves.update(500);
    expect((meshes[0] as Mesh).scale.x).toBe(scale);
  });

  it('fades each wave on its own', () => {
    const { waves, meshes } = build();
    waves.play(0, 0, 1, 1000, 0);
    waves.play(1, 1, 1, 1000, 500);
    waves.update(750);
    const opacities = meshes
      .slice(0, 2)
      .map((mesh) => (mesh.material as MeshBasicMaterial).opacity);
    expect(opacities[0]).toBeCloseTo(0.25, 9);
    expect(opacities[1]).toBeCloseTo(0.75, 9);
  });

  it('shows at most the pool size, and one more wave reuses the oldest mesh', () => {
    const { waves, meshes } = build();
    for (let i = 0; i < SOUND_WAVE_POOL_SIZE; i++) waves.play(i, 0, 1, 10_000, 100 * i);
    waves.update(2000);
    expect(meshes.filter((mesh) => mesh.visible)).toHaveLength(SOUND_WAVE_POOL_SIZE);
    waves.play(99, 0, 1, 10_000, 1500);
    expect(meshes.map((mesh) => mesh.position.x)).toEqual([
      99,
      ...Array.from({ length: SOUND_WAVE_POOL_SIZE - 1 }, (_, i) => i + 1),
    ]);
    expect(meshes).toHaveLength(SOUND_WAVE_POOL_SIZE);
  });

  it('never overwrites a pulse still waiting to start: when all are queued, the new ring is dropped', () => {
    const { waves, meshes } = build();
    waves.update(0);
    for (let i = 0; i < SOUND_WAVE_POOL_SIZE; i++) waves.play(i, 0, 1, 1000, 500 + 100 * i);
    waves.play(99, 0, 1, 1000, 0);
    expect(meshes.map((mesh) => mesh.position.x)).toEqual(
      Array.from({ length: SOUND_WAVE_POOL_SIZE }, (_, i) => i),
    );
  });

  it('takes a free slot before it reuses a live one', () => {
    const { waves, meshes } = build();
    waves.play(1, 0, 1, 100, 0);
    waves.update(500); // over: its slot is free again
    waves.play(2, 0, 1, 100, 500);
    waves.play(3, 0, 1, 100, 500);
    expect(meshes.map((mesh) => mesh.position.x).slice(0, 2)).toEqual([2, 3]);
  });

  it('frees its geometry and every material on dispose', () => {
    const { waves, meshes, parent } = build();
    const events: string[] = [];
    meshes[0]?.geometry.addEventListener('dispose', () => events.push('geometry'));
    for (const mesh of meshes) {
      (mesh.material as MeshBasicMaterial).addEventListener('dispose', () =>
        events.push('material'),
      );
    }
    waves.dispose();
    expect(events.filter((event) => event === 'geometry')).toHaveLength(1);
    expect(events.filter((event) => event === 'material')).toHaveLength(SOUND_WAVE_POOL_SIZE);
    expect(parent.children).toHaveLength(0);
  });

  it('reset hides every ring and frees the slots, so none comes back with the clock', () => {
    const { waves, meshes } = build();
    for (let i = 0; i < SOUND_WAVE_POOL_SIZE; i++) waves.play(i, 0, 1, 1000, 0);
    waves.update(300);
    expect(meshes.every((mesh) => mesh.visible)).toBe(true);
    waves.reset();
    expect(meshes.every((mesh) => !mesh.visible)).toBe(true);
    waves.update(400);
    expect(meshes.every((mesh) => !mesh.visible)).toBe(true);
  });
});
