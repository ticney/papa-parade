import { describe, expect, it } from 'vitest';
import {
  floorContrastProblem,
  reservedHueProblems,
  roomBudgetOf,
} from '../../../tools/assets/roomArt.ts';

const PARRY = '#1F6BFF';
const DODGE = '#F0353D';
const ALERT = '#FFC21A';
const INK = '#2A2140';
const RESERVED = [PARRY, DODGE, ALERT];

/** The linear `baseColorFactor` glTF stores for an sRGB channel triple, 0-255. */
const linearOf = (r: number, g: number, b: number): number[] => [
  ...[r, g, b].map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }),
  1,
];
const solid = (name: string, r: number, g: number, b: number) => ({
  name,
  pbrMetallicRoughness: { baseColorFactor: linearOf(r, g, b) },
});

describe('roomBudgetOf', () => {
  const accessors = [{ count: 36 }, { count: 12 }, { count: 300 }, { count: 9 }];

  it('counts one draw call per primitive and indices / 3 triangles, on visual and prop nodes', () => {
    const json = {
      scenes: [{ nodes: [0, 1] }],
      nodes: [
        { name: 'sofa', mesh: 0 },
        { name: 'PROP_mug_01', mesh: 1 },
      ],
      meshes: [
        {
          primitives: [
            { attributes: { POSITION: 2 }, indices: 0 },
            { attributes: { POSITION: 2 }, indices: 1 },
          ],
        },
        { primitives: [{ attributes: { POSITION: 2 }, indices: 1 }] },
      ],
      accessors,
    };
    expect(roomBudgetOf(json)).toEqual({ drawCalls: 3, triangles: 12 + 4 + 4 });
  });

  it('reaches a mesh that gltfpack moved to an unnamed child', () => {
    const json = {
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'sofa', children: [1] }, { mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 2 }, indices: 0 }] }],
      accessors,
    };
    expect(roomBudgetOf(json)).toEqual({ drawCalls: 1, triangles: 12 });
  });

  it('leaves out what the game never draws, whole subtree', () => {
    const json = {
      scenes: [{ nodes: [0, 2, 3, 4, 5] }],
      nodes: [
        { name: 'COL_sofa', children: [1] },
        { mesh: 0 },
        { name: 'NAV_floor', mesh: 0 },
        { name: 'NAV_block_sofa', mesh: 0 },
        { name: 'ZONE_safe_playpen', mesh: 0 },
        { name: 'ANCHOR_door' },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 2 }, indices: 0 }] }],
      accessors,
    };
    expect(roomBudgetOf(json)).toEqual({ drawCalls: 0, triangles: 0 });
  });

  it('counts positions for a primitive with no indices', () => {
    const json = {
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'sofa', mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 3 } }] }],
      accessors,
    };
    expect(roomBudgetOf(json)).toEqual({ drawCalls: 1, triangles: 3 });
  });
});

describe('reservedHueProblems', () => {
  it('passes a room of neutral and distant colours', () => {
    const json = {
      materials: [solid('teal', 47, 163, 154), solid('cream', 255, 244, 227)],
    };
    expect(reservedHueProblems(json, RESERVED)).toEqual([]);
  });

  it.each([
    ['the parry blue', 31, 107, 255],
    ['the dodge red', 240, 53, 61],
    ['the alert yellow', 255, 194, 26],
  ])('refuses %s', (_label, r, g, b) => {
    const problems = reservedHueProblems({ materials: [solid('bad', r, g, b)] }, RESERVED);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"bad"');
  });

  it('wraps round the hue circle: a hue of 6° is 8° from the dodge red, at 358°', () => {
    const near = solid('near_red', 240, 73, 53); // hue about 6°
    expect(reservedHueProblems({ materials: [near] }, RESERVED)).toHaveLength(1);
  });

  it('allows a reserved hue when it is pale or dark enough', () => {
    const pale = solid('pale_butter', 255, 233, 168); // saturation 0.34
    const dark = solid('dark_blue', 20, 45, 110); // value 0.43
    expect(reservedHueProblems({ materials: [pale, dark] }, RESERVED)).toEqual([]);
  });

  it('reads the linear factor as sRGB: on the edge of the saturation limit', () => {
    // Blue hue, value 1. Saturation 0.604 is refused and 0.58 is not; read as sRGB without the
    // conversion, both linear factors would look far more saturated and both would be refused.
    const atLimit = solid('at_limit', 101, 150, 255);
    const below = solid('below', 107, 154, 255);
    expect(reservedHueProblems({ materials: [atLimit] }, RESERVED)).toHaveLength(1);
    expect(reservedHueProblems({ materials: [below] }, RESERVED)).toEqual([]);
  });

  it('treats a material with no baseColorFactor as white, which is fine', () => {
    expect(reservedHueProblems({ materials: [{ name: 'plain' }] }, RESERVED)).toEqual([]);
  });
});

describe('floorContrastProblem', () => {
  const floorWith = (materials: unknown[], primitives: { material?: number }[]) => ({
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'floor', mesh: 0 }],
    meshes: [{ primitives }],
    materials,
  });

  it('passes a pale floor', () => {
    const json = floorWith([solid('wood', 232, 201, 160)], [{ material: 0 }]);
    expect(floorContrastProblem(json, INK)).toBeNull();
  });

  it('refuses a dark floor and names the material', () => {
    const json = floorWith(
      [solid('wood', 232, 201, 160), solid('rug', 70, 60, 90)],
      [{ material: 0 }, { material: 1 }],
    );
    expect(floorContrastProblem(json, INK)).toContain('"rug"');
  });

  it('judges a linear value on the edge of the threshold', () => {
    // #2A2140 has a luminance of about 0.0195, so 3:1 needs about 0.158: a grey of sRGB 111.
    const passes = floorWith([solid('grey', 112, 112, 112)], [{ material: 0 }]);
    const fails = floorWith([solid('grey', 105, 105, 105)], [{ material: 0 }]);
    expect(floorContrastProblem(passes, INK)).toBeNull();
    expect(floorContrastProblem(fails, INK)).toContain('"grey"');
  });

  it('reads the floor under a child node', () => {
    const json = {
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'floor', children: [1] }, { mesh: 0 }],
      meshes: [{ primitives: [{ material: 0 }] }],
      materials: [solid('dark', 40, 30, 60)],
    };
    expect(floorContrastProblem(json, INK)).toContain('"dark"');
  });

  it('counts a primitive with no material, or no baseColorFactor, as white', () => {
    expect(floorContrastProblem(floorWith([], [{}]), INK)).toBeNull();
    expect(floorContrastProblem(floorWith([{ name: 'plain' }], [{ material: 0 }]), INK)).toBeNull();
  });

  it('says so when there is no floor to read', () => {
    expect(floorContrastProblem({ nodes: [{ name: 'sofa', mesh: 0 }] }, INK)).toContain('floor');
  });
});
