import { type Color, DataTexture, MeshToonMaterial, NearestFilter, RedFormat } from 'three';

/**
 * The 3-tone ramp of the toon shading (ADR-008), darkest to lightest, as 0-255. Art direction, not a
 * GDD number: Geo tunes it here until the final art (E7).
 */
export const TOON_TONES: readonly number[] = [96, 178, 255];

/** The key under which one colour is shared: the hex of its sRGB value. */
export function colorKey(color: Color): string {
  return color.getHexString();
}

export interface ToonMaterialCache {
  /** One shared material per distinct colour. The colour is copied: later changes to it do nothing. */
  get(color: Color): MeshToonMaterial;
  /** How many distinct materials were made. */
  readonly size: number;
  /** Disposes every material and the ramp. */
  dispose(): void;
}

function createGradientMap(): DataTexture {
  const texture = new DataTexture(new Uint8Array(TOON_TONES), TOON_TONES.length, 1, RedFormat);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** Shares one `MeshToonMaterial` per colour (draw calls and memory), all with the same 3-tone ramp. */
export function createToonMaterialCache(): ToonMaterialCache {
  const gradientMap = createGradientMap();
  const materials = new Map<string, MeshToonMaterial>();
  return {
    get(color) {
      const key = colorKey(color);
      let material = materials.get(key);
      if (material === undefined) {
        material = new MeshToonMaterial({ color: color.clone(), gradientMap });
        material.name = `toon_${key}`;
        materials.set(key, material);
      }
      return material;
    },
    get size() {
      return materials.size;
    },
    dispose() {
      for (const material of materials.values()) material.dispose();
      materials.clear();
      gradientMap.dispose();
    },
  };
}
