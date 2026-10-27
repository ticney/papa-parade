import { describe, expect, it } from 'vitest';
import { findBlender } from '../../../tools/assets/exportLevel.ts';
import { GLTFPACK_FLAGS, isOptimised } from '../../../tools/assets/optimizeGlb.ts';

describe('findBlender', () => {
  it('prefers BLENDER_BIN when it exists', async () => {
    expect(await findBlender({ BLENDER_BIN: '/opt/blender' }, async () => true)).toBe(
      '/opt/blender',
    );
  });

  it('gives null when BLENDER_BIN points at nothing (a clear error, not a silent fallback)', async () => {
    expect(await findBlender({ BLENDER_BIN: '/nope' }, async () => false)).toBeNull();
  });

  it('falls back to the macOS app, then to the PATH', async () => {
    expect(await findBlender({}, async (path) => path.startsWith('/Applications'))).toContain(
      'Blender.app',
    );
    expect(await findBlender({}, async () => false)).toBe('blender');
  });
});

describe('isOptimised', () => {
  it('spots meshopt compression and nothing else', () => {
    expect(
      isOptimised({ extensionsUsed: ['KHR_mesh_quantization', 'EXT_meshopt_compression'] }),
    ).toBe(true);
    expect(isOptimised({ extensionsUsed: ['KHR_mesh_quantization'] })).toBe(false);
    expect(isOptimised({})).toBe(false);
  });

  it('keeps named nodes and compresses', () => {
    expect(GLTFPACK_FLAGS).toEqual(['-cc', '-kn']);
  });
});
