import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import { describe, expect, it } from 'vitest';
import { createTestPapa } from '../../../../tests/support/testCharacters.ts';
import { addOutlineHulls, createOutlineKit, weldedNormals } from './outlineHull.ts';

const kitOf = (skipMaterials: string[] = ['art_ink']) =>
  createOutlineKit({ widthM: 0.025, skipMaterials });

function named(name: string): Mesh {
  const material = new MeshBasicMaterial();
  material.name = name;
  return new Mesh(new BoxGeometry(1, 1, 1), material);
}

describe('weldedNormals', () => {
  it('gives each corner of a split-normal cube one averaged normal, on all three copies', () => {
    const welded = weldedNormals(new BoxGeometry(1, 1, 1));
    const position = new BoxGeometry(1, 1, 1).getAttribute('position');
    expect(welded.count).toBe(24);
    const expected = 1 / Math.sqrt(3);
    for (let i = 0; i < welded.count; i++) {
      expect(welded.getX(i)).toBeCloseTo(Math.sign(position.getX(i)) * expected, 5);
      expect(welded.getY(i)).toBeCloseTo(Math.sign(position.getY(i)) * expected, 5);
      expect(welded.getZ(i)).toBeCloseTo(Math.sign(position.getZ(i)) * expected, 5);
    }
  });

  it('reads interleaved attributes (a meshopt file)', () => {
    const geometry = new BufferGeometry();
    const buffer = new InterleavedBuffer(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0]), 6);
    geometry.setAttribute('position', new InterleavedBufferAttribute(buffer, 3, 0));
    geometry.setAttribute('normal', new InterleavedBufferAttribute(buffer, 3, 3));
    const welded = weldedNormals(geometry);
    expect(welded.getX(0)).toBeCloseTo(Math.SQRT1_2, 5);
    expect(welded.getY(1)).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it('keeps its own normal where opposite normals cancel out, never a NaN', () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array([1, 0, 0, -1, 0, 0]), 3));
    const welded = weldedNormals(geometry);
    expect(welded.getX(0)).toBe(1);
    expect(welded.getX(1)).toBe(-1);
  });
});

describe('createOutlineKit', () => {
  it('is one flat back-face material with the depth test on, and the width as a uniform', () => {
    const { material } = kitOf();
    expect(material.side).toBe(BackSide);
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(true);
    expect(material.uniforms.widthM?.value).toBe(0.025);
    // BackSide negates the normal (FLIP_SIDED): a plus would push the hull inward, where it never shows.
    expect(material.vertexShader).toMatch(/mvPosition - vec4\(normalize\(transformedNormal\)/);
  });
});

describe('addOutlineHulls', () => {
  it('adds one hull per mesh, under it, sharing its buffers but not its normals', () => {
    const kit = kitOf();
    const root = new Group();
    const mesh = named('art_skin');
    root.add(mesh);
    addOutlineHulls(root, kit);
    const hull = mesh.children[0] as Mesh;
    expect(hull.material).toBe(kit.material);
    expect(hull.geometry.getAttribute('position')).toBe(mesh.geometry.getAttribute('position'));
    expect(hull.geometry.index).toBe(mesh.geometry.index);
    expect(hull.geometry.getAttribute('normal')).not.toBe(mesh.geometry.getAttribute('normal'));
    expect(hull.position.length()).toBe(0);
    expect(hull.scale.x).toBe(1);
  });

  it('gives no hull to a skipped material', () => {
    const root = new Group();
    const ink = named('art_ink');
    root.add(ink);
    addOutlineHulls(root, kitOf());
    expect(ink.children).toHaveLength(0);
  });

  it('hulls a mesh that is the root itself', () => {
    const root = named('art_skin');
    addOutlineHulls(root, kitOf());
    expect(root.children).toHaveLength(1);
  });

  it('never hulls a hull, even when called twice', () => {
    const kit = kitOf();
    const root = new Group();
    root.add(named('a'), named('b'));
    addOutlineHulls(root, kit);
    let hulls = 0;
    root.traverse((node) => {
      if (node instanceof Mesh && node.material === kit.material) hulls++;
    });
    expect(hulls).toBe(2);
  });

  it('binds a skinned hull to the same skeleton, and never culls it', () => {
    const { scene } = createTestPapa();
    const kit = kitOf([]);
    addOutlineHulls(scene, kit);
    let hulls = 0;
    scene.traverse((node) => {
      if (node instanceof Mesh && node.material === kit.material) {
        const source = node.parent as unknown as { skeleton?: unknown };
        const hull = node as unknown as { skeleton?: unknown; frustumCulled: boolean };
        if (source.skeleton !== undefined) {
          expect(hull.skeleton).toBe(source.skeleton);
          expect(hull.frustumCulled).toBe(false);
          hulls++;
        }
      }
    });
    expect(hulls).toBeGreaterThan(0);
  });
});
