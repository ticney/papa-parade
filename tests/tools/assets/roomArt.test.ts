import { describe, expect, it } from 'vitest';
import {
  ROOM_DRAW_CALLS_MAX,
  ROOM_MATERIALS_MAX,
  ROOM_TRIANGLES_MAX,
} from '../../../src/shared/constants.ts';
import {
  floorContrastProblem,
  floorLightOf,
  reservedHueProblems,
  roomBudgetOf,
  roomMaterialProblems,
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

  it('goes over the room limits when a room has too many primitives or triangles', () => {
    const primitives = Array.from({ length: ROOM_DRAW_CALLS_MAX + 1 }, () => ({
      attributes: { POSITION: 2 },
      indices: 0,
    }));
    const json = {
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'sofa', mesh: 0 }],
      meshes: [{ primitives }],
      accessors: [{ count: 3 * ROOM_TRIANGLES_MAX }],
    };
    const budget = roomBudgetOf(json);
    expect(budget.drawCalls).toBeGreaterThan(ROOM_DRAW_CALLS_MAX);
    expect(budget.triangles).toBeGreaterThan(ROOM_TRIANGLES_MAX);
  });

  it('leaves out a node that looks like gameplay even when its name is malformed', () => {
    const json = {
      scenes: [{ nodes: [0, 1, 2] }],
      nodes: [
        { name: 'COL_', mesh: 0 },
        { name: 'zone_hidden', mesh: 0 },
        { name: 'sofa', mesh: 0 },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 2 }, indices: 0 }] }],
      accessors,
    };
    expect(roomBudgetOf(json)).toEqual({ drawCalls: 1, triangles: 12 });
  });

  it('counts a drawn child under a hidden parent as hidden with it', () => {
    const json = {
      scenes: [{ nodes: [0] }],
      nodes: [
        { name: 'COL_sofa', children: [1] },
        { name: 'cushion', mesh: 0 },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 2 }, indices: 0 }] }],
      accessors,
    };
    expect(roomBudgetOf(json)).toEqual({ drawCalls: 0, triangles: 0 });
  });

  it.each([
    ['no scene to start from', { nodes: [{ name: 'sofa', mesh: 0 }] }],
    [
      'an accessor that does not exist',
      {
        scenes: [{ nodes: [0] }],
        nodes: [{ name: 'sofa', mesh: 0 }],
        meshes: [{ primitives: [{ indices: 9 }] }],
      },
    ],
    [
      'a primitive that is not a list of triangles',
      {
        scenes: [{ nodes: [0] }],
        nodes: [{ name: 'sofa', mesh: 0 }],
        meshes: [{ primitives: [{ indices: 0, mode: 5 }] }],
        accessors: [{ count: 30 }],
      },
    ],
    [
      'a count that is not whole triangles',
      {
        scenes: [{ nodes: [0] }],
        nodes: [{ name: 'sofa', mesh: 0 }],
        meshes: [{ primitives: [{ indices: 0 }] }],
        accessors: [{ count: 10 }],
      },
    ],
  ])('refuses %s rather than under-count it', (_label, json) => {
    expect(() => roomBudgetOf(json)).toThrow();
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

  it('wraps round the hue circle: a hue of 6.4° is 9° from the dodge red, at 357.4°', () => {
    const near = solid('near_red', 240, 73, 53);
    expect(reservedHueProblems({ materials: [near] }, RESERVED)).toHaveLength(1);
  });

  it('cuts at 15° of hue', () => {
    // Against a pure red (hue 0), a green channel of 63 gives 14.8° and 65 gives 15.3°.
    const inside = solid('inside', 255, 63, 0);
    const outside = solid('outside', 255, 65, 0);
    expect(reservedHueProblems({ materials: [inside] }, ['#FF0000'])).toHaveLength(1);
    expect(reservedHueProblems({ materials: [outside] }, ['#FF0000'])).toEqual([]);
  });

  it('names a material with no name by its index', () => {
    const unnamed = { pbrMetallicRoughness: { baseColorFactor: linearOf(31, 107, 255) } };
    expect(
      reservedHueProblems({ materials: [solid('fine', 255, 255, 255), unnamed] }, RESERVED)[0],
    ).toContain('"#1"');
  });

  it.each(['#16F', 'rgb(31,107,255)', '1F6BFF', 'parry'])('refuses the colour %s', (hex) => {
    expect(() => reservedHueProblems({ materials: [] }, [hex])).toThrow();
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

describe('floorLightOf', () => {
  const WHITE_ROW = {
    ambientColor: '#FFFFFF',
    ambientIntensity: 1.1,
    sunColor: '#FFFFFF',
    sunIntensity: 2.04,
  };

  it('draws a sun-facing floor as authored when ambient + sun = pi', () => {
    const [r, g, b] = floorLightOf(WHITE_ROW, [96, 178, 255], [3, 9, 5]);
    expect(r).toBeCloseTo(1, 2);
    expect(g).toBeCloseTo(1, 2);
    expect(b).toBeCloseTo(1, 2);
  });

  it('reads the ramp like the shader: a low sun puts the floor one band down', () => {
    const [r] = floorLightOf(WHITE_ROW, [96, 178, 255], [9, 1, 0]);
    expect(r).toBeCloseTo((1.1 + (2.04 * 178) / 255) / Math.PI, 5);
  });
});

describe('floorContrastProblem', () => {
  it('judges the floor under a light, leaving out what is not walkable', () => {
    const json = floorWith(
      [
        { name: 'plank', pbrMetallicRoughness: { baseColorFactor: [0.6, 0.6, 0.6, 1] } },
        { name: 'slab', pbrMetallicRoughness: { baseColorFactor: [0.2, 0.2, 0.2, 1] } },
      ],
      [{ material: 0 }, { material: 1 }],
    );
    const dim = [0.5, 0.5, 0.5] as const;
    expect(floorContrastProblem(json, INK, dim)).toContain('"slab"');
    expect(floorContrastProblem(json, INK, dim, ['slab'])).toBeNull();
    expect(floorContrastProblem(json, INK, [0.05, 0.05, 0.05], ['slab'])).toContain('"plank"');
  });

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
    // #2A2140 has a luminance of about 0.0195, so 3:1 needs about 0.158: a grey of sRGB 111 gives
    // 3.007:1 and 110 gives 2.98:1. Read without the linear conversion, both would look far darker.
    const passes = floorWith([solid('grey', 111, 111, 111)], [{ material: 0 }]);
    const fails = floorWith([solid('grey', 110, 110, 110)], [{ material: 0 }]);
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

  it.each(['#FFF', 'ink', '2A2140'])('refuses the ink %s', (ink) => {
    const json = floorWith([solid('wood', 232, 201, 160)], [{ material: 0 }]);
    expect(() => floorContrastProblem(json, ink)).toThrow();
  });
});

describe('roomMaterialProblems', () => {
  const room = (extra: Record<string, unknown>) => ({
    materials: [solid('wood', 232, 201, 160)],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0 }] }],
    ...extra,
  });

  it('passes a room of a few base-colour materials', () => {
    expect(roomMaterialProblems(room({}))).toEqual([]);
  });

  it('allows exactly the cap and refuses one more', () => {
    const materials = (count: number) =>
      Array.from({ length: count }, (_, index) => solid(`m${index}`, 200, 200, 200));
    expect(roomMaterialProblems(room({ materials: materials(ROOM_MATERIALS_MAX) }))).toEqual([]);
    expect(
      roomMaterialProblems(room({ materials: materials(ROOM_MATERIALS_MAX + 1) })),
    ).toHaveLength(1);
  });

  it.each([
    ['an image', { images: [{}] }],
    ['a texture', { textures: [{}] }],
    [
      'a base colour texture',
      { materials: [{ name: 'm', pbrMetallicRoughness: { baseColorTexture: {} } }] },
    ],
    ['a normal texture', { materials: [{ name: 'm', normalTexture: {} }] }],
    ['an emissive colour', { materials: [{ name: 'm', emissiveFactor: [0, 0.5, 0] }] }],
    ['a blend mode', { materials: [{ name: 'm', alphaMode: 'BLEND' }] }],
    [
      'a translucent colour',
      { materials: [{ name: 'm', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 0.5] } }] },
    ],
    [
      'a vertex colour',
      { meshes: [{ primitives: [{ attributes: { POSITION: 0, COLOR_0: 2 } }] }] },
    ],
    [
      'a second UV set',
      { meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_1: 2 } }] }] },
    ],
  ])('refuses %s', (_label, extra) => {
    expect(roomMaterialProblems(room(extra))).toHaveLength(1);
  });

  it('accepts an emissive factor of zero and an opaque alpha mode', () => {
    const materials = [{ name: 'm', alphaMode: 'OPAQUE', emissiveFactor: [0, 0, 0] }];
    expect(roomMaterialProblems(room({ materials }))).toEqual([]);
  });
});
