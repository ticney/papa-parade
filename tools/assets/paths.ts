import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root, whatever the working directory. */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const blendPath = (levelId: string): string =>
  join(ROOT, 'assets-src', 'blender', `${levelId}.blend`);
export const glbPath = (levelId: string): string =>
  join(ROOT, 'public', 'assets', 'levels', `${levelId}.glb`);
export const geometryPath = (levelId: string): string =>
  join(ROOT, 'content', 'levels', `${levelId}.geometry.json`);
export const exportScriptPath = (): string => join(ROOT, 'tools', 'blender', 'export_level.py');
