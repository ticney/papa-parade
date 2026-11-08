import type { CharacterAsset } from '@client/assets/gltf';
import { BABY_CONTRACT, PAPA_CONTRACT } from '@client/render/views/characterClips';
import { createLifeInputs, type LifeInputs } from '@client/render/views/lifeLayer';
import {
  AnimationClip,
  Bone,
  BoxGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
  VectorKeyframeTrack,
} from 'three';
import { createTestContent } from './testContent.ts';

/** How long each clip of the fixture lasts, in seconds: loops and one-shots alike. */
export const TEST_CLIP_S = 1;

const clipOn = (name: string, firstBone: string): AnimationClip =>
  new AnimationClip(name, TEST_CLIP_S, [
    new VectorKeyframeTrack(`${firstBone}.position`, [0, TEST_CLIP_S], [0, 0, 0, 0, 1, 0]),
    new QuaternionKeyframeTrack(`${firstBone}.quaternion`, [0], [0, 0, 0, 1]),
  ]);

/** A small skinned box with every bone, node and clip of a contract: what the views need of a `.glb`, built in code. */
export function createTestCharacter(contract: {
  readonly bones: readonly string[];
  readonly visibleNodes: readonly string[];
  readonly hiddenNodes: readonly string[];
  readonly clips: readonly string[];
}): CharacterAsset {
  const scene = new Group();
  const bones = contract.bones.map((name) => {
    const bone = new Bone();
    bone.name = name;
    return bone;
  });
  const [root, ...rest] = bones as [Bone, ...Bone[]];
  root.add(...rest);
  scene.add(root);
  scene.updateMatrixWorld(true);
  const skeleton = new Skeleton(bones);
  for (const name of contract.visibleNodes) {
    const geometry = new BoxGeometry(0.1, 0.1, 0.1);
    const count = geometry.getAttribute('position').count;
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(count * 4).fill(0), 4));
    geometry.setAttribute(
      'skinWeight',
      new Float32BufferAttribute(
        new Array(count * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)),
        4,
      ),
    );
    const mesh = new SkinnedMesh(
      geometry,
      new MeshStandardMaterial({ color: new Color(0x6d3fe0) }),
    );
    mesh.name = name;
    mesh.bind(skeleton);
    scene.add(mesh);
  }
  for (const name of contract.hiddenNodes) {
    // As gltfpack leaves it: a named node, with the mesh in a child (story 7.1).
    const node = new Group();
    node.name = name;
    node.add(
      new Mesh(new BoxGeometry(0.05, 0.05, 0.05), new MeshStandardMaterial({ color: 0xffffff })),
    );
    scene.add(node);
  }
  return {
    scene,
    animations: contract.clips.map((name) => clipOn(name, 'spine')),
  };
}

/**
 * Where the lock's root sits on the head in the fixture, in metres: off the head's origin, as in `papa.glb`
 * (about 0.012, 0.315, 0.08), so that a wrong frame or sign in the view's maths shows in a test.
 */
export const TEST_FORELOCK_ROOT_M = [0.012, 0.3, 0.08] as const;

/** Where the forelock's tip rests in the fixture, from the lock's root, in metres: down and forward. */
export const TEST_FORELOCK_TIP_M = [0, -0.04, 0.03] as const;

/**
 * Where `brow_l` rests under `head` in the fixtures, in metres (`brow_r` mirrored in x): `papa.glb`'s and
 * `baby.glb`'s own (story 7.10), so that a wrong frame, mirror or sign in the views' maths fails a test.
 */
export const TEST_PAPA_BROW_REST_M = [0.075, 0.262, 0.115] as const;
export const TEST_BABY_BROW_REST_M = [0.062, 0.187, 0.1] as const;

/**
 * A brow's two ends and its centre, as world points brought into its head's axes (X his left, Y up, Z
 * forward): `inner` is the end nearer the nose (the smaller |x|). `halfLengthM` is half the bar, along the
 * bone's own X. Call `updateMatrixWorld` on the scene first.
 */
export function browEndsInHead(
  head: Object3D,
  brow: Object3D,
  halfLengthM: number,
): { inner: Vector3; outer: Vector3; centre: Vector3 } {
  const inHead = (x: number): Vector3 => head.worldToLocal(brow.localToWorld(new Vector3(x, 0, 0)));
  const a = inHead(halfLengthM);
  const b = inHead(-halfLengthM);
  const isAInner = Math.abs(a.x) < Math.abs(b.x);
  return { inner: isAInner ? a : b, outer: isAInner ? b : a, centre: inHead(0) };
}

/** Puts both brows under the head, at `rest` (his left) and its mirror (his right), as the files have them. */
function placeBrows(asset: CharacterAsset, rest: readonly [number, number, number]): void {
  const head = asset.scene.getObjectByName('head');
  for (const [name, sign] of [
    ['brow_l', 1],
    ['brow_r', -1],
  ] as const) {
    const brow = asset.scene.getObjectByName(name);
    if (head === undefined || brow === undefined) continue;
    head.add(brow);
    brow.position.set(sign * rest[0], rest[1], rest[2]);
  }
  asset.scene.updateMatrixWorld(true);
}

/**
 * As `papa.glb` has it, the steam is the mug's child: it shows and hides with the mug (story 2.13). The
 * forelock hangs from the head and its tip marker from the forelock (story 7.9), as the steam from the mug.
 */
export const createTestPapa = (): CharacterAsset => {
  const asset = createTestCharacter(PAPA_CONTRACT);
  const steam = asset.scene.getObjectByName('papa_mug_steam');
  if (steam !== undefined) asset.scene.getObjectByName('papa_mug')?.add(steam);
  const forelock = asset.scene.getObjectByName('forelock');
  if (forelock !== undefined) {
    asset.scene.getObjectByName('head')?.add(forelock);
    forelock.position.set(...TEST_FORELOCK_ROOT_M);
    const tip = new Group();
    tip.name = 'papa_forelock_tip';
    tip.position.set(...TEST_FORELOCK_TIP_M);
    forelock.add(tip);
  }
  placeBrows(asset, TEST_PAPA_BROW_REST_M);
  // The puffed cheeks ride on the head, as in `papa.glb` (story 7.11, D2).
  const cheeks = asset.scene.getObjectByName('papa_cheeks');
  if (cheeks !== undefined) asset.scene.getObjectByName('head')?.add(cheeks);
  return asset;
};
export const createTestBaby = (): CharacterAsset => {
  const asset = createTestCharacter(BABY_CONTRACT);
  placeBrows(asset, TEST_BABY_BROW_REST_M);
  return asset;
};

/**
 * The life layer's inputs of a frame (story 7.8), on the test feel's `characters` (its own copy: a test
 * may retune it), with `patch` laid over: fatigue 0, no alert, nothing seen, motion not reduced.
 */
export function createTestLife(patch: Partial<LifeInputs> = {}): LifeInputs {
  return Object.assign(
    createLifeInputs(structuredClone(createTestContent().feel.characters)),
    patch,
  );
}
export const createTestCharacters = (): { papa: CharacterAsset; baby: CharacterAsset } => ({
  papa: createTestPapa(),
  baby: createTestBaby(),
});
