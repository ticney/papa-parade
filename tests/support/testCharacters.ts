import type { CharacterAsset } from '@client/assets/gltf';
import { BABY_CONTRACT, PAPA_CONTRACT } from '@client/render/views/characterClips';
import {
  AnimationClip,
  Bone,
  BoxGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  VectorKeyframeTrack,
} from 'three';

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

export const createTestPapa = (): CharacterAsset => createTestCharacter(PAPA_CONTRACT);
export const createTestBaby = (): CharacterAsset => createTestCharacter(BABY_CONTRACT);
export const createTestCharacters = (): { papa: CharacterAsset; baby: CharacterAsset } => ({
  papa: createTestPapa(),
  baby: createTestBaby(),
});
