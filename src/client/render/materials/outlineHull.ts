import type { FeedbackTable } from '@content/schemas/feedback';
import { log } from '@shared/log';
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  type Material,
  Mesh,
  type Object3D,
  ShaderMaterial,
  SkinnedMesh,
} from 'three';
import { PALETTE } from './palette.ts';

// The hull's vertex stage (story 7.3, D3). Three's chunks read the skinned position and normal, and
// are guarded by `USE_SKINNING`, so one source serves a prop as well as a character. The push is in
// view space and in metres: gltfpack leaves a node scale near 6e-5, which an object-space push would
// shrink to nothing, and the camera is orthographic, so metres are constant on screen. The minus is
// deliberate: `BackSide` defines `FLIP_SIDED`, which negates `transformedNormal`.
const VERTEX_SHADER = /* glsl */ `
uniform float widthM;
#include <common>
#include <skinning_pars_vertex>
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  gl_Position = projectionMatrix * (mvPosition - vec4(normalize(transformedNormal).xy * widthM, 0.0, 0.0));
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform vec3 inkColor;
void main() {
  gl_FragColor = vec4(inkColor, 1.0);
  #include <colorspace_fragment>
}
`;

/**
 * Normals averaged over the vertices at the same position (D4): a hard edge splits its normals, and
 * a hull pushed along split normals opens at each split. Compares the stored values, integers in a
 * quantised file, through `getX`, which also reads interleaved attributes. Pure.
 */
export function weldedNormals(geometry: BufferGeometry): BufferAttribute {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const summed = new Map<string, [number, number, number]>();
  const keys: string[] = [];
  for (let i = 0; i < position.count; i++) {
    const key = `${position.getX(i)},${position.getY(i)},${position.getZ(i)}`;
    keys.push(key);
    let sum = summed.get(key);
    if (sum === undefined) {
      sum = [0, 0, 0];
      summed.set(key, sum);
    }
    sum[0] += normal.getX(i);
    sum[1] += normal.getY(i);
    sum[2] += normal.getZ(i);
  }
  const welded = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const [x, y, z] = summed.get(keys[i] as string) as [number, number, number];
    const length = Math.hypot(x, y, z);
    // Opposite normals cancel out: the vertex keeps its own, a crack rather than a NaN.
    welded[i * 3] = length > 0 ? x / length : normal.getX(i);
    welded[i * 3 + 1] = length > 0 ? y / length : normal.getY(i);
    welded[i * 3 + 2] = length > 0 ? z / length : normal.getZ(i);
  }
  return new BufferAttribute(welded, 3);
}

/** A hull's geometry: its source's buffers, shared, and its own welded normals. */
function hullGeometryOf(source: BufferGeometry): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setIndex(source.index);
  geometry.setAttribute('position', source.getAttribute('position'));
  geometry.setAttribute('normal', weldedNormals(source));
  if (source.hasAttribute('skinIndex')) {
    geometry.setAttribute('skinIndex', source.getAttribute('skinIndex'));
    geometry.setAttribute('skinWeight', source.getAttribute('skinWeight'));
  }
  geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
  geometry.boundingBox = source.boundingBox?.clone() ?? null;
  return geometry;
}

export interface OutlineKit {
  /**
   * The material of `mesh`'s hull: flat ink, drawn on its back faces, depth test and write on. Two
   * materials share the same uniforms, one for skinned meshes and one for the others: three decides
   * `USE_SKINNING` per draw, and a material that alternates between the two would take the program
   * path again at each switch.
   */
  materialFor(mesh: Mesh): ShaderMaterial;
  /** Whether `material` is one of the kit's two hull materials. */
  isHull(material: Material | Material[]): boolean;
  /** The materials that get no hull (`feedback.json › render.outlines.skipMaterials`). */
  isSkipped(materialName: string): boolean;
  dispose(): void;
}

export function createOutlineKit(outlines: FeedbackTable['render']['outlines']): OutlineKit {
  const uniforms = {
    widthM: { value: outlines.widthM },
    inkColor: { value: new Color(PALETTE.ink) },
  };
  const hullMaterial = (name: string): ShaderMaterial =>
    new ShaderMaterial({
      name,
      uniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      side: BackSide,
      depthTest: true,
      depthWrite: true,
    });
  const skinnedMaterial = hullMaterial('outline_hull_skinned');
  const staticMaterial = hullMaterial('outline_hull_static');
  const skipped = new Set(outlines.skipMaterials);
  return {
    materialFor: (mesh) => (mesh instanceof SkinnedMesh ? skinnedMaterial : staticMaterial),
    isHull: (material) => material === skinnedMaterial || material === staticMaterial,
    isSkipped: (materialName) => skipped.has(materialName),
    dispose: () => {
      skinnedMaterial.dispose();
      staticMaterial.dispose();
    },
  };
}

function nameOf(material: Material | Material[]): string {
  return (Array.isArray(material) ? material[0]?.name : material.name) ?? '';
}

/**
 * One ink hull on `mesh`, as its child with no transform of its own: it takes the mesh's node scale and
 * the squash above it, and hiding the mesh or any named node above it hides both.
 */
function addHull(mesh: Mesh, kit: OutlineKit): void {
  if (!mesh.geometry.hasAttribute('normal')) {
    log.warn('render', 'a mesh has no normals: it gets no outline hull', { name: mesh.name });
    return;
  }
  const geometry = hullGeometryOf(mesh.geometry);
  const material = kit.materialFor(mesh);
  let hull: Mesh;
  if (mesh instanceof SkinnedMesh) {
    const skinned = new SkinnedMesh(geometry, material);
    skinned.bind(mesh.skeleton, mesh.bindMatrix);
    skinned.bindMode = mesh.bindMode;
    // Three's bounds are the rest pose's, and a clip can leave them (like the mesh itself, story 7.2).
    skinned.frustumCulled = false;
    hull = skinned;
  } else {
    hull = new Mesh(geometry, material);
  }
  hull.name = `outline_${mesh.name}`;
  mesh.add(hull);
}

/**
 * Gives every mesh under `root` an ink hull, except those of a skipped material and those that
 * already have one (a second call adds nothing). Call it **before** the toon swap, which loses the
 * material's name. Collects first: adding during `traverse` would hull the hulls.
 */
export function addOutlineHulls(root: Object3D, kit: OutlineKit): void {
  const meshes: Mesh[] = [];
  root.traverse((node) => {
    if (!(node instanceof Mesh) || kit.isHull(node.material)) return;
    if (node.children.some((child) => child instanceof Mesh && kit.isHull(child.material))) return;
    if (!kit.isSkipped(nameOf(node.material))) meshes.push(node);
  });
  for (const mesh of meshes) addHull(mesh, kit);
}
