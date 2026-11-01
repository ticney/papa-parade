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
// A sub-folder of its own: a `.blend` at the top of `assets-src/blender/` reads as a level (story 7.2).
export const characterBlendPath = (characterId: string): string =>
  join(ROOT, 'assets-src', 'blender', 'characters', `${characterId}.blend`);
export const characterGlbPath = (characterId: string): string =>
  join(ROOT, 'public', 'assets', 'characters', `${characterId}.glb`);
export const characterExportScriptPath = (): string =>
  join(ROOT, 'tools', 'blender', 'export_character.py');
