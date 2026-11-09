import { type Logger, log } from '@shared/log';
import {
  AnimationClip,
  AnimationMixer,
  MeshToonMaterial,
  type Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  SkinnedMesh,
  Vector3,
  VectorKeyframeTrack,
} from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestPapa } from '../../../../tests/support/testCharacters.ts';
import { createOutlineKit } from '../materials/outlineHull.ts';
import { createToonMaterialCache } from '../materials/toonMaterial.ts';
import { createCharacterRig } from './characterRig.ts';

const TOON_TONES = [96, 178, 255];

const FADE_MS = 100;
/** The return fade from a one-shot (story 7.8: `fades.returnMs`). */
const RETURN_MS = 100;
const OUTLINES = { widthM: 0.025, skipMaterials: ['art_ink'] };

function build() {
  const toon = createToonMaterialCache(TOON_TONES);
  const asset = createTestPapa();
  const rig = createCharacterRig(asset, toon, createOutlineKit(OUTLINES), ['spine', 'head']);
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
      if (node instanceof SkinnedMesh && !node.name.startsWith('outline_')) skinned.push(node);
    });
    expect(skinned.length).toBeGreaterThan(0);
    for (const mesh of skinned) {
      expect(mesh.material).toBeInstanceOf(MeshToonMaterial);
      expect(mesh.frustumCulled).toBe(false);
    }
    expect(toon.size).toBe(2); // the fixture's two colours
  });

  it('gives each mesh a hull on the same skeleton, under the mesh, never culled, freed with the rig', () => {
    const { rig } = build();
    const hulls: SkinnedMesh[] = [];
    rig.root.traverse((node) => {
      if (node instanceof SkinnedMesh && node.name.startsWith('outline_')) hulls.push(node);
    });
    expect(hulls.length).toBeGreaterThan(0);
    for (const hull of hulls) {
      const source = hull.parent as SkinnedMesh;
      expect(hull.skeleton).toBe(source.skeleton);
      expect(hull.frustumCulled).toBe(false);
      expect(hull.material).not.toBeInstanceOf(MeshToonMaterial);
      expect(source.material).toBeInstanceOf(MeshToonMaterial);
    }
    const spies = hulls.map((hull) => vi.spyOn(hull.geometry, 'dispose'));
    // Each distinct skeleton is freed once per original mesh that uses it: the hulls add none.
    const skeletons = [...new Set(hulls.map((hull) => hull.skeleton))].map((skeleton) => ({
      spy: vi.spyOn(skeleton, 'dispose'),
      originals: hulls.filter((hull) => hull.skeleton === skeleton).length,
    }));
    rig.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    for (const { spy, originals } of skeletons) expect(spy).toHaveBeenCalledTimes(originals);
  });

  it('hides a hull with its named node', () => {
    const { rig } = build();
    const mug = rig.node('papa_mug');
    const hulls: Object3D[] = [];
    mug.traverse((node) => {
      if (node.name.startsWith('outline_')) hulls.push(node);
    });
    expect(hulls.length).toBeGreaterThan(0);
    mug.visible = false;
    for (const hull of hulls) {
      let isShown = true;
      hull.traverseAncestors((ancestor) => {
        if (!ancestor.visible) isShown = false;
      });
      expect(isShown).toBe(false);
    }
  });

  it('plays the first loop at once, at full weight', () => {
    const { rig, spineY } = build();
    rig.play('idle', 1, FADE_MS);
    rig.update(500, RETURN_MS);
    expect(rig.clipName).toBe('idle');
    expect(spineY()).toBeCloseTo(0.5, 5);
  });

  it('holds the pose and the mixer clock on a dt of 0', () => {
    const { rig, spineY } = build();
    rig.play('idle', 1, FADE_MS);
    rig.update(300, RETURN_MS);
    const [y, timeMs] = [spineY(), rig.mixerTimeMs];
    rig.update(0, RETURN_MS);
    rig.update(0, RETURN_MS);
    expect(spineY()).toBe(y);
    expect(rig.mixerTimeMs).toBe(timeMs);
    expect(timeMs).toBeCloseTo(300, 5);
  });

  it('crossfades between loops over the fade it was given, and stops running the old one', () => {
    const { rig } = build();
    rig.play('idle', 1, FADE_MS);
    rig.update(10, RETURN_MS);
    rig.play('walk', 1, FADE_MS);
    rig.update(FADE_MS / 2, RETURN_MS);
    expect(rig.isClipRunning('idle')).toBe(true);
    expect(rig.isClipRunning('walk')).toBe(true);
    rig.update(FADE_MS, RETURN_MS);
    expect(rig.clipName).toBe('walk');
    expect(rig.isClipRunning('idle')).toBe(false);
  });

  it('keeps the weights adding up to 1 when a fade is cut short by a third clip', () => {
    // Three flat clips at y = 0.5 over a rest pose at 0: the pose is 0.5 × the summed weight, so a
    // sum under 1 would show as a dip toward the bind pose.
    const flat = (name: string): AnimationClip =>
      new AnimationClip(name, 1, [
        new VectorKeyframeTrack('spine.position', [0, 1], [0, 0.5, 0, 0, 0.5, 0]),
      ]);
    const { scene } = createTestPapa();
    const rig = createCharacterRig(
      { scene, animations: ['idle', 'walk', 'glide'].map(flat) },
      createToonMaterialCache(TOON_TONES),
      createOutlineKit(OUTLINES),
    );
    const spineY = (): number => rig.node('spine').position.y;
    rig.play('idle', 1, FADE_MS);
    rig.update(10, RETURN_MS);
    rig.play('walk', 1, FADE_MS);
    rig.update(FADE_MS / 2, RETURN_MS);
    expect(spineY()).toBeCloseTo(0.5, 5);
    rig.play('glide', 1, FADE_MS);
    for (let i = 0; i < 12; i++) {
      rig.update(FADE_MS / 10, RETURN_MS);
      expect(spineY(), `step ${i}`).toBeCloseTo(0.5, 5);
    }
    expect(rig.isClipRunning('idle')).toBe(false);
    expect(rig.isClipRunning('walk')).toBe(false);
    expect(rig.clipName).toBe('glide');
  });

  it('does not restart a loop asked for again', () => {
    const { rig, spineY } = build();
    rig.play('idle', 1, FADE_MS);
    rig.update(400, RETURN_MS);
    rig.play('idle', 1, FADE_MS);
    rig.update(100, RETURN_MS);
    expect(spineY()).toBeCloseTo(0.5, 5);
  });

  it('applies the timeScale to the loop', () => {
    const { rig, spineY } = build();
    rig.play('walk', 0.5, FADE_MS);
    rig.update(400, RETURN_MS);
    expect(spineY()).toBeCloseTo(0.2, 5);
    rig.play('walk', 2, FADE_MS);
    rig.update(100, RETURN_MS);
    expect(spineY()).toBeCloseTo(0.4, 5);
  });

  it('plays a one-shot over the loop and returns to what the state says by then', () => {
    const { rig } = build();
    rig.play('idle', 1, FADE_MS);
    rig.update(10, RETURN_MS);
    rig.playOnce('gag_hit', FADE_MS);
    rig.update(10, RETURN_MS);
    expect(rig.clipName).toBe('gag_hit');
    // The state changes under the one-shot: it waits, and the end goes to the new loop, not the old one.
    rig.play('walk', 1, FADE_MS);
    rig.update(100, RETURN_MS);
    expect(rig.clipName).toBe('gag_hit');
    rig.update(1000, RETURN_MS);
    expect(rig.clipName).toBe('walk');
    rig.update(FADE_MS, RETURN_MS);
    expect(rig.isClipRunning('gag_hit')).toBe(false);
    expect(rig.isClipRunning('idle')).toBe(false);
    expect(rig.isClipRunning('walk')).toBe(true);
  });

  it('lets a running one-shot go on when it is asked for again, and replays it once it is over', () => {
    const { rig } = build();
    rig.play('idle', 1, FADE_MS);
    rig.playOnce('stumble', FADE_MS);
    rig.update(500, RETURN_MS);
    rig.playOnce('stumble', FADE_MS);
    rig.update(600, RETURN_MS);
    expect(rig.clipName).toBe('idle');
    rig.playOnce('stumble', FADE_MS);
    rig.update(10, RETURN_MS);
    expect(rig.clipName).toBe('stumble');
    rig.update(500, RETURN_MS);
    expect(rig.clipName).toBe('stumble');
  });

  it('never hands a one-shot back before half of it, whatever the return fade (a hot returnMs)', () => {
    const { rig } = build();
    rig.play('idle', 1, FADE_MS);
    rig.playOnce('stumble', FADE_MS);
    // A return fade far longer than the clip would hand it back at its very first update.
    rig.update(10, 100000);
    expect(rig.clipName).toBe('stumble');
    rig.update(2000, 100000);
    expect(rig.clipName).toBe('idle');
  });

  it('keeps a held one-shot on its last frame: no hand-back to the loop until reset (story 7.4)', () => {
    const { rig } = build();
    rig.play('idle', 1, FADE_MS);
    rig.playOnce('stumble', FADE_MS, true);
    rig.update(10, RETURN_MS);
    rig.update(5000, RETURN_MS);
    expect(rig.clipName).toBe('stumble');
    expect(rig.isClipRunning('stumble')).toBe(true);
    rig.reset();
    rig.play('idle', 1, FADE_MS);
    rig.playOnce('stumble', FADE_MS);
    rig.update(10, RETURN_MS);
    rig.update(5000, RETURN_MS);
    expect(rig.clipName).toBe('idle');
  });

  it('holds a one-shot on a dt of 0', () => {
    const { rig } = build();
    rig.play('idle', 1, FADE_MS);
    rig.playOnce('stumble', FADE_MS);
    rig.update(10, RETURN_MS);
    for (let i = 0; i < 5; i++) rig.update(0, RETURN_MS);
    expect(rig.clipName).toBe('stumble');
  });

  it('starts over on reset: no clip, a clock at 0, and the rest pose back', () => {
    const { rig, spineY } = build();
    rig.play('idle', 1, FADE_MS);
    rig.playOnce('stumble', FADE_MS);
    rig.update(400, RETURN_MS);
    rig.reset();
    expect(rig.clipName).toBeNull();
    expect(rig.mixerTimeMs).toBe(0);
    expect(spineY()).toBe(0);
    rig.play('idle', 1, FADE_MS);
    rig.update(200, RETURN_MS);
    expect(spineY()).toBeCloseTo(0.2, 5);
  });

  it('warns once and plays nothing for a clip the file does not have', () => {
    const warnings: unknown[][] = [];
    vi.spyOn(log, 'warn').mockImplementation(((...args: unknown[]) => {
      warnings.push(args);
    }) as Logger['warn']);
    const { rig } = build();
    rig.play('moonwalk', 1, FADE_MS);
    rig.play('moonwalk', 1, FADE_MS);
    rig.playOnce('moonwalk', FADE_MS);
    rig.update(10, RETURN_MS);
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
    // The mixer's caches hold the clips' bindings of the root: a leak there shows in no GPU count.
    const stopAll = vi.spyOn(AnimationMixer.prototype, 'stopAllAction');
    const uncacheRoot = vi.spyOn(AnimationMixer.prototype, 'uncacheRoot');
    rig.play('idle', 1, FADE_MS);
    rig.update(10, RETURN_MS);
    rig.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
    expect(stopAll).toHaveBeenCalled();
    expect(uncacheRoot).toHaveBeenCalledWith(rig.root);
    expect(isGeometryFreed).toBe(true);
    expect(rig.root.parent).toBeNull();
  });
});

describe('createCharacterRig: fades per passage and the life bones (story 7.8)', () => {
  /** A clip holding the spine at `yM`, and its rotation at `spineQ`, for `durationS`. */
  const held = (name: string, yM: number, durationS = 1, spineQ = new Quaternion()) =>
    new AnimationClip(name, durationS, [
      new VectorKeyframeTrack('spine.position', [0, durationS], [0, yM, 0, 0, yM, 0]),
      new QuaternionKeyframeTrack(
        'spine.quaternion',
        [0],
        [spineQ.x, spineQ.y, spineQ.z, spineQ.w],
      ),
    ]);

  function buildWith(animations: AnimationClip[], restHead?: Quaternion) {
    const { scene } = createTestPapa();
    if (restHead !== undefined) scene.getObjectByName('head')?.quaternion.copy(restHead);
    const rig = createCharacterRig(
      { scene, animations },
      createToonMaterialCache(TOON_TONES),
      createOutlineKit(OUTLINES),
      ['spine', 'head'],
    );
    return { rig, spineY: () => rig.node('spine').position.y };
  }

  const sumOfWeights = (rig: ReturnType<typeof buildWith>['rig']): number =>
    rig.weightOf('idle') + rig.weightOf('walk') + rig.weightOf('glide');

  it('keeps the weights adding up to 1 through A, B and C at mixed fade durations', () => {
    const { rig, spineY } = buildWith(['idle', 'walk', 'glide'].map((name) => held(name, 0.5)));
    rig.play('idle', 1, 100);
    rig.update(10, RETURN_MS);
    rig.play('walk', 1, 200);
    for (let i = 0; i < 7; i++) {
      rig.update(13, RETURN_MS);
      expect(sumOfWeights(rig), `A→B step ${i}`).toBeCloseTo(1, 9);
      expect(spineY()).toBeCloseTo(0.5, 5);
    }
    rig.play('glide', 1, 37);
    for (let i = 0; i < 3; i++) {
      rig.update(7, RETURN_MS);
      expect(sumOfWeights(rig), `→C step ${i}`).toBeCloseTo(1, 9);
      expect(spineY()).toBeCloseTo(0.5, 5);
    }
    // Back to the walk while it is still fading out: it goes on from its weight, no jump.
    const walkWeight = rig.weightOf('walk');
    expect(walkWeight).toBeGreaterThan(0);
    rig.play('walk', 1, 200);
    rig.update(1, RETURN_MS);
    expect(rig.weightOf('walk')).toBeGreaterThanOrEqual(walkWeight);
    expect(rig.weightOf('walk') - walkWeight).toBeLessThan(0.02);
    expect(sumOfWeights(rig)).toBeCloseTo(1, 9);
  });

  it('eases a fade in and out: zero slope at both ends, half at half time', () => {
    const { rig } = buildWith(['idle', 'walk'].map((name) => held(name, 0.5)));
    rig.play('idle', 1, 100);
    rig.update(10, RETURN_MS);
    rig.play('walk', 1, 200);
    rig.update(2, RETURN_MS);
    // Linear would be 0.01: the ease starts flat.
    expect(rig.weightOf('walk')).toBeLessThan(0.001);
    rig.update(98, RETURN_MS);
    expect(rig.weightOf('walk')).toBeCloseTo(0.5, 9);
    rig.update(98, RETURN_MS);
    expect(1 - rig.weightOf('walk')).toBeLessThan(0.001);
    rig.update(2, RETURN_MS);
    expect(rig.weightOf('walk')).toBe(1);
    expect(rig.isClipRunning('idle')).toBe(false);
  });

  it('cuts at a fade of 0', () => {
    const { rig } = buildWith(['idle', 'walk'].map((name) => held(name, 0.5)));
    rig.play('idle', 1, 100);
    rig.update(10, RETURN_MS);
    rig.play('walk', 1, 0);
    rig.update(10, RETURN_MS);
    expect(rig.weightOf('walk')).toBe(1);
    expect(rig.isClipRunning('idle')).toBe(false);
  });

  it('hands a one-shot back returnFadeMs before its end, and fades the loop in over that long', () => {
    const { rig } = buildWith([held('idle', 0.5), held('stumble', 0.5, 0.6)]);
    rig.play('idle', 1, 100);
    rig.playOnce('stumble', 50);
    rig.update(440, 150);
    expect(rig.clipName).toBe('stumble');
    rig.update(20, 150);
    expect(rig.clipName).toBe('idle');
    rig.update(75, 150);
    expect(rig.weightOf('idle')).toBeCloseTo(0.5, 9);
  });

  it('never lets an offset pile up on a bone no clip keys', () => {
    const rest = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.3);
    const { rig } = buildWith([held('idle', 0.5)], rest);
    const head = rig.node('head');
    const offset = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (5 * Math.PI) / 180);
    rig.play('idle', 1, 100);
    for (let i = 0; i < 1000; i++) {
      rig.update(16, RETURN_MS);
      head.quaternion.multiply(offset);
    }
    // The bone's own rest (not the identity), times one offset.
    expect(head.quaternion.angleTo(rest.clone().multiply(offset))).toBeLessThan(1e-6);
  });

  it('shows the clip times the offset on a bone a clip keys, frame after frame', () => {
    const keyed = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (30 * Math.PI) / 180);
    const { rig } = buildWith([held('idle', 0.5, 1, keyed)]);
    const spine = rig.node('spine');
    const offset = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), (10 * Math.PI) / 180);
    rig.play('idle', 1, 100);
    for (let i = 0; i < 50; i++) {
      rig.update(16, RETURN_MS);
      spine.quaternion.multiply(offset);
    }
    // Within the float32 of three's keyframe buffers (about 3e-4 rad here), and no more after 50 frames.
    expect(spine.quaternion.angleTo(keyed.clone().multiply(offset))).toBeLessThan(1e-3);
  });

  it('holds a keyed bone with its offset on a frozen clock', () => {
    // A frozen clock (a pause, a hitstop, the end photo) gives the mixer nothing new to write.
    const keyed = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.4);
    const { rig } = buildWith([held('idle', 0.5, 1, keyed)]);
    const spine = rig.node('spine');
    const offset = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.1);
    rig.play('idle', 1, 100);
    rig.update(16, RETURN_MS);
    spine.quaternion.multiply(offset);
    const shown = spine.quaternion.clone();
    for (let i = 0; i < 20; i++) {
      rig.update(0, RETURN_MS);
      spine.quaternion.multiply(offset);
      expect(spine.quaternion.angleTo(shown)).toBeLessThan(1e-9);
    }
  });

  it('binds a new clip on the rest, not on last frame’s offset', () => {
    // A clip that keys `head` comes in while the head carries an offset: three saves the bone's
    // « original » value when the clip binds it, and fills a weight under 1 from it.
    const headClip = new AnimationClip('walk', 1, [
      new QuaternionKeyframeTrack('head.quaternion', [0], [0, 0, 0, 1]),
    ]);
    const { rig } = buildWith([held('idle', 0.5), headClip]);
    const head = rig.node('head');
    const offset = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.5);
    rig.play('idle', 1, 100);
    rig.update(16, RETURN_MS);
    head.quaternion.multiply(offset);
    rig.play('walk', 1, 100);
    rig.update(50, RETURN_MS);
    // Half the walk (the identity), half the original: the rest, not half last frame's turn.
    expect(head.quaternion.angleTo(new Quaternion())).toBeLessThan(1e-6);
  });
});

describe('createCharacterRig: the cut of an acting one-shot (story 7.11, D11)', () => {
  const held = (name: string, yM: number) =>
    new AnimationClip(name, 1, [
      new VectorKeyframeTrack('spine.position', [0, 1], [0, yM, 0, 0, yM, 0]),
    ]);

  function buildFlat() {
    const { scene } = createTestPapa();
    const rig = createCharacterRig(
      { scene, animations: ['idle', 'walk', 'idle_scratch'].map((name) => held(name, 0.5)) },
      createToonMaterialCache(TOON_TONES),
      createOutlineKit(OUTLINES),
    );
    return { rig, spineY: () => rig.node('spine').position.y };
  }

  it('hands back to the loop at once: the loop is what is seen in that very call', () => {
    const { rig } = build();
    rig.play('idle', 1, FADE_MS);
    rig.update(10, RETURN_MS);
    rig.playOnce('idle_scratch', FADE_MS);
    rig.update(200, RETURN_MS);
    expect(rig.clipName).toBe('idle_scratch');
    expect(rig.oneShotName).toBe('idle_scratch');
    rig.cutOnce(FADE_MS);
    expect(rig.clipName).toBe('idle');
    expect(rig.oneShotName).toBeNull();
    rig.update(FADE_MS / 2, RETURN_MS);
    expect(rig.weightOf('idle')).toBeGreaterThan(0);
    expect(rig.weightOf('idle')).toBeLessThan(1);
    rig.update(FADE_MS, RETURN_MS);
    expect(rig.isClipRunning('idle_scratch')).toBe(false);
    expect(rig.weightOf('idle')).toBe(1);
  });

  it('fades in the loop the state says now, which waited for the one-shot', () => {
    const { rig } = build();
    rig.play('idle', 1, FADE_MS);
    rig.update(10, RETURN_MS);
    rig.playOnce('idle_scratch', FADE_MS);
    rig.update(200, RETURN_MS);
    rig.play('walk', 1, FADE_MS);
    rig.update(10, RETURN_MS);
    expect(rig.clipName).toBe('idle_scratch');
    rig.cutOnce(FADE_MS);
    expect(rig.clipName).toBe('walk');
    rig.update(FADE_MS, RETURN_MS);
    expect(rig.weightOf('walk')).toBe(1);
  });

  it('does nothing with no one-shot under way: a fade between loops goes on as it was', () => {
    const { rig } = build();
    rig.play('idle', 1, FADE_MS);
    rig.update(10, RETURN_MS);
    rig.play('walk', 1, FADE_MS);
    rig.update(FADE_MS / 2, RETURN_MS);
    const walkWeight = rig.weightOf('walk');
    rig.cutOnce(1000);
    expect(rig.clipName).toBe('walk');
    rig.update(FADE_MS / 2, RETURN_MS);
    expect(walkWeight).toBeLessThan(1);
    expect(rig.weightOf('walk')).toBe(1);
  });

  it('cuts a held one-shot too', () => {
    const { rig } = build();
    rig.play('idle', 1, FADE_MS);
    rig.playOnce('collapse', FADE_MS, true);
    rig.update(5000, RETURN_MS);
    rig.cutOnce(FADE_MS);
    expect(rig.clipName).toBe('idle');
    rig.update(FADE_MS, RETURN_MS);
    expect(rig.isClipRunning('collapse')).toBe(false);
  });

  it('keeps the weights adding up to 1 through a cut in the middle of the one-shot’s fade', () => {
    const { rig, spineY } = buildFlat();
    rig.play('idle', 1, FADE_MS);
    rig.update(10, RETURN_MS);
    rig.play('walk', 1, FADE_MS);
    rig.update(FADE_MS / 3, RETURN_MS);
    rig.playOnce('idle_scratch', FADE_MS);
    rig.update(FADE_MS / 3, RETURN_MS);
    expect(spineY()).toBeCloseTo(0.5, 5);
    rig.cutOnce(FADE_MS);
    for (let i = 0; i < 12; i++) {
      rig.update(FADE_MS / 10, RETURN_MS);
      expect(spineY(), `step ${i}`).toBeCloseTo(0.5, 5);
    }
    expect(rig.clipName).toBe('walk');
    expect(rig.isClipRunning('idle_scratch')).toBe(false);
  });
});
