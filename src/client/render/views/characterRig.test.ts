import { type Logger, log } from '@shared/log';
import { MeshToonMaterial, SkinnedMesh } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestPapa } from '../../../../tests/support/testCharacters.ts';
import { createToonMaterialCache } from '../materials/toonMaterial.ts';
import { createCharacterRig } from './characterRig.ts';

const CROSS_FADE_MS = 100;

function build() {
  const toon = createToonMaterialCache();
  const asset = createTestPapa();
  const rig = createCharacterRig(asset, toon, CROSS_FADE_MS);
  const spineY = (): number => rig.node('spine').position.y;
  return { rig, toon, asset, spineY };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createCharacterRig', () => {
  it('swaps every material for a shared toon one and never culls a skinned mesh', () => {
    const { rig, toon } = build();
    const skinned: SkinnedMesh[] = [];
    rig.root.traverse((node) => {
      if (node instanceof SkinnedMesh) skinned.push(node);
    });
    expect(skinned.length).toBeGreaterThan(0);
    for (const mesh of skinned) {
      expect(mesh.material).toBeInstanceOf(MeshToonMaterial);
      expect(mesh.frustumCulled).toBe(false);
    }
    expect(toon.size).toBe(2); // the fixture's two colours
  });

  it('plays the first loop at once, at full weight', () => {
    const { rig, spineY } = build();
    rig.play('idle');
    rig.update(500);
    expect(rig.clipName).toBe('idle');
    expect(spineY()).toBeCloseTo(0.5, 5);
  });

  it('holds the pose and the mixer clock on a dt of 0', () => {
    const { rig, spineY } = build();
    rig.play('idle');
    rig.update(300);
    const [y, timeMs] = [spineY(), rig.mixerTimeMs];
    rig.update(0);
    rig.update(0);
    expect(spineY()).toBe(y);
    expect(rig.mixerTimeMs).toBe(timeMs);
    expect(timeMs).toBeCloseTo(300, 5);
  });

  it('crossfades between loops over crossFadeMs, and stops running the old one', () => {
    const { rig } = build();
    rig.play('idle');
    rig.update(10);
    rig.play('walk');
    rig.update(CROSS_FADE_MS / 2);
    expect(rig.isClipRunning('idle')).toBe(true);
    expect(rig.isClipRunning('walk')).toBe(true);
    rig.update(CROSS_FADE_MS);
    expect(rig.clipName).toBe('walk');
    expect(rig.isClipRunning('idle')).toBe(false);
  });

  it('does not restart a loop asked for again', () => {
    const { rig, spineY } = build();
    rig.play('idle');
    rig.update(400);
    rig.play('idle');
    rig.update(100);
    expect(spineY()).toBeCloseTo(0.5, 5);
  });

  it('applies the timeScale to the loop', () => {
    const { rig, spineY } = build();
    rig.play('walk', 0.5);
    rig.update(400);
    expect(spineY()).toBeCloseTo(0.2, 5);
    rig.play('walk', 2);
    rig.update(100);
    expect(spineY()).toBeCloseTo(0.4, 5);
  });

  it('plays a one-shot over the loop and returns to what the state says by then', () => {
    const { rig } = build();
    rig.play('idle');
    rig.update(10);
    rig.playOnce('gag_hit');
    rig.update(10);
    expect(rig.clipName).toBe('gag_hit');
    // The state changes under the one-shot: it waits, and the end goes to the new loop, not the old one.
    rig.play('walk');
    rig.update(100);
    expect(rig.clipName).toBe('gag_hit');
    rig.update(1000);
    expect(rig.clipName).toBe('walk');
    rig.update(CROSS_FADE_MS);
    expect(rig.isClipRunning('gag_hit')).toBe(false);
    expect(rig.isClipRunning('idle')).toBe(false);
    expect(rig.isClipRunning('walk')).toBe(true);
  });

  it('lets a running one-shot go on when it is asked for again, and replays it once it is over', () => {
    const { rig } = build();
    rig.play('idle');
    rig.playOnce('stumble');
    rig.update(500);
    rig.playOnce('stumble');
    rig.update(600);
    expect(rig.clipName).toBe('idle');
    rig.playOnce('stumble');
    rig.update(10);
    expect(rig.clipName).toBe('stumble');
    rig.update(500);
    expect(rig.clipName).toBe('stumble');
  });

  it('holds a one-shot on a dt of 0', () => {
    const { rig } = build();
    rig.play('idle');
    rig.playOnce('stumble');
    rig.update(10);
    for (let i = 0; i < 5; i++) rig.update(0);
    expect(rig.clipName).toBe('stumble');
  });

  it('starts over on reset: no clip, a clock at 0, and the rest pose back', () => {
    const { rig, spineY } = build();
    rig.play('idle');
    rig.playOnce('stumble');
    rig.update(400);
    rig.reset();
    expect(rig.clipName).toBeNull();
    expect(rig.mixerTimeMs).toBe(0);
    expect(spineY()).toBe(0);
    rig.play('idle');
    rig.update(200);
    expect(spineY()).toBeCloseTo(0.2, 5);
  });

  it('warns once and plays nothing for a clip the file does not have', () => {
    const warnings: unknown[][] = [];
    vi.spyOn(log, 'warn').mockImplementation(((...args: unknown[]) => {
      warnings.push(args);
    }) as Logger['warn']);
    const { rig } = build();
    rig.play('moonwalk');
    rig.play('moonwalk');
    rig.playOnce('moonwalk');
    rig.update(10);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.[0]).toBe('render');
    expect(rig.clipName).toBeNull();
  });

  it('warns once and gives a stand-in for a node the file does not have', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation((() => {}) as Logger['warn']);
    const { rig } = build();
    expect(rig.node('papa_hat').parent).toBeNull();
    rig.node('papa_hat');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('frees each skeleton and geometry on dispose, and leaves the parent', () => {
    const { rig } = build();
    const skeletons: { dispose: () => void }[] = [];
    let isGeometryFreed = false;
    rig.root.traverse((node) => {
      if (node instanceof SkinnedMesh) {
        skeletons.push(node.skeleton);
        node.geometry.addEventListener('dispose', () => {
          isGeometryFreed = true;
        });
      }
    });
    const spies = skeletons.map((skeleton) => vi.spyOn(skeleton, 'dispose'));
    rig.play('idle');
    rig.update(10);
    rig.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
    expect(isGeometryFreed).toBe(true);
    expect(rig.root.parent).toBeNull();
  });
});
