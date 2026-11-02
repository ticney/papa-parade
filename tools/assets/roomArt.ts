// What a shipped room may be, read from the JSON chunk of its .glb (story 7.1, D3 and D6): the budget
// of one room, the hues kept for gameplay and the floor the sound waves are drawn on. Pure, no
// Blender: `tests/architecture/levelAssets.test.ts` runs them on the committed files.
import { looksLikeGameplayNode, parseNodeName } from '@content/levelNodeNames';
import { ROOM_MATERIALS_MAX } from '@shared/constants';

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
/** glTF's `mode` for a list of triangles, the only one the budget counts. */
const TRIANGLES_MODE = 4;
const HEX_COLOUR = /^#[0-9a-f]{6}$/i;
/** An attribute the toon swap ignores and the export keeps out (D3): a vertex colour or a UV set. */
const FORBIDDEN_ATTRIBUTE = /^(COLOR|TEXCOORD)_\d+$/;
const DEGREES_PER_SEXTANT = 60;
const FULL_TURN_DEG = 360;
const HALF_TURN_DEG = 180;

interface RoomPrimitive {
  attributes?: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
}
interface RoomMaterial {
  name?: string;
  alphaMode?: string;
  emissiveFactor?: number[];
  emissiveTexture?: unknown;
  normalTexture?: unknown;
  occlusionTexture?: unknown;
  pbrMetallicRoughness?: {
    baseColorFactor?: number[];
    baseColorTexture?: unknown;
    metallicRoughnessTexture?: unknown;
  };
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
  textures?: unknown[];
  images?: unknown[];
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

/** The triangles of one primitive; a file this reader cannot count exactly is refused, not under-counted. */
function trianglesOf(json: RoomJson, primitive: RoomPrimitive, where: string): number {
  if (primitive.mode !== undefined && primitive.mode !== TRIANGLES_MODE) {
    throw new Error(`${where}: primitive mode ${primitive.mode} is not a list of triangles`);
  }
  const accessor = primitive.indices ?? primitive.attributes?.POSITION;
  const count = accessor === undefined ? undefined : json.accessors?.[accessor]?.count;
  if (count === undefined) throw new Error(`${where}: a primitive has no accessor to count`);
  if (count % 3 !== 0) throw new Error(`${where}: ${count} vertices are not whole triangles`);
  return count / 3;
}

/** One draw call per primitive and `indices.count / 3` triangles, over every drawn node (D6). */
export function roomBudgetOf(document: unknown): RoomBudget {
  const json = document as RoomJson;
  const nodes = json.nodes ?? [];
  const roots = json.scenes?.[json.scene ?? 0]?.nodes;
  if (roots === undefined) throw new Error('roomBudgetOf: the file has no scene with nodes');
  const budget: RoomBudget = { drawCalls: 0, triangles: 0 };
  const visit = (index: number): void => {
    const node = nodes[index];
    if (node === undefined || !isDrawn(node)) return;
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

const toLinear = (srgb: number): number =>
  srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
const toSrgb = (linear: number): number =>
  linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;

/** The sRGB channels of `#RRGGBB`, 0 to 1; any other form would read as black and pass every rule. */
function channelsOf(hex: string): [number, number, number] {
  if (!HEX_COLOUR.test(hex)) throw new Error(`"${hex}" is not a #RRGGBB colour`);
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

/** A material's name for a message, or its index when it has none. */
const labelOf = (material: RoomMaterial | undefined, index: number): string =>
  `"${material?.name ?? `#${index}`}"`;

function hueDistanceDeg(a: number, b: number): number {
  const distance = Math.abs(a - b) % FULL_TURN_DEG;
  return distance > HALF_TURN_DEG ? FULL_TURN_DEG - distance : distance;
}

/** Every material that sits on a hue kept for gameplay (`reservedHexes`, `#RRGGBB`), one message each (D3). */
export function reservedHueProblems(document: unknown, reservedHexes: readonly string[]): string[] {
  const problems: string[] = [];
  const reserved = reservedHexes.map((hex) => ({ hex, hueDeg: hsvOf(channelsOf(hex)).hueDeg }));
  for (const [index, material] of ((document as RoomJson).materials ?? []).entries()) {
    const colour = hsvOf(srgbOf(material));
    if (colour.saturation < RESERVED_MIN_SATURATION || colour.value < RESERVED_MIN_VALUE) continue;
    for (const { hex, hueDeg } of reserved) {
      const distanceDeg = hueDistanceDeg(colour.hueDeg, hueDeg);
      if (distanceDeg <= RESERVED_HUE_MARGIN_DEG) {
        problems.push(
          `material ${labelOf(material, index)} is ${distanceDeg.toFixed(1)}° from the reserved ${hex}`,
        );
      }
    }
  }
  return problems;
}

/** Relative luminance from linear channels (WCAG). */
const luminanceOf = (r: number, g: number, b: number): number =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

/** What a level's lights multiply a sun-facing floor's linear colour by, per channel (story 7.3, D7). */
export type DrawnLight = readonly [number, number, number];

/** A level's lights, as `feedback.json › render.lights` holds them. */
export interface LevelLights {
  ambientColor: string;
  ambientIntensity: number;
  sunColor: string;
  sunIntensity: number;
}

/**
 * `(ambient + sun x tone) / pi` on a floor, per channel: three's toon shading, proved by pixel in story
 * 7.3 (T1). `tone` is the ramp's band for the floor's `N.L`, read like the shader at `N.L x 0.5 + 0.5`.
 */
export function floorLightOf(
  lights: LevelLights,
  toonTones: readonly number[],
  sunOffsetM: readonly [number, number, number],
): DrawnLight {
  const [x, y, z] = sunOffsetM;
  const coord = (y / Math.hypot(x, y, z)) * 0.5 + 0.5;
  const band = Math.min(toonTones.length - 1, Math.floor(coord * toonTones.length));
  const tone = (toonTones[band] as number) / 255;
  const ambient = channelsOf(lights.ambientColor).map(toLinear);
  const sun = channelsOf(lights.sunColor).map(toLinear);
  const channel = (i: number): number =>
    ((ambient[i] as number) * lights.ambientIntensity +
      (sun[i] as number) * lights.sunIntensity * tone) /
    Math.PI;
  return [channel(0), channel(1), channel(2)];
}

/** No light at all to account for: the material's own colour is what is judged. */
const AS_AUTHORED: DrawnLight = [1, 1, 1];

/**
 * Whether every material of the `floor` node keeps its contrast against `inkHex` once drawn under
 * `light`, or the problem with the first that does not (D3). glTF stores linear values, so the
 * luminance reads them as they are. The display clamps a channel at 1. `notWalkable` names materials
 * no wave is ever drawn on, such as the side of the slab (story 7.3, D8).
 */
export function floorContrastProblem(
  document: unknown,
  inkHex: string,
  light: DrawnLight = AS_AUTHORED,
  notWalkable: readonly string[] = [],
): string | null {
  const json = document as RoomJson;
  const [inkR, inkG, inkB] = channelsOf(inkHex).map(toLinear) as [number, number, number];
  const inkLuminance = luminanceOf(inkR, inkG, inkB);
  const floor = (json.nodes ?? []).findIndex((node) => node.name === FLOOR_NODE_NAME);
  if (floor === -1) return `no "${FLOOR_NODE_NAME}" node to read`;
  const primitives = primitivesUnder(json, floor);
  if (primitives.length === 0) return `the "${FLOOR_NODE_NAME}" node holds no mesh`;
  let judged = 0;
  for (const primitive of primitives) {
    const material =
      primitive.material === undefined ? undefined : json.materials?.[primitive.material];
    if (material?.name !== undefined && notWalkable.includes(material.name)) continue;
    judged++;
    const [r = 1, g = 1, b = 1] = factorOf(material);
    const luminance = luminanceOf(
      Math.min(1, r * light[0]),
      Math.min(1, g * light[1]),
      Math.min(1, b * light[2]),
    );
    const contrast =
      (Math.max(luminance, inkLuminance) + 0.05) / (Math.min(luminance, inkLuminance) + 0.05);
    if (contrast < FLOOR_INK_MIN_CONTRAST) {
      return `floor material ${labelOf(material, primitive.material ?? -1)} has a contrast of ${contrast.toFixed(2)}:1 against ${inkHex} (at least ${FLOOR_INK_MIN_CONTRAST}:1)`;
    }
  }
  if (judged === 0) {
    return `every material of the "${FLOOR_NODE_NAME}" node is listed as not walkable: nothing was judged`;
  }
  return null;
}

/** The textures a material points at, by property name. */
function texturesOf(material: RoomMaterial): string[] {
  const { pbrMetallicRoughness: pbr } = material;
  const slots: [string, unknown][] = [
    ['baseColorTexture', pbr?.baseColorTexture],
    ['metallicRoughnessTexture', pbr?.metallicRoughnessTexture],
    ['normalTexture', material.normalTexture],
    ['occlusionTexture', material.occlusionTexture],
    ['emissiveTexture', material.emissiveTexture],
  ];
  return slots.flatMap(([name, value]) => (value === undefined ? [] : [name]));
}

/** What one material may not carry: the toon swap keeps the base colour only (D3). */
function materialProblems(material: RoomMaterial, index: number): string[] {
  const label = labelOf(material, index);
  const problems = texturesOf(material).map((name) => `material ${label} has a ${name}`);
  if (material.emissiveFactor?.some((channel) => channel !== 0)) {
    problems.push(`material ${label} is emissive`);
  }
  if (material.alphaMode !== undefined && material.alphaMode !== 'OPAQUE') {
    problems.push(`material ${label} has alphaMode ${material.alphaMode}`);
  }
  if ((material.pbrMetallicRoughness?.baseColorFactor?.[3] ?? 1) < 1) {
    problems.push(`material ${label} is translucent`);
  }
  return problems;
}

/**
 * The rules of D3 on the colour of a room: at most `materialsMax` materials, base colour only, and
 * no image, vertex colour or UV set. One message per problem, empty when the room conforms. A
 * character passes its own maximum (story 7.2, D4).
 */
export function roomMaterialProblems(
  document: unknown,
  materialsMax: number = ROOM_MATERIALS_MAX,
): string[] {
  const json = document as RoomJson;
  const materials = json.materials ?? [];
  const problems: string[] = [];
  if (materials.length > materialsMax) {
    problems.push(`${materials.length} materials, at most ${materialsMax}`);
  }
  if ((json.images?.length ?? 0) > 0 || (json.textures?.length ?? 0) > 0) {
    problems.push('the file holds a texture or an image');
  }
  for (const [index, material] of materials.entries()) {
    problems.push(...materialProblems(material, index));
  }
  for (const [meshIndex, mesh] of (json.meshes ?? []).entries()) {
    for (const primitive of mesh.primitives ?? []) {
      for (const attribute of Object.keys(primitive.attributes ?? {})) {
        if (FORBIDDEN_ATTRIBUTE.test(attribute)) {
          problems.push(`mesh ${meshIndex} has a ${attribute} attribute`);
        }
      }
    }
  }
  return problems;
}
