// What a shipped character may be, read from the JSON chunk of its .glb (story 7.2, D4 and D10): its
// budget and the names the code relies on. Pure, no Blender: `tests/architecture/characterAssets.test.ts`
// runs them on the committed files. The colour rules are `roomArt.ts`'s, with a maximum of its own.
import {
  CHARACTER_BONES_MAX,
  CHARACTER_DRAW_CALLS_MAX,
  CHARACTER_MATERIALS_MAX,
  CHARACTER_TRIANGLES_MAX,
} from '@shared/constants';
import { roomMaterialProblems } from './roomArt.ts';

/** glTF's `mode` for a list of triangles, the only one the budget counts. */
const TRIANGLES_MODE = 4;
/** A second set of joints is a vertex with more than 4 influences (D10). */
const EXTRA_INFLUENCES = /^(JOINTS|WEIGHTS)_[1-9]\d*$/;
/** How far a joint's rest quaternion or scale may stand off the identity: float noise, not a turn (story 7.9). */
const REST_EPSILON = 1e-4;
const IDENTITY_ROTATION: readonly number[] = [0, 0, 0, 1];
const UNIT_SCALE: readonly number[] = [1, 1, 1];

interface CharacterPrimitive {
  attributes?: Record<string, number>;
  indices?: number;
  mode?: number;
}
interface CharacterNode {
  name?: string;
  mesh?: number;
  children?: number[];
  rotation?: number[];
  scale?: number[];
  /** A node written as a matrix has no TRS to read its rest from: refused on a bone (story 7.9 review). */
  matrix?: number[];
}
interface CharacterAnimation {
  name?: string;
  channels?: { target?: { node?: number; path?: string } }[];
}
interface CharacterJson {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: CharacterNode[];
  meshes?: { primitives?: CharacterPrimitive[] }[];
  accessors?: { count?: number }[];
  materials?: unknown[];
  skins?: { joints?: number[] }[];
  animations?: CharacterAnimation[];
}

export interface CharacterBudget {
  drawCalls: number;
  triangles: number;
  bones: number;
  materials: number;
}

/** The names the game looks up in one character's file (`characterClips.ts` lists them). */
export interface CharacterContract {
  readonly bones: readonly string[];
  /** Nodes the view shows and hides by name, drawn when nothing is asked. */
  readonly visibleNodes: readonly string[];
  /** Nodes hidden by the view until asked for: glTF has no hidden flag, so the budget needs the list. */
  readonly hiddenNodes: readonly string[];
  readonly clips: readonly string[];
  /** Bones the code writes every frame: a clip with a track on one would fight it (D4). */
  readonly codeDrivenBones: readonly string[];
  /** Nodes (objects, not bones) the code moves every frame: a clip track on one would fight it (story 2.13, D3). */
  readonly codeDrivenNodes: readonly string[];
  /** Empty nodes the code reads a place from (story 7.9: the forelock's tip): no mesh, never drawn. */
  readonly markerNodes: readonly string[];
}

/** Whether `values` (absent: the glTF default) is `expected` within `REST_EPSILON`. */
const isRestAt = (values: readonly number[] | undefined, expected: readonly number[]): boolean =>
  values === undefined ||
  expected.every((value, i) => Math.abs((values[i] ?? Number.NaN) - value) <= REST_EPSILON);

function trianglesOf(json: CharacterJson, primitive: CharacterPrimitive, where: string): number {
  if (primitive.mode !== undefined && primitive.mode !== TRIANGLES_MODE) {
    throw new Error(`${where}: primitive mode ${primitive.mode} is not a list of triangles`);
  }
  const accessor = primitive.indices ?? primitive.attributes?.POSITION;
  const count = accessor === undefined ? undefined : json.accessors?.[accessor]?.count;
  if (count === undefined) throw new Error(`${where}: a primitive has no accessor to count`);
  return count / 3;
}

/**
 * One draw call per primitive and `indices.count / 3` triangles over the nodes that are drawn when
 * nothing is asked of the character: a node of `hiddenNodes` and all under it cost nothing (D10).
 */
export function characterBudgetOf(
  document: unknown,
  hiddenNodes: readonly string[],
): CharacterBudget {
  const json = document as CharacterJson;
  const roots = json.scenes?.[json.scene ?? 0]?.nodes;
  if (roots === undefined) throw new Error('characterBudgetOf: the file has no scene with nodes');
  const budget: CharacterBudget = {
    drawCalls: 0,
    triangles: 0,
    bones: Math.max(0, ...(json.skins ?? []).map((skin) => skin.joints?.length ?? 0)),
    materials: json.materials?.length ?? 0,
  };
  const visit = (index: number): void => {
    const node = json.nodes?.[index];
    if (node === undefined || hiddenNodes.includes(node.name ?? '')) return;
    const primitives = node.mesh === undefined ? [] : (json.meshes?.[node.mesh]?.primitives ?? []);
    for (const primitive of primitives) {
      budget.drawCalls += 1;
      budget.triangles += trianglesOf(json, primitive, `node ${index} "${node.name ?? ''}"`);
    }
    for (const child of node.children ?? []) visit(child);
  };
  for (const root of roots) visit(root);
  return budget;
}

/** The budget of D10 on one character, one message per count over its limit. */
function budgetProblems(budget: CharacterBudget): string[] {
  const limits: readonly (readonly [string, number, number])[] = [
    ['draw calls', budget.drawCalls, CHARACTER_DRAW_CALLS_MAX],
    ['triangles', budget.triangles, CHARACTER_TRIANGLES_MAX],
    ['bones', budget.bones, CHARACTER_BONES_MAX],
  ];
  return limits.flatMap(([label, count, max]) =>
    count > max ? [`${count} ${label}, at most ${max}`] : [],
  );
}

/**
 * Every way the file breaks the rules of D4 and D10 or the `contract`, one message each: a missing
 * bone, node, marker or clip, a clip track on a bone the code drives, more than 4 influences, one skeleton
 * only, a texture or a material the toon swap would lose, a count over its budget, a marker with a mesh,
 * a bone that does not rest at the identity (story 7.9: the code's axes and absolute writes rely on it).
 * Empty when it conforms.
 */
export function characterRigProblems(document: unknown, contract: CharacterContract): string[] {
  const json = document as CharacterJson;
  const nodes = json.nodes ?? [];
  const animations = json.animations ?? [];
  const problems = [
    ...budgetProblems(characterBudgetOf(document, contract.hiddenNodes)),
    ...roomMaterialProblems(document, CHARACTER_MATERIALS_MAX),
  ];
  if ((json.skins?.length ?? 0) !== 1) {
    problems.push(`${json.skins?.length ?? 0} skins, exactly 1 expected`);
  }
  const jointNodes = (json.skins?.[0]?.joints ?? []).map((index) => nodes[index]);
  const joints = new Set(jointNodes.map((node) => node?.name));
  for (const bone of contract.bones) {
    if (!joints.has(bone)) problems.push(`no bone "${bone}" in the skin`);
  }
  for (const joint of jointNodes) {
    if (joint === undefined) continue;
    if (joint.matrix !== undefined) {
      problems.push(
        `bone "${joint.name ?? ''}" is written as a matrix: its rest cannot be checked, write a translation only`,
      );
      continue;
    }
    if (!isRestAt(joint.rotation, IDENTITY_ROTATION)) {
      problems.push(
        `bone "${joint.name ?? ''}" rests with a rotation: every bone rests at the identity`,
      );
    }
    if (!isRestAt(joint.scale, UNIT_SCALE)) {
      problems.push(`bone "${joint.name ?? ''}" rests with a scale: every bone rests at scale 1`);
    }
  }
  const names = new Set(nodes.map((node) => node.name));
  for (const name of [...contract.visibleNodes, ...contract.hiddenNodes]) {
    if (!names.has(name)) problems.push(`no node "${name}"`);
  }
  for (const name of contract.markerNodes) {
    const marker = nodes.find((node) => node.name === name);
    if (marker === undefined) {
      problems.push(`no marker node "${name}"`);
      continue;
    }
    const isDrawn =
      marker.mesh !== undefined ||
      (marker.children ?? []).some((child) => nodes[child]?.mesh !== undefined);
    if (isDrawn)
      problems.push(`marker node "${name}" has a mesh: a marker is a place, never drawn`);
  }
  const clips = new Set(animations.map((animation) => animation.name));
  for (const clip of contract.clips) {
    if (!clips.has(clip)) problems.push(`no clip "${clip}"`);
  }
  for (const animation of animations) {
    for (const channel of animation.channels ?? []) {
      const target = nodes[channel.target?.node ?? -1]?.name;
      if (
        target !== undefined &&
        (contract.codeDrivenBones.includes(target) ||
          contract.codeDrivenNodes.includes(target) ||
          contract.markerNodes.includes(target))
      ) {
        problems.push(
          `clip "${animation.name}" has a ${channel.target?.path} track on "${target}", which the code drives`,
        );
      }
    }
  }
  for (const [index, mesh] of (json.meshes ?? []).entries()) {
    for (const primitive of mesh.primitives ?? []) {
      for (const attribute of Object.keys(primitive.attributes ?? {})) {
        if (EXTRA_INFLUENCES.test(attribute)) {
          problems.push(`mesh ${index} has ${attribute}: more than 4 influences a vertex`);
        }
      }
    }
  }
  return problems;
}
