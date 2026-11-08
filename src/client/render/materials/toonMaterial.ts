import {
  Color,
  DataTexture,
  type Material,
  type Mesh,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { PALETTE } from './palette.ts';

/** The key under which one colour is shared: the hex of its sRGB value. */
export function colorKey(color: Color): string {
  return color.getHexString();
}

/** The characters' own look (story 7.8, D10): a light rim and an optional 4th, darkest tone. */
export interface ToonLook {
  readonly rimStrengthPct: number;
  readonly rimWidthPct: number;
  readonly isFourthToneOn: boolean;
  /** The 4th tone, in % of white. */
  readonly fourthTonePct: number;
}

export interface ToonMaterialCache {
  /** One shared material per distinct colour. The colour is copied: later changes to it do nothing. */
  get(color: Color): MeshToonMaterial;
  /** How many distinct materials were made. */
  readonly size: number;
  /**
   * The characters' cache only (`createToonMaterialCache(tones, { isCharacters: true })`): writes the rim's
   * uniforms and the ramp from `look`, when they changed. No new material, no new texture. A room cache
   * ignores it.
   */
  setLook(look: Readonly<ToonLook>): void;
  /** How many tones the ramp draws now (3, or 4 with the 4th tone on): the tests and the debug. */
  readonly toneCount: number;
  /** Disposes every material and the ramp. */
  dispose(): void;
}

function disposeMaterial(material: Material | Material[]): void {
  for (const one of Array.isArray(material) ? material : [material]) one.dispose();
}

function originalColor(material: Material | Material[]): Color {
  const one = Array.isArray(material) ? material[0] : material;
  const color = (one as { color?: unknown } | undefined)?.color;
  return color instanceof Color ? color : new Color(PALETTE.cream);
}

/** Gives `mesh` the shared toon material of its own colour and frees the one it had. */
export function swapToToon(mesh: Mesh, toon: ToonMaterialCache): void {
  const original = mesh.material;
  mesh.material = toon.get(originalColor(original));
  disposeMaterial(original);
}

function createGradientMap(data: Uint8Array): DataTexture {
  const texture = new DataTexture(data, data.length, 1, RedFormat);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * Writes `tones` as equal bands over the whole of `data` (D10): with `NearestFilter`, a ramp of 12 texels
 * drawn as 3 bands of 4 shades exactly as one of 3 texels, so the 4th tone needs no new texture.
 */
export function writeToonBands(data: Uint8Array, tones: readonly number[]): void {
  for (let i = 0; i < data.length; i++) {
    data[i] = tones[Math.floor((i * tones.length) / data.length)] as number;
  }
}

/** The 4th tone as 0-255: `pct` of white. */
export function fourthToneOf(fourthTonePct: number): number {
  return Math.round((Math.min(100, Math.max(0, fourthTonePct)) * 255) / 100);
}

// The rim (story 7.8, D10): a share of paper added on the silhouette, in view space. The camera is
// orthographic, so the view direction is the view's -z everywhere and `1 - normal.z` is how far the
// surface turns from the camera. Unlit on purpose: it is the edge that reads, not a light.
const RIM_PARS = /* glsl */ `
uniform vec3 rimColor;
uniform float rimStrength;
uniform float rimWidth;
`;
const RIM_FRAGMENT = /* glsl */ `
outgoingLight += rimColor * rimStrength * smoothstep( 1.0 - rimWidth, 1.0, 1.0 - normalize( normal ).z );
#include <opaque_fragment>
`;
const RIM_PROGRAM_KEY = 'pp_toon_rim';

/** What a characters' cache is made with. */
export interface ToonCacheOptions {
  /** The characters' cache (story 7.8): a rim, and a ramp that can draw a 4th tone. */
  readonly isCharacters: boolean;
}

/**
 * Shares one `MeshToonMaterial` per colour (draw calls and memory), all with the same ramp: `tones`,
 * darkest to lightest, as 0-255 (`feedback.json › render.toonTones`, ADR-008). The room's cache is just
 * that. The characters' (`isCharacters`, story 7.8) adds a rim on every material through one shared
 * program and one set of uniforms, and a ramp of `lcm(n, n + 1)` texels that draws the `n` tones or,
 * with the 4th tone on, `n + 1` with the extra one darkest; both follow `setLook` in place.
 */
export function createToonMaterialCache(
  tones: readonly number[],
  options: ToonCacheOptions = { isCharacters: false },
): ToonMaterialCache {
  const { isCharacters } = options;
  const n = tones.length;
  const texels = isCharacters ? (n * (n + 1)) / gcd(n, n + 1) : n;
  const data = new Uint8Array(texels);
  writeToonBands(data, tones);
  const gradientMap = createGradientMap(data);
  const withFourth = [0, ...tones];
  let toneCount = n;
  let fourthTone = Number.NaN;
  const rimUniforms = {
    rimColor: { value: new Color(PALETTE.paper) },
    rimStrength: { value: 0 },
    rimWidth: { value: 0 },
  };
  const patchRim = (shader: WebGLProgramParametersWithUniforms): void => {
    shader.uniforms.rimColor = rimUniforms.rimColor;
    shader.uniforms.rimStrength = rimUniforms.rimStrength;
    shader.uniforms.rimWidth = rimUniforms.rimWidth;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${RIM_PARS}\nvoid main() {`)
      .replace('#include <opaque_fragment>', RIM_FRAGMENT);
  };
  const rimProgramKey = (): string => RIM_PROGRAM_KEY;
  const materials = new Map<string, MeshToonMaterial>();
  return {
    get(color) {
      const key = colorKey(color);
      let material = materials.get(key);
      if (material === undefined) {
        material = new MeshToonMaterial({ color: color.clone(), gradientMap });
        material.name = `toon_${key}`;
        if (isCharacters) {
          material.name = `toon_character_${key}`;
          material.onBeforeCompile = patchRim;
          material.customProgramCacheKey = rimProgramKey;
        }
        materials.set(key, material);
      }
      return material;
    },
    get size() {
      return materials.size;
    },
    setLook(look) {
      if (!isCharacters) return;
      const strength = look.rimStrengthPct / 100;
      const width = look.rimWidthPct / 100;
      if (rimUniforms.rimStrength.value !== strength) rimUniforms.rimStrength.value = strength;
      if (rimUniforms.rimWidth.value !== width) rimUniforms.rimWidth.value = width;
      const nextCount = look.isFourthToneOn ? n + 1 : n;
      const nextFourth = fourthToneOf(look.fourthTonePct);
      if (nextCount === toneCount && (nextCount === n || nextFourth === fourthTone)) return;
      toneCount = nextCount;
      fourthTone = nextFourth;
      if (nextCount === n) {
        writeToonBands(data, tones);
      } else {
        withFourth[0] = nextFourth;
        writeToonBands(data, withFourth);
      }
      gradientMap.needsUpdate = true;
    },
    get toneCount() {
      return toneCount;
    },
    dispose() {
      for (const material of materials.values()) material.dispose();
      materials.clear();
      gradientMap.dispose();
    },
  };
}
