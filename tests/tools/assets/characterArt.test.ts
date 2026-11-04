import { describe, expect, it } from 'vitest';
import {
  CHARACTER_BONES_MAX,
  CHARACTER_DRAW_CALLS_MAX,
  CHARACTER_MATERIALS_MAX,
  CHARACTER_TRIANGLES_MAX,
} from '../../../src/shared/constants.ts';
import {
  type CharacterContract,
  characterBudgetOf,
  characterRigProblems,
} from '../../../tools/assets/characterArt.ts';

const CONTRACT: CharacterContract = {
  bones: ['root', 'eyelids'],
  visibleNodes: ['body'],
  hiddenNodes: ['mug'],
  clips: ['idle'],
  codeDrivenBones: ['eyelids'],
  codeDrivenNodes: ['mug'],
};

/** A small file that conforms: a body of 2 primitives, a hidden mug, a skeleton of 2 bones and one clip. */
function conforming() {
  return {
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'rig', children: [1, 2, 3] },
      { name: 'body', mesh: 0, skin: 0 },
      { name: 'root', children: [4] },
      { name: 'mug', children: [5] },
      { name: 'eyelids' },
      { mesh: 1 },
    ],
    meshes: [
      {
        primitives: [
          { attributes: { POSITION: 0, JOINTS_0: 0, WEIGHTS_0: 0 }, indices: 1, material: 0 },
          { attributes: { POSITION: 0, JOINTS_0: 0, WEIGHTS_0: 0 }, indices: 1, material: 1 },
        ],
      },
      { primitives: [{ attributes: { POSITION: 0 }, indices: 2, material: 0 }] },
    ],
    accessors: [{ count: 8 }, { count: 300 }, { count: 36000 }],
    materials: [
      { name: 'shirt', pbrMetallicRoughness: { baseColorFactor: [0.2, 0.1, 0.7, 1] } },
      { name: 'skin', pbrMetallicRoughness: { baseColorFactor: [0.8, 0.6, 0.5, 1] } },
    ],
    skins: [{ joints: [2, 4] }],
    animations: [{ name: 'idle', channels: [{ target: { node: 2, path: 'rotation' } }] }],
  };
}

describe('characterBudgetOf', () => {
  it('counts the visible primitives and triangles, the bones and the materials', () => {
    expect(characterBudgetOf(conforming(), CONTRACT.hiddenNodes)).toEqual({
      drawCalls: 2,
      triangles: 200,
      bones: 2,
      materials: 2,
    });
  });

  it('counts a node the contract does not hide', () => {
    expect(characterBudgetOf(conforming(), []).triangles).toBe(12200);
  });

  it('refuses a file with no scene and a primitive it cannot count', () => {
    expect(() => characterBudgetOf({}, [])).toThrow(/no scene/);
    const file = conforming();
    (file.meshes[0]?.primitives[0] as { mode?: number }).mode = 5;
    expect(() => characterBudgetOf(file, [])).toThrow(/mode 5/);
  });
});

describe('characterRigProblems', () => {
  it('finds nothing on a file that conforms', () => {
    expect(characterRigProblems(conforming(), CONTRACT)).toEqual([]);
  });

  it('names a missing bone, node and clip', () => {
    expect(characterRigProblems(conforming(), { ...CONTRACT, bones: ['tail'] })).toEqual([
      'no bone "tail" in the skin',
    ]);
    expect(
      characterRigProblems(conforming(), { ...CONTRACT, hiddenNodes: ['mug', 'hat'] }),
    ).toEqual(['no node "hat"']);
    expect(characterRigProblems(conforming(), { ...CONTRACT, clips: ['dance'] })).toEqual([
      'no clip "dance"',
    ]);
  });

  it('refuses a bone that is a node but not in the skin', () => {
    const file = conforming();
    (file.skins[0] as { joints: number[] }).joints = [2];
    expect(characterRigProblems(file, CONTRACT)).toEqual(['no bone "eyelids" in the skin']);
  });

  it('refuses a clip track on a bone the code drives', () => {
    const file = conforming();
    file.animations[0]?.channels.push({ target: { node: 4, path: 'scale' } });
    expect(characterRigProblems(file, CONTRACT)).toEqual([
      'clip "idle" has a scale track on "eyelids", which the code drives',
    ]);
  });

  it('refuses a clip track on a node the code moves', () => {
    const file = conforming();
    file.animations[0]?.channels.push({ target: { node: 3, path: 'translation' } });
    expect(characterRigProblems(file, CONTRACT)).toEqual([
      'clip "idle" has a translation track on "mug", which the code drives',
    ]);
  });

  it('allows a track on a node the code leaves alone', () => {
    const file = conforming();
    file.animations[0]?.channels.push({ target: { node: 3, path: 'translation' } });
    expect(characterRigProblems(file, { ...CONTRACT, codeDrivenNodes: [] })).toEqual([]);
  });

  it('refuses more than 4 influences a vertex', () => {
    const file = conforming();
    (file.meshes[0]?.primitives[0]?.attributes as Record<string, number>).JOINTS_1 = 0;
    expect(characterRigProblems(file, CONTRACT)).toEqual([
      'mesh 0 has JOINTS_1: more than 4 influences a vertex',
    ]);
  });

  it('refuses no skin and a second skin', () => {
    const none = { ...conforming(), skins: [] };
    expect(characterRigProblems(none, { ...CONTRACT, bones: [] })).toEqual([
      '0 skins, exactly 1 expected',
    ]);
    const two = conforming();
    two.skins.push({ joints: [] });
    expect(characterRigProblems(two, CONTRACT)).toEqual(['2 skins, exactly 1 expected']);
  });

  it('refuses a texture, through the rules of a room', () => {
    const file = { ...conforming(), images: [{}] };
    expect(characterRigProblems(file, CONTRACT)).toEqual(['the file holds a texture or an image']);
  });

  it('refuses each count over its budget', () => {
    const drawCalls = conforming();
    const primitive = drawCalls.meshes[0]
      ?.primitives[0] as (typeof drawCalls.meshes)[0]['primitives'][0];
    (drawCalls.meshes[0] as { primitives: unknown[] }).primitives = Array(
      CHARACTER_DRAW_CALLS_MAX + 1,
    ).fill(primitive);
    expect(characterRigProblems(drawCalls, CONTRACT)).toEqual([
      `${CHARACTER_DRAW_CALLS_MAX + 1} draw calls, at most ${CHARACTER_DRAW_CALLS_MAX}`,
    ]);

    const triangles = conforming();
    (triangles.accessors[1] as { count: number }).count = CHARACTER_TRIANGLES_MAX * 3;
    expect(characterRigProblems(triangles, CONTRACT)).toEqual([
      `${CHARACTER_TRIANGLES_MAX * 2} triangles, at most ${CHARACTER_TRIANGLES_MAX}`,
    ]);

    const bones = conforming();
    (bones.skins[0] as { joints: number[] }).joints = [
      2,
      4,
      ...Array(CHARACTER_BONES_MAX - 1).fill(1),
    ];
    expect(characterRigProblems(bones, CONTRACT)).toEqual([
      `${CHARACTER_BONES_MAX + 1} bones, at most ${CHARACTER_BONES_MAX}`,
    ]);

    const materials = conforming();
    (materials as { materials: unknown[] }).materials = Array(CHARACTER_MATERIALS_MAX + 1).fill({
      pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.5, 1] },
    });
    expect(characterRigProblems(materials, CONTRACT)).toEqual([
      `${CHARACTER_MATERIALS_MAX + 1} materials, at most ${CHARACTER_MATERIALS_MAX}`,
    ]);
  });
});
