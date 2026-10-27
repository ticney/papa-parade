import type { Group } from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * The only importer of `GLTFLoader` and `MeshoptDecoder`. `loadLevelAssets` reaches it through a
 * dynamic `import()`, so the loader and the decoder stay out of the main chunk.
 *
 * `bytes` are fetched by the caller, never by `loader.load(url)`: that reports errors through
 * callbacks and hides the HTTP status. `baseUrl` resolves any external resource (there is none in a
 * `.glb`, but the loader wants one).
 */
export async function parseGlb(bytes: Uint8Array, baseUrl: string): Promise<Group> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  // `parseAsync` wants an ArrayBuffer of exactly the file (a Uint8Array may be a view into more).
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const gltf = await loader.parseAsync(buffer, baseUrl);
  return gltf.scene;
}
