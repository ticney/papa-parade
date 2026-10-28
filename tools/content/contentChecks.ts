import { access, readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { FEEDBACK_CLIENT_EVENTS } from '@client/feedback/feedbackEvents';
import type { ContentProblem } from '@content/contentError';
import {
  BOTS_FILE,
  CONTENT_FILES,
  CONTENT_SCHEMAS,
  DISRUPTION_DEF_PATTERN,
  FEEDBACK_FILE,
  FEEL_FILE,
  LEVEL_GEOMETRY_PATTERN,
  LEVEL_PATTERN,
  matchContentPattern,
  STRINGS_FILE,
  THREAT_DEF_PATTERN,
} from '@content/contentFiles';
import { mergeFeel } from '@content/feelMerge';
import { formatJsonPath } from '@content/jsonPath';
import { renderContentJsonSchema } from '@content/jsonSchema';
import { parseContentFile } from '@content/parseContentFile';
import type { BotSettings } from '@content/schemas/bots';
import type { DisruptionDef } from '@content/schemas/disruption';
import type { FeedbackTable } from '@content/schemas/feedback';
import type { Feel } from '@content/schemas/feel';
import type { Level } from '@content/schemas/level';
import type { LevelGeometry } from '@content/schemas/levelGeometry';
import type { ThreatDef } from '@content/schemas/threat';
import { checkStringReferences } from '@content/stringRefs';
import { MS_PER_S, PHYSICS_BOUNDS_WALL_THICKNESS_M, STEP_MS } from '@shared/constants';
import { GAG_IDS, OBJECT_ACTION_KINDS, PAPA_ASLEEP_GAG_ID, SIM_EVENT_TYPES } from '@sim';

const SCHEMAS_DIR = '_schemas';
const AUDIO_DIR = ['public', 'assets', 'audio'];
// `t('some.key')` with a literal key and nothing else. A non-literal argument cannot be checked.
const LITERAL_T_CALL = /(?<![\w$.])t\(\s*(['"])([^'"\n]+)\1\s*\)/g;

async function walk(dir: string, skip: (name: string) => boolean): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (skip(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path, skip)));
    else files.push(path);
  }
  return files;
}

const posixRelative = (from: string, to: string): string => relative(from, to).split(sep).join('/');

/** Every `*.json` under `<rootDir>/content` except `_schemas/`, as paths relative to `content/`. */
export async function listContentFiles(rootDir: string): Promise<string[]> {
  const contentDir = join(rootDir, 'content');
  const files = await walk(contentDir, (name) => name === SCHEMAS_DIR);
  return files
    .filter((file) => file.endsWith('.json'))
    .map((file) => posixRelative(contentDir, file));
}

/** The `_schemas/*.schema.json` files that no registered content file generates: stale or hand-made. */
export async function listOrphanSchemas(rootDir: string): Promise<string[]> {
  const expected = new Set(CONTENT_SCHEMAS.map((entry) => `${entry.schemaName}.schema.json`));
  const names = await readdir(join(rootDir, 'content', SCHEMAS_DIR)).catch(() => [] as string[]);
  return names.filter((name) => name.endsWith('.schema.json') && !expected.has(name)).sort();
}

/** Blanks `//` and block comments, leaving string literals (and newlines) as they are. */
export function stripComments(source: string): string {
  let out = '';
  let quote = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i] as string;
    const next = source[i + 1];
    if (quote !== '') {
      out += c;
      if (c === '\\') out += source[++i] ?? '';
      // Only a template literal spans lines: a lone quote (in a regex literal, say) ends with its line.
      else if (c === quote || (c === '\n' && quote !== '`')) quote = '';
    } else if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
    } else {
      if (c === '"' || c === "'" || c === '`') quote = c;
      out += c;
    }
  }
  return out;
}

function isCheckedSource(name: string): boolean {
  return name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.spec.ts');
}

async function checkSourceReferences(
  rootDir: string,
  strings: Record<string, string>,
): Promise<ContentProblem[]> {
  const files = await walk(
    join(rootDir, 'src'),
    (name) => name === 'fixtures' || name === 'node_modules',
  );
  const problems: ContentProblem[] = [];
  for (const path of files.filter((file) => isCheckedSource(file))) {
    const source = stripComments(await readFile(path, 'utf8'));
    for (const match of source.matchAll(LITERAL_T_CALL)) {
      const key = match[2] as string;
      if (Object.hasOwn(strings, key)) continue;
      const line = source.slice(0, match.index).split('\n').length;
      problems.push({
        file: posixRelative(rootDir, path),
        jsonPath: '',
        message: `line ${line}: string key "${key}" is not in content/${STRINGS_FILE.file}`,
      });
    }
  }
  return problems;
}

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

/**
 * The cross-references of `feedback.json` that its schema cannot see: an `events` key is the name
 * of a sim or client event (a typo is a cue that never plays), a client event's cue has neither
 * visual nor camera (they need a world), a cue an event points at has no `threat`-anchored visual
 * (a generic event names no threat), and every clip is a file under `public/assets/audio/`.
 * (That an `events` value is a cue of `cues` is the schema's own check.)
 */
async function checkFeedbackReferences(
  rootDir: string,
  table: FeedbackTable,
): Promise<ContentProblem[]> {
  const file = `content/${FEEDBACK_FILE.file}`;
  const problems: ContentProblem[] = [];
  const eventNames = new Set<string>([...SIM_EVENT_TYPES, ...FEEDBACK_CLIENT_EVENTS]);
  for (const [name, cueId] of Object.entries(table.events)) {
    if (!eventNames.has(name)) {
      problems.push({
        file,
        jsonPath: formatJsonPath(['events', name]),
        message: `"${name}" is not an event name (a SimEvent type or a client event the director listens to)`,
      });
    }
    // A client event has no sim world to read: its cue cannot draw a ring or shake the room (the
    // director would skip them without a word). The schema has already checked that the cue exists.
    const cue = Object.hasOwn(table.cues, cueId) ? table.cues[cueId] : undefined;
    const isClientEvent = (FEEDBACK_CLIENT_EVENTS as readonly string[]).includes(name);
    if (
      isClientEvent &&
      cue !== undefined &&
      (cue.visual !== undefined || cue.camera !== undefined)
    ) {
      problems.push({
        file,
        jsonPath: formatJsonPath(['events', name]),
        message: `"${name}" is a client event with no world: its cue "${cueId}" cannot have a visual or a camera`,
      });
    }
    // A generic event names no threat: a ring anchored on one has nowhere to start from.
    if (cue?.visual?.anchor === 'threat') {
      problems.push({
        file,
        jsonPath: formatJsonPath(['cues', cueId, 'visual', 'anchor']),
        message: `the cue "${cueId}" is played by the event "${name}", which names no threat: its visual cannot be anchored on a threat`,
      });
    }
    // Nor does it name an object (story 1.20): only a disruption def points at an `object` cue.
    if (cue?.visual?.anchor === 'object') {
      problems.push({
        file,
        jsonPath: formatJsonPath(['cues', cueId, 'visual', 'anchor']),
        message: `the cue "${cueId}" is played by the event "${name}", which names no object: its visual cannot be anchored on an object`,
      });
    }
  }
  const clipPaths: { clip: string; path: (string | number)[] }[] = [
    { clip: table.loops.babble.clip, path: ['loops', 'babble', 'clip'] },
    { clip: table.loops.music.clip, path: ['loops', 'music', 'clip'] },
    ...Object.entries(table.cues).flatMap(([id, cue]) =>
      cue.audio === undefined
        ? []
        : [{ clip: cue.audio.clip, path: ['cues', id, 'audio', 'clip'] }],
    ),
  ];
  for (const { clip, path } of clipPaths) {
    if (await exists(join(rootDir, ...AUDIO_DIR, `${clip}.m4a`))) continue;
    problems.push({
      file,
      jsonPath: formatJsonPath(path),
      message: `no file public/assets/audio/${clip}.m4a (\`npm run assets:audio\` makes the placeholders)`,
    });
  }
  return problems;
}

/**
 * The rule of `bots.json` that crosses a file: the perfect and human bots tap for `tapMs`, which
 * must be shorter than `feel.input.holdMinMs` or their tap would be a Firmness, not a Parry.
 */
function checkBotReferences(bots: BotSettings, feel: Feel): ContentProblem[] {
  const problems: ContentProblem[] = [];
  if (bots.tapMs >= feel.input.holdMinMs) {
    problems.push({
      file: `content/${BOTS_FILE.file}`,
      jsonPath: 'tapMs',
      message: `bots.json › tapMs (${bots.tapMs}) must be under feel.json › input.holdMinMs (${feel.input.holdMinMs}), or a bot's tap would be a Firmness`,
    });
  }
  if (bots.random.maxHoldMs <= feel.input.holdMinMs) {
    problems.push({
      file: `content/${BOTS_FILE.file}`,
      jsonPath: 'random.maxHoldMs',
      message: `bots.json › random.maxHoldMs (${bots.random.maxHoldMs}) must be above feel.json › input.holdMinMs (${feel.input.holdMinMs}), or the random bot never produces a Firmness`,
    });
  }
  return problems;
}

/** What the cross-reference checks need of the files that parsed, by id. */
interface ParsedFamilies {
  threats: Map<string, ThreatDef>;
  disruptions: Map<string, DisruptionDef>;
  levels: Map<string, Level>;
  geometries: Map<string, LevelGeometry>;
}

/**
 * The references a threat file makes that its schema cannot see: its gag is one the sim knows, and
 * each of its feedback cues is a cue of `feedback.json`.
 */
function checkThreatReferences(
  threats: ReadonlyMap<string, ThreatDef>,
  feedback: FeedbackTable | undefined,
): ContentProblem[] {
  const problems: ContentProblem[] = [];
  for (const [id, threat] of threats) {
    const file = `content/${THREAT_DEF_PATTERN.dir}/${id}${THREAT_DEF_PATTERN.suffix}`;
    if (!(GAG_IDS as readonly string[]).includes(threat.gag)) {
      problems.push({
        file,
        jsonPath: 'gag',
        message: `"${threat.gag}" is not a gag of the sim (${GAG_IDS.join(', ')}; a new gag is added to GAG_IDS in src/sim/threats/gags.ts)`,
      });
    }
    if (feedback === undefined) continue;
    for (const [role, cueId] of Object.entries(threat.feedback)) {
      if (!Object.hasOwn(feedback.cues, cueId)) {
        problems.push({
          file,
          jsonPath: formatJsonPath(['feedback', role]),
          message: `"${cueId}" is not a cue of content/${FEEDBACK_FILE.file} › cues`,
        });
      } else if (feedback.cues[cueId]?.visual?.anchor === 'object') {
        // A threat event names a threat, never an object (story 1.20).
        problems.push({
          file,
          jsonPath: formatJsonPath(['feedback', role]),
          message: `the cue "${cueId}" is anchored on an object, but a threat event names no object`,
        });
      }
    }
  }
  return problems;
}

/**
 * The references a disruption file makes that its schema cannot see: each of its feedback cues is a
 * cue of `feedback.json`, and none is anchored on a threat (a disruption event names an object, not
 * a threat).
 */
function checkDisruptionReferences(
  disruptions: ReadonlyMap<string, DisruptionDef>,
  feedback: FeedbackTable | undefined,
): ContentProblem[] {
  const problems: ContentProblem[] = [];
  if (feedback === undefined) return problems;
  for (const [id, disruption] of disruptions) {
    const file = `content/${DISRUPTION_DEF_PATTERN.dir}/${id}${DISRUPTION_DEF_PATTERN.suffix}`;
    for (const [role, cueId] of Object.entries(disruption.feedback)) {
      if (!Object.hasOwn(feedback.cues, cueId)) {
        problems.push({
          file,
          jsonPath: formatJsonPath(['feedback', role]),
          message: `"${cueId}" is not a cue of content/${FEEDBACK_FILE.file} › cues`,
        });
      } else if (feedback.cues[cueId]?.visual?.anchor === 'threat') {
        problems.push({
          file,
          jsonPath: formatJsonPath(['feedback', role]),
          message: `the cue "${cueId}" is anchored on a threat, but a disruption event names no threat`,
        });
      }
    }
  }
  return problems;
}

/**
 * The references a level file makes: it has its geometry beside it, each threat of each wave is a
 * threat file whose gag the sim knows, each anchor (of a threat or an object) is an anchor of that
 * geometry, object ids are unique, and its `feelOverrides` merge into a valid feel. A file that
 * exists but did not parse was already reported on its own: it is not reported again here.
 */
function checkLevelReferences(
  families: ParsedFamilies,
  present: ReadonlySet<string>,
  feel: Feel | undefined,
): ContentProblem[] {
  const problems: ContentProblem[] = [];
  for (const [id, level] of families.levels) {
    const file = `content/${LEVEL_PATTERN.dir}/${id}${LEVEL_PATTERN.suffix}`;
    const geometryFile = `${LEVEL_GEOMETRY_PATTERN.dir}/${id}${LEVEL_GEOMETRY_PATTERN.suffix}`;
    const geometry = families.geometries.get(id);
    if (geometry === undefined && !present.has(geometryFile)) {
      problems.push({
        file,
        jsonPath: '',
        message: `the level has no content/${geometryFile} (\`npm run assets:extract\` writes it)`,
      });
    }
    level.waves.forEach((wave, w) => {
      wave.threats.forEach((entry, i) => {
        const defFile = `${THREAT_DEF_PATTERN.dir}/${entry.def}${THREAT_DEF_PATTERN.suffix}`;
        if (!families.threats.has(entry.def) && !present.has(defFile)) {
          problems.push({
            file,
            jsonPath: formatJsonPath(['waves', w, 'threats', i, 'def']),
            message: `no threat "${entry.def}" (content/${defFile} does not exist)`,
          });
        }
        if (
          geometry !== undefined &&
          !geometry.anchors.some((anchor) => anchor.id === entry.anchor)
        ) {
          problems.push({
            file,
            jsonPath: formatJsonPath(['waves', w, 'threats', i, 'anchor']),
            message: `"${entry.anchor}" is not an anchor of content/${geometryFile}`,
          });
        }
        if (families.threats.get(entry.def)?.target === 'papa') {
          problems.push({
            file,
            jsonPath: formatJsonPath(['waves', w, 'threats', i, 'def']),
            message: `the threat "${entry.def}" has target "papa": only the sim spawns it (gauges.fatigue.microSleepDef), a wave cannot plan it`,
          });
        }
        const gag = families.threats.get(entry.def)?.gag;
        if (gag !== undefined && !(GAG_IDS as readonly string[]).includes(gag)) {
          problems.push({
            file,
            jsonPath: formatJsonPath(['waves', w, 'threats', i, 'def']),
            message: `the threat "${entry.def}" has the gag "${gag}", which the sim does not know (${GAG_IDS.join(', ')})`,
          });
        } else if (gag === PAPA_ASLEEP_GAG_ID) {
          problems.push({
            file,
            jsonPath: formatJsonPath(['waves', w, 'threats', i, 'def']),
            message: `the threat "${entry.def}" has the gag "${PAPA_ASLEEP_GAG_ID}": only the micro-sleep (target "papa") may end in it`,
          });
        }
      });
    });
    level.waves.forEach((wave, w) => {
      wave.disruptions.forEach((entry, i) => {
        const defFile = `${DISRUPTION_DEF_PATTERN.dir}/${entry.def}${DISRUPTION_DEF_PATTERN.suffix}`;
        const disruption = families.disruptions.get(entry.def);
        if (disruption === undefined) {
          if (!present.has(defFile)) {
            problems.push({
              file,
              jsonPath: formatJsonPath(['waves', w, 'disruptions', i, 'def']),
              message: `no disruption "${entry.def}" (content/${defFile} does not exist)`,
            });
          }
          return;
        }
        const object = level.objects.find((candidate) => candidate.id === entry.object);
        if (object !== undefined && object.kind !== disruption.kind) {
          problems.push({
            file,
            jsonPath: formatJsonPath(['waves', w, 'disruptions', i, 'object']),
            message: `the disruption "${entry.def}" has the kind "${disruption.kind}", but the object "${entry.object}" has the kind "${object.kind}"`,
          });
        }
      });
    });
    const microSleepDef = level.gauges.fatigue?.microSleepDef;
    if (microSleepDef !== undefined) {
      const defFile = `${THREAT_DEF_PATTERN.dir}/${microSleepDef}${THREAT_DEF_PATTERN.suffix}`;
      const microSleep = families.threats.get(microSleepDef);
      const path = formatJsonPath(['gauges', 'fatigue', 'microSleepDef']);
      if (microSleep === undefined && !present.has(defFile)) {
        problems.push({
          file,
          jsonPath: path,
          message: `no threat "${microSleepDef}" (content/${defFile} does not exist)`,
        });
      } else if (microSleep !== undefined && microSleep.target !== 'papa') {
        problems.push({
          file,
          jsonPath: path,
          message: `the threat "${microSleepDef}" has target "${microSleep.target}", but a micro-sleep must have target "papa"`,
        });
      } else if (microSleep !== undefined && microSleep.gag !== PAPA_ASLEEP_GAG_ID) {
        problems.push({
          file,
          jsonPath: path,
          message: `the threat "${microSleepDef}" has the gag "${microSleep.gag}", but a micro-sleep must have the gag "${PAPA_ASLEEP_GAG_ID}"`,
        });
      }
    }
    if (feel !== undefined) {
      const merged = mergeFeel(feel, level.feelOverrides, file);
      if (!merged.ok) {
        for (const problem of merged.error.problems) {
          problems.push({
            ...problem,
            file,
            jsonPath:
              problem.jsonPath === '' ? 'feelOverrides' : `feelOverrides.${problem.jsonPath}`,
          });
        }
      }
    }
    const seenObjects = new Set<string>();
    level.objects.forEach((object, index) => {
      if (seenObjects.has(object.id)) {
        problems.push({
          file,
          jsonPath: formatJsonPath(['objects', index, 'id']),
          message: `level ${id}: the object "${object.id}" is listed twice`,
        });
      }
      seenObjects.add(object.id);
      if (!(OBJECT_ACTION_KINDS as readonly string[]).includes(object.kind)) {
        problems.push({
          file,
          jsonPath: formatJsonPath(['objects', index, 'kind']),
          message: `level ${id}: the object "${object.id}" has the kind "${object.kind}", which the sim has no action for (${OBJECT_ACTION_KINDS.join(', ')})`,
        });
      }
      if (object.kind === 'coffee_machine' && level.gauges.fatigue === undefined) {
        problems.push({
          file,
          jsonPath: formatJsonPath(['objects', index, 'kind']),
          message: `level ${id}: the object "${object.id}" is a coffee_machine, but the level has no gauges.fatigue (a coffee would only make Papa wait)`,
        });
      }
      if (
        geometry !== undefined &&
        !geometry.anchors.some((anchor) => anchor.id === object.anchor)
      ) {
        problems.push({
          file,
          jsonPath: formatJsonPath(['objects', index, 'anchor']),
          message: `level ${id}: the object "${object.id}" is at "${object.anchor}", which is not an anchor of content/${geometryFile}`,
        });
      }
    });
  }
  return problems;
}

/**
 * The references a level geometry makes that its schema cannot see: each prop's kind has an entry in
 * `feel.json › physics.kinds` (the sim builds its body from it, and refuses a level without one).
 */
function checkPropReferences(
  geometries: ReadonlyMap<string, LevelGeometry>,
  feel: Feel,
): ContentProblem[] {
  const problems: ContentProblem[] = [];
  for (const [id, geometry] of geometries) {
    geometry.props.forEach((prop, index) => {
      if (Object.hasOwn(feel.physics.kinds, prop.kind)) return;
      problems.push({
        file: `content/${LEVEL_GEOMETRY_PATTERN.dir}/${id}${LEVEL_GEOMETRY_PATTERN.suffix}`,
        jsonPath: formatJsonPath(['props', index, 'kind']),
        message: `${id}.geometry.json › props[${index}].kind "${prop.kind}" has no feel.physics.kinds entry`,
      });
    });
  }
  return problems;
}

/**
 * The tuning rules of `feel.json › physics` that no single field can state. For each kind:
 * (1) a breakable kind breaks at `breakImpulseNs`, but the sim reads no impact under
 * `impactMinImpulseNs`, so the first must not be under the second (it could never break at its own
 * threshold); (2) a prop at rest takes `massKg · g · STEP` of impulse each step, which must stay
 * under `impactMinImpulseNs` or it would report an impact all the time it rests; (3) the largest
 * push gives it a speed that must carry it less than half a wall of the room in one step, or it
 * could cross the wall; (4) a gag's push (`feel.gags.tableObjectFall.pushImpulseNs`) must not be
 * above `maxPushImpulseNs`, which `pushProp` holds every push to (a strict sim throws on a longer
 * one, a normal one clamps it and reports `InvariantViolated` at every gag).
 */
function checkPhysicsTuning(feel: Feel): ContentProblem[] {
  const problems: ContentProblem[] = [];
  const { physics } = feel;
  const stepS = STEP_MS / MS_PER_S;
  for (const [kindId, kind] of Object.entries(physics.kinds)) {
    const at = (field: string) => ({
      file: `content/${FEEL_FILE.file}`,
      jsonPath: formatJsonPath(['physics', 'kinds', kindId, field]),
    });
    const where = `feel.json › physics.kinds.${kindId}`;
    if (kind.breakable && kind.breakImpulseNs < physics.impactMinImpulseNs) {
      problems.push({
        ...at('breakImpulseNs'),
        message: `${where}.breakImpulseNs (${kind.breakImpulseNs}) must not be under physics.impactMinImpulseNs (${physics.impactMinImpulseNs}): the sim ignores impacts under it, so the ${kindId} could never break at its own threshold`,
      });
    }
    const restingImpulseNs = kind.massKg * physics.gravityMps2 * stepS;
    if (restingImpulseNs >= physics.impactMinImpulseNs) {
      problems.push({
        ...at('massKg'),
        message: `${where}.massKg (${kind.massKg}) is too heavy: at rest it presses with ${restingImpulseNs.toFixed(3)} N·s per step, which reaches physics.impactMinImpulseNs (${physics.impactMinImpulseNs}), so it would report an impact all the time it rests`,
      });
    }
    const pushStepM = (physics.maxPushImpulseNs / kind.massKg) * stepS;
    if (pushStepM >= PHYSICS_BOUNDS_WALL_THICKNESS_M / 2) {
      problems.push({
        ...at('massKg'),
        message: `${where}.massKg (${kind.massKg}) is too light for physics.maxPushImpulseNs (${physics.maxPushImpulseNs}): the largest push moves it ${pushStepM.toFixed(2)} m per step, and the room's walls are ${PHYSICS_BOUNDS_WALL_THICKNESS_M} m thick, so it could cross one`,
      });
    }
  }
  const { pushImpulseNs } = feel.gags.tableObjectFall;
  if (pushImpulseNs > physics.maxPushImpulseNs) {
    problems.push({
      file: `content/${FEEL_FILE.file}`,
      jsonPath: formatJsonPath(['gags', 'tableObjectFall', 'pushImpulseNs']),
      message: `feel.json › gags.tableObjectFall.pushImpulseNs (${pushImpulseNs}) must not be above physics.maxPushImpulseNs (${physics.maxPushImpulseNs}): pushProp holds every push to it, so the gag would be clamped (or throw in a strict sim)`,
    });
  }
  return problems;
}

/**
 * Everything `npm run content:check` verifies, as a list of problems (empty = OK):
 * every content file against its schema, no content file without a schema, string references from
 * content (`…Key`) and from code (`t('…')`), and the generated JSON Schemas being up to date.
 */
export async function checkContent(rootDir: string): Promise<ContentProblem[]> {
  const problems: ContentProblem[] = [];
  const contentDir = join(rootDir, 'content');
  const parsed: { file: string; value: unknown }[] = [];
  let strings: Record<string, string> | undefined;
  let feedback: FeedbackTable | undefined;
  let feel: Feel | undefined;
  let bots: BotSettings | undefined;
  const families: ParsedFamilies = {
    threats: new Map(),
    disruptions: new Map(),
    levels: new Map(),
    geometries: new Map(),
  };

  for (const file of await listContentFiles(rootDir)) {
    const display = `content/${file}`;
    const entry = CONTENT_FILES.find((candidate) => candidate.file === file);
    const matched = entry === undefined ? matchContentPattern(file) : undefined;
    if (entry === undefined && matched !== undefined) {
      const result = parseContentFile(
        display,
        await readFile(join(contentDir, file), 'utf8'),
        matched.pattern.schema,
      );
      if (!result.ok) {
        problems.push(...result.error);
        continue;
      }
      const id = (result.value as { id?: unknown }).id;
      if (id !== matched.id) {
        problems.push({
          file: display,
          jsonPath: 'id',
          message: `the id "${String(id)}" must equal the file name ("${matched.id}")`,
        });
      }
      parsed.push({ file: display, value: result.value });
      if (matched.pattern === THREAT_DEF_PATTERN) {
        families.threats.set(matched.id, result.value as ThreatDef);
      } else if (matched.pattern === DISRUPTION_DEF_PATTERN) {
        families.disruptions.set(matched.id, result.value as DisruptionDef);
      } else if (matched.pattern === LEVEL_PATTERN) {
        families.levels.set(matched.id, result.value as Level);
      } else if (matched.pattern === LEVEL_GEOMETRY_PATTERN) {
        families.geometries.set(matched.id, result.value as LevelGeometry);
      }
      continue;
    }
    if (entry === undefined) {
      problems.push({
        file: display,
        jsonPath: '',
        message:
          'no schema registered for this file (add it to CONTENT_FILES or CONTENT_PATTERNS in src/content/contentFiles.ts)',
      });
      continue;
    }
    const result = parseContentFile(
      display,
      await readFile(join(contentDir, file), 'utf8'),
      entry.schema,
    );
    if (!result.ok) {
      problems.push(...result.error);
      continue;
    }
    if (entry === STRINGS_FILE) strings = result.value as Record<string, string>;
    else parsed.push({ file: display, value: result.value });
    if (entry === FEEDBACK_FILE) feedback = result.value as FeedbackTable;
    if (entry === FEEL_FILE) feel = result.value as Feel;
    if (entry === BOTS_FILE) bots = result.value as BotSettings;
  }

  const present = new Set(await listContentFiles(rootDir));
  for (const entry of CONTENT_FILES) {
    if (present.has(entry.file)) continue;
    problems.push({
      file: `content/${entry.file}`,
      jsonPath: '',
      message: 'registered content file is missing',
    });
  }

  for (const name of await listOrphanSchemas(rootDir)) {
    problems.push({
      file: `content/${SCHEMAS_DIR}/${name}`,
      jsonPath: '',
      message:
        'no registered content file generates this schema: delete it or run `npm run content:schemas`',
    });
  }

  for (const entry of CONTENT_SCHEMAS) {
    const display = `content/${SCHEMAS_DIR}/${entry.schemaName}.schema.json`;
    const onDisk = await readFile(join(rootDir, display), 'utf8').catch(() => null);
    if (onDisk !== renderContentJsonSchema(entry.schema)) {
      problems.push({
        file: display,
        jsonPath: '',
        message: 'missing or out of date: run `npm run content:schemas`',
      });
    }
  }

  problems.push(...checkThreatReferences(families.threats, feedback));
  problems.push(...checkDisruptionReferences(families.disruptions, feedback));
  problems.push(...checkLevelReferences(families, present, feel));

  if (bots !== undefined && feel !== undefined) problems.push(...checkBotReferences(bots, feel));
  if (feel !== undefined) {
    problems.push(...checkPropReferences(families.geometries, feel));
    problems.push(...checkPhysicsTuning(feel));
  }

  if (feedback !== undefined) problems.push(...(await checkFeedbackReferences(rootDir, feedback)));

  if (strings !== undefined) {
    problems.push(...checkStringReferences(parsed, strings, `content/${STRINGS_FILE.file}`));
    problems.push(...(await checkSourceReferences(rootDir, strings)));
  }
  return problems;
}
