import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ContentBundle, LevelContent } from '@content/contentBundle';
import { formatContentProblem } from '@content/contentError';
import { LEVEL_GEOMETRY_PATTERN, LEVEL_PATTERN } from '@content/contentFiles';
import { SNAKE_ID_PATTERN } from '@content/levelNodeNames';
import { loadContent } from '@content/loadContent';
import { loadLevelContent } from '@content/loadLevelContent';
import { parseContentFile } from '@content/parseContentFile';
import type { LevelGeometry } from '@content/schemas/levelGeometry';
import { err, ok, type Result } from '@shared/result';
import { createNodeContentSource } from '../content/nodeContentSource.ts';

/** Everything `createSim` needs to play one level, loaded from a content folder. */
export interface SimLevel {
  levelId: string;
  content: ContentBundle;
  level: LevelContent;
  geometry: LevelGeometry;
}

/** The ids of the levels under `<contentDir>/levels/`, sorted. A geometry file is not a level. */
export async function listLevelIds(contentDir: string): Promise<string[]> {
  const names = await readdir(join(contentDir, LEVEL_PATTERN.dir)).catch(() => [] as string[]);
  return names
    .filter((name) => name.endsWith(LEVEL_PATTERN.suffix))
    .filter((name) => !name.endsWith(LEVEL_GEOMETRY_PATTERN.suffix))
    .map((name) => name.slice(0, name.length - LEVEL_PATTERN.suffix.length))
    .filter((id) => SNAKE_ID_PATTERN.test(id))
    .sort();
}

/**
 * Loads the content, the level and its geometry from `contentDir`, through the same parsers and
 * schemas as the game. Every failure is an `err` that says what to do; an unknown level names the
 * known ones.
 */
export async function loadSimLevel(
  contentDir: string,
  levelId: string,
): Promise<Result<SimLevel, string>> {
  const known = await listLevelIds(contentDir);
  if (!known.includes(levelId)) {
    return err(
      `unknown level "${levelId}": known levels are ${known.length === 0 ? '(none)' : known.join(', ')}`,
    );
  }
  const source = createNodeContentSource(contentDir);
  const content = await loadContent(source);
  if (!content.ok) return err(content.error.problems.map(formatContentProblem).join('\n'));
  const level = await loadLevelContent(source, levelId);
  if (!level.ok) return err(level.error.problems.map(formatContentProblem).join('\n'));

  const geometryFile = `${LEVEL_GEOMETRY_PATTERN.dir}/${levelId}${LEVEL_GEOMETRY_PATTERN.suffix}`;
  let text: string;
  try {
    text = await readFile(join(contentDir, geometryFile), 'utf8');
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return err(
      `cannot read content/${geometryFile}: ${reason} (\`npm run assets:extract\` writes it)`,
    );
  }
  const geometry = parseContentFile(`content/${geometryFile}`, text, LEVEL_GEOMETRY_PATTERN.schema);
  if (!geometry.ok) return err(geometry.error.map(formatContentProblem).join('\n'));
  return ok({
    levelId,
    content: content.value,
    level: level.value,
    geometry: geometry.value,
  });
}
