import {
  Color,
  DataTexture,
  type Material,
  type Mesh,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
} from 'three';
import { PALETTE } from './palette.ts';

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

function createGradientMap(tones: readonly number[]): DataTexture {
  const texture = new DataTexture(new Uint8Array(tones), tones.length, 1, RedFormat);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Shares one `MeshToonMaterial` per colour (draw calls and memory), all with the same ramp: `tones`,
 * darkest to lightest, as 0-255 (`feedback.json › render.toonTones`, ADR-008).
 */
export function createToonMaterialCache(tones: readonly number[]): ToonMaterialCache {
  const gradientMap = createGradientMap(tones);
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
