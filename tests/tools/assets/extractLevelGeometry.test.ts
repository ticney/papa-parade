import { describe, expect, it } from 'vitest';
import { REQUIRED_ANCHOR_IDS } from '../../../src/content/levelNodeNames.ts';
import {
  extractLevelGeometry,
  type GltfJson,
  renderGeometry,
} from '../../../tools/assets/extractLevelGeometry.ts';

// A glTF document built in memory: boxes are meshes whose accessor min/max is the box, placed by
// the node translation. The extractor never reads binary data, so there is none.

interface Spec {
  name: string;
  center?: [number, number, number];
  half?: [number, number, number];
  rotationY?: number;
  scale?: [number, number, number];
  isEmpty?: boolean;
  children?: Spec[];
}

function quaternionY(angleRad: number): [number, number, number, number] {
  return [0, Math.sin(angleRad / 2), 0, Math.cos(angleRad / 2)];
}

function build(specs: Spec[], extra: Partial<GltfJson> = {}): GltfJson {
  const nodes: Record<string, unknown>[] = [];
  const meshes: unknown[] = [];
  const accessors: unknown[] = [];
  const add = (spec: Spec): number => {
    const node: Record<string, unknown> = { name: spec.name };
    if (spec.center) node.translation = spec.center;
    if (spec.rotationY !== undefined) node.rotation = quaternionY(spec.rotationY);
    if (spec.scale) node.scale = spec.scale;
    if (!spec.isEmpty && spec.half) {
      const [hx, hy, hz] = spec.half;
      accessors.push({ min: [-hx, -hy, -hz], max: [hx, hy, hz] });
      meshes.push({ primitives: [{ attributes: { POSITION: accessors.length - 1 } }] });
      node.mesh = meshes.length - 1;
    }
    const index = nodes.push(node) - 1;
    if (spec.children) node.children = spec.children.map(add);
    return index;
  };
  const roots = specs.map(add);
  return { scene: 0, scenes: [{ nodes: roots }], nodes, meshes, accessors, ...extra } as GltfJson;
}

const anchor = (id: string, x: number, z: number, y = 0): Spec => ({
  name: `ANCHOR_${id}`,
  center: [x, y, z],
  isEmpty: true,
});

/** An 8 x 6 m floor with a 2 x 1 m sofa block, every required anchor and the hidden zone. */
function goodSpecs(): Spec[] {
  const positions: Record<string, [number, number]> = {
    papa_spawn: [3, 2],
    baby_spawn: [-1, 2],
    outlet_01: [-3.9, 0.5],
    stairs_top: [3.9, -1],
    coffee_table: [0, 0],
    phone: [-2, -1],
    coffee_machine: [-3.5, -2],
    door: [3, -2.9],
  };
  return [
    { name: 'floor', center: [0, -0.05, 0], half: [4, 0.05, 3] },
    { name: 'NAV_floor', center: [0, -0.05, 0], half: [4, 0.05, 3] },
    { name: 'sofa', center: [0, 0.45, -1.5], half: [1, 0.45, 0.5] },
    { name: 'COL_sofa', center: [0, 0.45, -1.5], half: [1, 0.45, 0.5] },
    { name: 'NAV_block_sofa', center: [0, 0.45, -1.5], half: [1, 0.45, 0.5] },
    { name: 'ZONE_hidden_behind_sofa', center: [0, 0.5, -2.5], half: [1, 0.5, 0.4] },
    { name: 'PROP_mug_01', center: [0.123456, 0.5, 0], half: [0.05, 0.05, 0.05] },
    ...REQUIRED_ANCHOR_IDS.map((id) => anchor(id, ...(positions[id] as [number, number]))),
  ];
}

const extract = (gltf: GltfJson) => extractLevelGeometry(gltf, { id: 'test_room', cellM: 0.25 });

function errorsOf(gltf: GltfJson): string[] {
  const result = extract(gltf);
  return result.ok ? [] : result.error;
}

function withSpecs(change: (specs: Spec[]) => Spec[]): GltfJson {
  return build(change(goodSpecs()));
}

describe('extractLevelGeometry', () => {
  it('extracts colliders, anchors, zones, props and bounds from a good level', () => {
    const result = extract(build(goodSpecs()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const level = result.value;
    expect(level.id).toBe('test_room');
    expect(level.boundsMinM).toEqual([-4, -0.1, -3]);
    expect(level.boundsMaxM).toEqual([4, 0.9, 3]);
    expect(level.colliders).toEqual([
      { id: 'sofa', centerM: [0, 0.45, -1.5], halfExtentsM: [1, 0.45, 0.5] },
    ]);
    expect(level.zones).toEqual([
      { id: 'behind_sofa', kind: 'hidden', centerM: [0, 0.5, -2.5], halfExtentsM: [1, 0.5, 0.4] },
    ]);
    // Rounded to 1 mm.
    expect(level.props).toEqual([
      { id: 'mug_01', kind: 'mug', centerM: [0.123, 0.5, 0], halfExtentsM: [0.05, 0.05, 0.05] },
    ]);
    expect(level.anchors.map((a) => a.id)).toEqual([...REQUIRED_ANCHOR_IDS].sort());
    expect(level.anchors.find((a) => a.id === 'door')?.positionM).toEqual([3, 0, -2.9]);
  });

  it('marks cells walkable by their centre, half-open, from the floor minus the blocks', () => {
    const result = extract(build(goodSpecs()));
    if (!result.ok) throw new Error(result.error.join('; '));
    const { nav } = result.value;
    expect(nav.originM).toEqual([-4, -3]);
    expect(nav.cols).toBe(32);
    expect(nav.rowCount).toBe(24);
    expect(nav.rows).toHaveLength(24);
    // Sofa: x in [-1, 1) and z in [-2, -1) -> columns 12..19, rows 4..7.
    expect(nav.rows[3]).toBe('1'.repeat(32));
    expect(nav.rows[4]).toBe(`${'1'.repeat(12)}${'0'.repeat(8)}${'1'.repeat(12)}`);
    expect(nav.rows[7]).toBe(`${'1'.repeat(12)}${'0'.repeat(8)}${'1'.repeat(12)}`);
    expect(nav.rows[8]).toBe('1'.repeat(32));
  });

  it('sorts every list by id and gives the same text twice', () => {
    const reversed = withSpecs((specs) => [...specs].reverse());
    const a = extract(build(goodSpecs()));
    const b = extract(reversed);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(renderGeometry(a.value)).toBe(renderGeometry(b.value));
  });

  it('renders vectors on one line and ends with a newline', () => {
    const result = extract(build(goodSpecs()));
    if (!result.ok) throw new Error('unexpected');
    const text = renderGeometry(result.value);
    expect(text).toContain('"boundsMinM": [-4, -0.1, -3],');
    expect(text.endsWith('}\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(result.value);
  });

  it('applies a parent transform to its children', () => {
    const gltf = withSpecs((specs) => [
      ...specs.filter((s) => s.name !== 'COL_sofa'),
      {
        name: 'group',
        center: [1, 0, 0],
        isEmpty: true,
        children: [{ name: 'COL_sofa', center: [0, 0.45, -1.5], half: [1, 0.45, 0.5] }],
      },
    ]);
    const result = extract(gltf);
    if (!result.ok) throw new Error(result.error.join('; '));
    expect(result.value.colliders[0]?.centerM).toEqual([1, 0.45, -1.5]);
  });

  it('accepts a rotation of 90° about Y and swaps the extents', () => {
    const gltf = withSpecs((specs) =>
      specs.map((s) => (s.name === 'COL_sofa' ? { ...s, rotationY: Math.PI / 2 } : s)),
    );
    const result = extract(gltf);
    if (!result.ok) throw new Error(result.error.join('; '));
    expect(result.value.colliders[0]?.halfExtentsM).toEqual([0.5, 0.45, 1]);
  });

  describe('refusals, each naming the node', () => {
    it('a name that breaks a prefix shape', () => {
      expect(
        errorsOf(
          withSpecs((s) => [...s, { name: 'col_chair', center: [0, 0, 0], half: [1, 1, 1] }]),
        ),
      ).toEqual([expect.stringContaining('"col_chair"')]);
    });

    it('a duplicate id', () => {
      const found = errorsOf(
        withSpecs((s) => [...s, { name: 'COL_sofa', center: [3, 0.5, 0], half: [0.2, 0.2, 0.2] }]),
      );
      expect(found).toEqual([expect.stringContaining('duplicate id "sofa"')]);
    });

    it('no NAV_floor, and two of them', () => {
      expect(errorsOf(withSpecs((s) => s.filter((n) => n.name !== 'NAV_floor')))).toContain(
        'expected exactly one NAV_floor, found 0',
      );
      expect(
        errorsOf(
          withSpecs((s) => [
            ...s,
            { name: 'NAV_floor', center: [0, -0.05, 0], half: [4, 0.05, 3] },
          ]),
        ).some((m) => m.includes('duplicate') || m.includes('found 2')),
      ).toBe(true);
    });

    it.each(REQUIRED_ANCHOR_IDS)('a missing required anchor: %s', (id) => {
      const found = errorsOf(withSpecs((s) => s.filter((n) => n.name !== `ANCHOR_${id}`)));
      expect(found.some((m) => m.includes(`ANCHOR_${id}`))).toBe(true);
    });

    it('a missing required zone', () => {
      expect(errorsOf(withSpecs((s) => s.filter((n) => !n.name.startsWith('ZONE_'))))).toEqual([
        expect.stringContaining('behind_sofa'),
      ]);
    });

    it('a box rotated by 45° about Y', () => {
      const found = errorsOf(
        withSpecs((s) =>
          s.map((n) => (n.name === 'COL_sofa' ? { ...n, rotationY: Math.PI / 4 } : n)),
        ),
      );
      expect(found).toEqual([expect.stringContaining('"COL_sofa"')]);
    });

    it('a non-uniform scale and a negative scale', () => {
      const stretched = errorsOf(
        withSpecs((s) => s.map((n) => (n.name === 'COL_sofa' ? { ...n, scale: [1, 2, 1] } : n))),
      );
      expect(stretched).toEqual([expect.stringContaining('non-uniform scale')]);
      const mirrored = errorsOf(
        withSpecs((s) => s.map((n) => (n.name === 'COL_sofa' ? { ...n, scale: [-1, 1, 1] } : n))),
      );
      expect(mirrored).toEqual([expect.stringContaining('negative scale')]);
    });

    it('a collider without a mesh', () => {
      const found = errorsOf(
        withSpecs((s) =>
          s.map((n) => (n.name === 'COL_sofa' ? { name: n.name, isEmpty: true } : n)),
        ),
      );
      expect(found).toEqual([expect.stringContaining('"COL_sofa"')]);
    });

    it('a floor that does not rest at y = 0', () => {
      const found = errorsOf(
        withSpecs((s) =>
          s.map((n) =>
            n.name === 'NAV_floor' ? { ...n, center: [0, 0.2, 0] as [number, number, number] } : n,
          ),
        ),
      );
      expect(found).toEqual([expect.stringContaining('rest at y = 0')]);
    });

    it('a level with no visual mesh', () => {
      expect(
        errorsOf(withSpecs((s) => s.filter((n) => n.name !== 'floor' && n.name !== 'sofa'))),
      ).toEqual([expect.stringContaining('no visual mesh')]);
    });

    it('a file already optimised by gltfpack', () => {
      const found = errorsOf(build(goodSpecs(), { extensionsUsed: ['EXT_meshopt_compression'] }));
      expect(found).toEqual([expect.stringContaining('re-export from Blender first')]);
    });

    it('collects several problems instead of stopping at the first', () => {
      const found = errorsOf(
        withSpecs((s) =>
          s
            .filter((n) => n.name !== 'ANCHOR_door' && n.name !== 'ANCHOR_phone')
            .concat({ name: 'Bad Name', center: [0, 0, 0], half: [1, 1, 1] }),
        ),
      );
      expect(found.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('reachability', () => {
    it('refuses an anchor with no walkable cell within a metre', () => {
      const found = errorsOf(
        withSpecs((s) =>
          s.map((n) =>
            n.name === 'ANCHOR_door' ? { ...n, center: [20, 0, 0] as [number, number, number] } : n,
          ),
        ),
      );
      expect(found.some((m) => m.includes('"ANCHOR_door"') && m.includes('within'))).toBe(true);
    });

    it('refuses a spawn that stands on a blocked cell', () => {
      const found = errorsOf(
        withSpecs((s) =>
          s.map((n) =>
            n.name === 'ANCHOR_baby_spawn'
              ? { ...n, center: [0, 0, -1.5] as [number, number, number] }
              : n,
          ),
        ),
      );
      expect(found).toEqual([
        expect.stringContaining('"ANCHOR_baby_spawn": must stand on a walkable cell'),
      ]);
    });

    it('refuses an anchor that sits in a walled-off pocket', () => {
      // A ring of blocks around (-3, 2) cuts the pocket from the rest of the floor.
      const ring: Spec[] = [
        { name: 'NAV_block_ring_n', center: [-3, 0, 1.0], half: [1.2, 0.2, 0.25] },
        { name: 'NAV_block_ring_s', center: [-3, 0, 2.9], half: [1.2, 0.2, 0.25] },
        { name: 'NAV_block_ring_w', center: [-3.9, 0, 2], half: [0.25, 0.2, 1.0] },
        { name: 'NAV_block_ring_e', center: [-2.1, 0, 2], half: [0.25, 0.2, 1.0] },
      ];
      const gltf = withSpecs((s) => [
        ...s.map((n) =>
          n.name === 'ANCHOR_phone' ? { ...n, center: [-3, 0, 2] as [number, number, number] } : n,
        ),
        ...ring,
      ]);
      const found = errorsOf(gltf);
      expect(found).toEqual([expect.stringContaining('"ANCHOR_phone": cannot be reached')]);
    });
  });
});
