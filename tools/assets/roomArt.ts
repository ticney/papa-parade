// What a shipped room may be, read from the JSON chunk of its .glb (story 7.1, D3 and D6): the budget
// of one room, the hues kept for gameplay and the floor the sound waves are drawn on. Pure, no
// Blender: `tests/architecture/levelAssets.test.ts` runs them on the committed files.
import { looksLikeGameplayNode, parseNodeName } from '@content/levelNodeNames';

/** A material this close to a reserved hue, in degrees, is refused while it is also vivid. */
export const RESERVED_HUE_MARGIN_DEG = 15;
/** Below this HSV saturation a colour no longer reads as the reserved one. */
export const RESERVED_MIN_SATURATION = 0.6;
/** Below this HSV value a colour no longer reads as the reserved one. */
export const RESERVED_MIN_VALUE = 0.6;
/** The contrast every material of the floor keeps against the ink of the sound waves (WCAG ratio). */
export const FLOOR_INK_MIN_CONTRAST = 3;

/** The visual node whose materials the sound waves are drawn on. */
const FLOOR_NODE_NAME = 'floor';
/** glTF's default material, for a primitive with none and a material with no `baseColorFactor`. */
const WHITE: readonly number[] = [1, 1, 1, 1];
const DEGREES_PER_SEXTANT = 60;
const FULL_TURN_DEG = 360;
const HALF_TURN_DEG = 180;

interface RoomPrimitive {
  attributes?: { POSITION?: number };
  indices?: number;
  material?: number;
}
interface RoomMaterial {
  name?: string;
  pbrMetallicRoughness?: { baseColorFactor?: number[] };
}
interface RoomNode {
  name?: string;
  mesh?: number;
  children?: number[];
}
interface RoomJson {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: RoomNode[];
  meshes?: { primitives?: RoomPrimitive[] }[];
  accessors?: { count?: number }[];
  materials?: RoomMaterial[];
}

export interface RoomBudget {
  drawCalls: number;
  triangles: number;
}

/** Nodes the game removes before it draws (`levelScene.ts › isHiddenInGame`): their subtree costs nothing. */
function isDrawn(node: RoomNode): boolean {
  if (node.name === undefined) return true;
  const parsed = parseNodeName(node.name);
  if (parsed.ok) return parsed.value.kind === 'visual' || parsed.value.kind === 'prop';
  return !looksLikeGameplayNode(node.name);
}

/** The primitives of the mesh of `index` and of everything under it (gltfpack moves a mesh to a child). */
function primitivesUnder(json: RoomJson, index: number): RoomPrimitive[] {
  const node = json.nodes?.[index];
  if (node === undefined) return [];
  const own = node.mesh === undefined ? [] : (json.meshes?.[node.mesh]?.primitives ?? []);
  return [...own, ...(node.children ?? []).flatMap((child) => primitivesUnder(json, child))];
}

/** One draw call per primitive and `indices.count / 3` triangles, over every drawn node (D6). */
export function roomBudgetOf(document: unknown): RoomBudget {
  const json = document as RoomJson;
  const nodes = json.nodes ?? [];
  const budget: RoomBudget = { drawCalls: 0, triangles: 0 };
  const visit = (index: number): void => {
    const node = nodes[index];
    if (node === undefined || !isDrawn(node)) return;
    const primitives = node.mesh === undefined ? [] : (json.meshes?.[node.mesh]?.primitives ?? []);
    for (const primitive of primitives) {
      const accessor = primitive.indices ?? primitive.attributes?.POSITION ?? -1;
      budget.drawCalls += 1;
      budget.triangles += (json.accessors?.[accessor]?.count ?? 0) / 3;
    }
    for (const child of node.children ?? []) visit(child);
  };
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? nodes.map((_, index) => index);
  for (const root of roots) visit(root);
  return budget;
}

const toLinear = (srgb: number): number =>
  srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
const toSrgb = (linear: number): number =>
  linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;

/** The sRGB channels of `#RRGGBB`, 0 to 1. */
function channelsOf(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

interface Hsv {
  hueDeg: number;
  saturation: number;
  value: number;
}

function hsvOf([r, g, b]: readonly [number, number, number]): Hsv {
  const value = Math.max(r, g, b);
  const delta = value - Math.min(r, g, b);
  let sextant = 0;
  if (delta > 0) {
    if (value === r) sextant = (g - b) / delta;
    else if (value === g) sextant = (b - r) / delta + 2;
    else sextant = (r - g) / delta + 4;
  }
  return {
    hueDeg: (sextant * DEGREES_PER_SEXTANT + FULL_TURN_DEG) % FULL_TURN_DEG,
    saturation: value === 0 ? 0 : delta / value,
    value,
  };
}

const factorOf = (material: RoomMaterial | undefined): readonly number[] =>
  material?.pbrMetallicRoughness?.baseColorFactor ?? WHITE;

function srgbOf(material: RoomMaterial | undefined): [number, number, number] {
  const [r = 1, g = 1, b = 1] = factorOf(material);
  return [toSrgb(r), toSrgb(g), toSrgb(b)];
}

function hueDistanceDeg(a: number, b: number): number {
  const distance = Math.abs(a - b) % FULL_TURN_DEG;
  return distance > HALF_TURN_DEG ? FULL_TURN_DEG - distance : distance;
}

/** Every material that sits on a hue kept for gameplay (`reservedHexes`, `#RRGGBB`), one message each (D3). */
export function reservedHueProblems(document: unknown, reservedHexes: readonly string[]): string[] {
  const problems: string[] = [];
  for (const material of (document as RoomJson).materials ?? []) {
    const colour = hsvOf(srgbOf(material));
    if (colour.saturation < RESERVED_MIN_SATURATION || colour.value < RESERVED_MIN_VALUE) continue;
    for (const hex of reservedHexes) {
      const distanceDeg = hueDistanceDeg(colour.hueDeg, hsvOf(channelsOf(hex)).hueDeg);
      if (distanceDeg <= RESERVED_HUE_MARGIN_DEG) {
        problems.push(
          `material "${material.name}" is ${distanceDeg.toFixed(1)}° from the reserved ${hex}`,
        );
      }
    }
  }
  return problems;
}

/** Relative luminance from linear channels (WCAG). */
const luminanceOf = (r: number, g: number, b: number): number =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Whether every material of the `floor` node keeps its contrast against `inkHex`, or the problem with
 * the first that does not (D3). glTF stores linear values, so the luminance reads them as they are.
 */
export function floorContrastProblem(document: unknown, inkHex: string): string | null {
  const json = document as RoomJson;
  const floor = (json.nodes ?? []).findIndex((node) => node.name === FLOOR_NODE_NAME);
  if (floor === -1) return `no "${FLOOR_NODE_NAME}" node to read`;
  const primitives = primitivesUnder(json, floor);
  if (primitives.length === 0) return `the "${FLOOR_NODE_NAME}" node holds no mesh`;
  const [inkR, inkG, inkB] = channelsOf(inkHex).map(toLinear) as [number, number, number];
  const inkLuminance = luminanceOf(inkR, inkG, inkB);
  for (const primitive of primitives) {
    const material =
      primitive.material === undefined ? undefined : json.materials?.[primitive.material];
    const [r = 1, g = 1, b = 1] = factorOf(material);
    const luminance = luminanceOf(r, g, b);
    const contrast =
      (Math.max(luminance, inkLuminance) + 0.05) / (Math.min(luminance, inkLuminance) + 0.05);
    if (contrast < FLOOR_INK_MIN_CONTRAST) {
      return `floor material "${material?.name}" has a contrast of ${contrast.toFixed(2)}:1 against ${inkHex} (at least ${FLOOR_INK_MIN_CONTRAST}:1)`;
    }
  }
  return null;
}
