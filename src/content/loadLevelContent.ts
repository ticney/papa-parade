import './zodConfig.ts';
import { err, ok, type Result } from '@shared/result';
import type { LevelContent } from './contentBundle.ts';
import { type ContentError, type ContentProblem, createContentError } from './contentError.ts';
import {
  DISRUPTION_DEF_PATTERN,
  LEVEL_PATTERN,
  SEQUENCE_DEF_PATTERN,
  THREAT_DEF_PATTERN,
} from './contentFiles.ts';
import type { ContentSource } from './contentSource.ts';
import { formatJsonPath } from './jsonPath.ts';
import { parseContentFile } from './parseContentFile.ts';
import type { DisruptionDef } from './schemas/disruption.ts';
import type { SequenceDef } from './schemas/sequence.ts';
import type { ThreatDef } from './schemas/threat.ts';

async function readText(
  source: ContentSource,
  file: string,
): Promise<Result<string, ContentProblem[]>> {
  // A source honours its Result contract; a rejection or a throw is a bug in the source, still reported as a problem.
  const text = await Promise.resolve()
    .then(() => source.read(file))
    .catch((cause: unknown) =>
      err({
        kind: 'content' as const,
        message: cause instanceof Error ? cause.message : String(cause),
      }),
    );
  if (!text.ok)
    return err([{ file: `content/${file}`, jsonPath: '', message: text.error.message }]);
  return ok(text.value);
}

/** The id a file claims must be the one its name carries (`threats/outlet.json` → `outlet`). */
function checkId(file: string, id: string, expected: string): ContentProblem[] {
  if (id === expected) return [];
  return [
    {
      file,
      jsonPath: 'id',
      message: `the id "${id}" must equal the file name ("${expected}")`,
    },
  ];
}

/**
 * Reads `levels/<levelId>.json`, then each distinct `threats/<def>.json` its waves plan (and its
 * `gauges.fatigue.microSleepDef`, then its `carry.armsCryDef`, last), in order of first reference, then each distinct
 * `disruptions/<def>.json` its waves plan (story 1.20), then each `sequences/<id>.json` its `sequences` names (story 4.4), then
 * each `threats/<def>.json` a `duel` step of those sequences names (story 4.6; the sequences are read
 * after the threats, so these come last), through the same source and the same parser as
 * `loadContent`. It collects every problem (a missing def file names the level's JSON path,
 * `waves[1].threats[0].def` or `waves[2].disruptions[0].def` or `sequences[0]`; a duel's own, the
 * sequence file's `steps[1].threatDef`). It checks no anchor, no gag id and no
 * object kind: it has no geometry and must not know the sim (`createSim` and `content:check` do).
 * Never throws and never logs: the caller logs.
 */
export async function loadLevelContent(
  source: ContentSource,
  levelId: string,
): Promise<Result<LevelContent, ContentError>> {
  const levelFile = `${LEVEL_PATTERN.dir}/${levelId}${LEVEL_PATTERN.suffix}`;
  const levelDisplay = `content/${levelFile}`;
  const text = await readText(source, levelFile);
  if (!text.ok) return err(createContentError(text.error));
  const parsed = parseContentFile(levelDisplay, text.value, LEVEL_PATTERN.schema);
  if (!parsed.ok) return err(createContentError(parsed.error));
  const level = parsed.value;

  const problems = checkId(levelDisplay, level.id, levelId);
  const threats: Record<string, ThreatDef> = {};
  const failed = new Set<string>();
  const planned = level.waves.flatMap((wave, w) =>
    wave.threats.map((entry, i) => ({ defId: entry.def, path: ['waves', w, 'threats', i, 'def'] })),
  );
  // The micro-sleep of a level with fatigue is loaded after the wave defs (story 1.19).
  const microSleepDef = level.gauges.fatigue?.microSleepDef;
  if (microSleepDef !== undefined) {
    planned.push({ defId: microSleepDef, path: ['gauges', 'fatigue', 'microSleepDef'] });
  }
  // The cry in the arms of a level that carries is loaded after the micro-sleep (story 4.1).
  const armsCryDef = level.carry?.armsCryDef;
  if (armsCryDef !== undefined) {
    planned.push({ defId: armsCryDef, path: ['carry', 'armsCryDef'] });
  }
  // One path for every threat def, whoever asks for it: `file` and `jsonPath` say where the asker names it.
  const loadThreat = async (defId: string, file: string, jsonPath: string): Promise<void> => {
    if (Object.hasOwn(threats, defId) || failed.has(defId)) return;
    const defFile = `${THREAT_DEF_PATTERN.dir}/${defId}${THREAT_DEF_PATTERN.suffix}`;
    const defDisplay = `content/${defFile}`;
    const defText = await readText(source, defFile);
    if (!defText.ok) {
      failed.add(defId);
      // The asker names a file that cannot be read: point at the line that asked for it.
      problems.push({
        file,
        jsonPath,
        message: `cannot load the threat "${defId}": ${defText.error[0]?.message ?? 'unreadable'}`,
      });
      return;
    }
    const def = parseContentFile(defDisplay, defText.value, THREAT_DEF_PATTERN.schema);
    if (!def.ok) {
      failed.add(defId);
      problems.push(...def.error);
      return;
    }
    problems.push(...checkId(defDisplay, def.value.id, defId));
    threats[defId] = def.value;
  };
  for (const { defId, path } of planned) {
    await loadThreat(defId, levelDisplay, formatJsonPath(path));
  }

  const disruptions: Record<string, DisruptionDef> = {};
  const failedDisruptions = new Set<string>();
  const plannedDisruptions = level.waves.flatMap((wave, w) =>
    wave.disruptions.map((entry, i) => ({
      defId: entry.def,
      path: ['waves', w, 'disruptions', i, 'def'],
    })),
  );
  for (const { defId, path } of plannedDisruptions) {
    if (Object.hasOwn(disruptions, defId) || failedDisruptions.has(defId)) continue;
    const defFile = `${DISRUPTION_DEF_PATTERN.dir}/${defId}${DISRUPTION_DEF_PATTERN.suffix}`;
    const defDisplay = `content/${defFile}`;
    const defText = await readText(source, defFile);
    if (!defText.ok) {
      failedDisruptions.add(defId);
      problems.push({
        file: levelDisplay,
        jsonPath: formatJsonPath(path),
        message: `cannot load the disruption "${defId}": ${defText.error[0]?.message ?? 'unreadable'}`,
      });
      continue;
    }
    const def = parseContentFile(defDisplay, defText.value, DISRUPTION_DEF_PATTERN.schema);
    if (!def.ok) {
      failedDisruptions.add(defId);
      problems.push(...def.error);
      continue;
    }
    problems.push(...checkId(defDisplay, def.value.id, defId));
    disruptions[defId] = def.value;
  }

  const sequences: Record<string, SequenceDef> = {};
  const failedSequences = new Set<string>();
  for (const [i, sequenceId] of level.sequences.entries()) {
    if (Object.hasOwn(sequences, sequenceId) || failedSequences.has(sequenceId)) continue;
    const defFile = `${SEQUENCE_DEF_PATTERN.dir}/${sequenceId}${SEQUENCE_DEF_PATTERN.suffix}`;
    const defDisplay = `content/${defFile}`;
    const defText = await readText(source, defFile);
    if (!defText.ok) {
      failedSequences.add(sequenceId);
      problems.push({
        file: levelDisplay,
        jsonPath: formatJsonPath(['sequences', i]),
        message: `cannot load the sequence "${sequenceId}": ${defText.error[0]?.message ?? 'unreadable'}`,
      });
      continue;
    }
    const def = parseContentFile(defDisplay, defText.value, SEQUENCE_DEF_PATTERN.schema);
    if (!def.ok) {
      failedSequences.add(sequenceId);
      problems.push(...def.error);
      continue;
    }
    problems.push(...checkId(defDisplay, def.value.id, sequenceId));
    sequences[sequenceId] = def.value;
  }

  // A `duel` step names the threat it spawns on Papa (story 4.6): the threats were read before the
  // sequences, so it is loaded now, after every other def, and a missing file is reported at the step.
  for (const [sequenceId, sequence] of Object.entries(sequences)) {
    const sequenceDisplay = `content/${SEQUENCE_DEF_PATTERN.dir}/${sequenceId}${SEQUENCE_DEF_PATTERN.suffix}`;
    for (const [j, step] of sequence.steps.entries()) {
      if (step.kind !== 'duel') continue;
      await loadThreat(step.threatDef, sequenceDisplay, formatJsonPath(['steps', j, 'threatDef']));
    }
  }

  if (problems.length > 0) return err(createContentError(problems));
  return ok({ level, threats, disruptions, sequences });
}
