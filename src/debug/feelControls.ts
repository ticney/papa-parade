/**
 * What the feel panel shows, worked out from `z.toJSONSchema(FeelSchema)` and the current feel:
 * pure functions, no DOM and no Tweakpane, so a new key in `FeelSchema` appears in the panel with
 * no change here (story 2.1, D8). The panel (`feelPanel.ts`) only turns these descriptors into
 * Tweakpane blades.
 */

export type JsonSchema = Readonly<Record<string, unknown>>;

/** A step of a path: an object key, or an array index. */
export type PathStep = string | number;

interface BaseDescriptor {
  /** The key or index this control edits, as shown. */
  readonly label: string;
  /** Where it is in the feel: `['physics', 'kinds', 'mug', 'massKg']`. */
  readonly path: readonly PathStep[];
  /** The same, dotted: `physics.kinds.mug.massKg` (an index is `[0]`). */
  readonly pathKey: string;
  /** The schema's `.describe()` text, or `''`. */
  readonly hint: string;
  /** The sim reads this value only when a level starts: a change shows from the next level. */
  readonly isNextLevel: boolean;
}

export interface FolderDescriptor extends BaseDescriptor {
  readonly kind: 'folder';
  readonly children: readonly ControlDescriptor[];
}

export interface NumberDescriptor extends BaseDescriptor {
  readonly kind: 'number';
  readonly isInteger: boolean;
  /** The lowest value the schema allows (`minimum`, or `exclusiveMinimum`, which `isMinExclusive` flags). */
  readonly min?: number;
  readonly max?: number;
  readonly isMinExclusive: boolean;
  readonly isMaxExclusive: boolean;
  /** `1` for an integer; otherwise left to the pane. */
  readonly step?: number;
  /** Both bounds exist: a slider. Otherwise a plain number field. */
  readonly hasSlider: boolean;
}

export interface ListDescriptor extends BaseDescriptor {
  readonly kind: 'list';
  readonly options: readonly string[];
}

export interface BooleanDescriptor extends BaseDescriptor {
  readonly kind: 'boolean';
}

export interface TextDescriptor extends BaseDescriptor {
  readonly kind: 'text';
}

export type ControlDescriptor =
  | FolderDescriptor
  | NumberDescriptor
  | ListDescriptor
  | BooleanDescriptor
  | TextDescriptor;

/**
 * The feel keys the sim reads only when it creates a level (nav grids, Rapier, the first wander,
 * the start fatigue): changing them mid-level changes nothing until the next one (story 2.1 D5). A
 * trailing `.` is a whole section. Data, not a list of the feel's shape: a key missing here is just
 * not marked.
 *
 * Of `physics`, only `maxPushImpulseNs` and `impactCooldownMs` are read live (`propsSystem.ts`).
 * `gravityMps2` and the kinds' shape, mass, friction and restitution are given to Rapier when the
 * level is created, and `breakable` / `breakImpulseNs` are copied into the level's props then.
 * `impactMinImpulseNs` is checked live too, but Rapier filters the contacts at the threshold it was
 * created with: lowering it mid-level changes nothing, so it is a next-level key.
 */
export const NEXT_LEVEL_FEEL_KEYS: readonly string[] = [
  'movement.papaRadiusM',
  'baby.bodyRadiusM',
  'baby.babbleMinMs',
  'fatigue.startPoints',
  'physics.gravityMps2',
  'physics.impactMinImpulseNs',
  'physics.kinds.',
];

export const isNextLevelKey = (pathKey: string): boolean =>
  NEXT_LEVEL_FEEL_KEYS.some((key) =>
    key.endsWith('.') ? pathKey.startsWith(key) : pathKey === key,
  );

/** Integer bounds in the schema reach `Number.MAX_SAFE_INTEGER`: that is « no bound ». */
const NO_BOUND_FROM = Number.MAX_SAFE_INTEGER;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const finiteBound = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < NO_BOUND_FROM
    ? value
    : undefined;

export function pathKeyOf(path: readonly PathStep[]): string {
  let key = '';
  for (const step of path) {
    if (typeof step === 'number') key += `[${step}]`;
    else key += key === '' ? step : `.${step}`;
  }
  return key;
}

function base(path: readonly PathStep[], schema: JsonSchema): BaseDescriptor {
  const last = path[path.length - 1];
  const pathKey = pathKeyOf(path);
  return {
    label: last === undefined ? '' : typeof last === 'number' ? `[${last}]` : last,
    path,
    pathKey,
    hint: typeof schema.description === 'string' ? schema.description : '',
    isNextLevel: isNextLevelKey(pathKey),
  };
}

function numberControl(path: readonly PathStep[], schema: JsonSchema): NumberDescriptor {
  const isInteger = schema.type === 'integer';
  const minimum = finiteBound(schema.minimum);
  const exclusiveMinimum = finiteBound(schema.exclusiveMinimum);
  const maximum = finiteBound(schema.maximum);
  const exclusiveMaximum = finiteBound(schema.exclusiveMaximum);
  const min = minimum ?? exclusiveMinimum;
  const max = maximum ?? exclusiveMaximum;
  return {
    ...base(path, schema),
    kind: 'number',
    isInteger,
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
    isMinExclusive: minimum === undefined && exclusiveMinimum !== undefined,
    isMaxExclusive: maximum === undefined && exclusiveMaximum !== undefined,
    ...(isInteger ? { step: 1 } : {}),
    hasSlider: min !== undefined && max !== undefined,
  };
}

function describeNode(
  path: readonly PathStep[],
  schema: JsonSchema,
  value: unknown,
): ControlDescriptor | null {
  if (Array.isArray(schema.enum)) {
    return {
      ...base(path, schema),
      kind: 'list',
      options: schema.enum.filter((option): option is string => typeof option === 'string'),
    };
  }
  switch (schema.type) {
    case 'number':
    case 'integer':
      return numberControl(path, schema);
    case 'boolean':
      return { ...base(path, schema), kind: 'boolean' };
    case 'string':
      return { ...base(path, schema), kind: 'text' };
    case 'array': {
      const items = schema.items;
      if (!isRecord(items) || !Array.isArray(value)) return null;
      const children: ControlDescriptor[] = [];
      value.forEach((item, index) => {
        const child = describeNode([...path, index], items, item);
        if (child !== null) children.push(child);
      });
      return { ...base(path, schema), kind: 'folder', children };
    }
    case 'object': {
      const children: ControlDescriptor[] = [];
      if (isRecord(schema.properties)) {
        for (const [key, child] of Object.entries(schema.properties)) {
          // `$schema` points the editor at the JSON Schema: it is not a feel value.
          if (key === '$schema' || !isRecord(child)) continue;
          const described = describeNode(
            [...path, key],
            child,
            isRecord(value) ? value[key] : undefined,
          );
          if (described !== null) children.push(described);
        }
      } else if (isRecord(schema.additionalProperties) && isRecord(value)) {
        // A record (`physics.kinds`): its keys are data, so they come from the current feel.
        for (const key of Object.keys(value)) {
          const described = describeNode([...path, key], schema.additionalProperties, value[key]);
          if (described !== null) children.push(described);
        }
      }
      return { ...base(path, schema), kind: 'folder', children };
    }
    default:
      return null;
  }
}

/**
 * The root folder of the panel: one child folder per top-level section of the feel, nested folders
 * for nested objects (each `physics.kinds` entry included, its keys read from `feel`), one control
 * per leaf (one per item of an array). `schema` is `z.toJSONSchema(FeelSchema)`; `feel` is the
 * effective feel, which only names the keys of records and the length of arrays.
 */
export function describeFeelControls(schema: JsonSchema, feel: unknown): FolderDescriptor {
  const root = describeNode([], schema, feel);
  if (root === null || root.kind !== 'folder') {
    return { ...base([], schema), kind: 'folder', children: [] };
  }
  return root;
}

/** A control that is not a folder: it edits one value. */
export type LeafDescriptor = Exclude<ControlDescriptor, FolderDescriptor>;

/** Every leaf control under `descriptor`, depth first. */
export function leafControls(descriptor: ControlDescriptor): LeafDescriptor[] {
  if (descriptor.kind !== 'folder') return [descriptor];
  return descriptor.children.flatMap(leafControls);
}

export function getAtPath(root: unknown, path: readonly PathStep[]): unknown {
  let node: unknown = root;
  for (const step of path) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<PathStep, unknown>)[step];
  }
  return node;
}

/**
 * `value` without float noise: rounded to `step` when the schema gives one (an integer's is 1),
 * then to 12 significant digits, which removes what a slider's arithmetic adds (`0.30000000000000004`).
 */
export function cleanNumber(value: number, step?: number): number {
  if (!Number.isFinite(value)) return value;
  const stepped = step !== undefined && step > 0 ? Math.round(value / step) * step : value;
  return Number(stepped.toPrecision(12));
}

/** `node` with `value` set at `steps`, copying along the way: an object or array item is merged into, never replaced by the scalar. */
function withValue(node: unknown, steps: readonly PathStep[], value: unknown): unknown {
  const [step, ...rest] = steps;
  if (step === undefined) return value;
  if (typeof step === 'number') {
    const items: unknown[] = Array.isArray(node) ? structuredClone(node) : [];
    items[step] = withValue(items[step], rest, value);
    return items;
  }
  const copy: Record<string, unknown> = isRecord(node) ? structuredClone(node) : {};
  copy[step] = withValue(copy[step], rest, value);
  return copy;
}

/**
 * `patch` without the leaves `sent` holds with the same value (arrays compared whole): what is left
 * to save after `sent` was saved. A leaf changed again since keeps its newer value. Empty objects
 * are dropped. Neither argument is changed.
 */
export function subtractPatch(
  patch: Record<string, unknown>,
  sent: Record<string, unknown>,
): Record<string, unknown> {
  const left: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    const was = sent[key];
    if (isRecord(value) && isRecord(was)) {
      const rest = subtractPatch(value, was);
      if (Object.keys(rest).length > 0) left[key] = rest;
    } else if (JSON.stringify(value) !== JSON.stringify(was)) {
      left[key] = structuredClone(value);
    }
  }
  return left;
}

/**
 * The one-leaf `SetFeel` patch that sets `path` to `value`. Arrays are given whole: `feel` is the
 * feel the patch is laid over, and the patch holds its array with that item (or the field of that
 * item) replaced, the other items kept as they are in `feel`. Pass the feel the patch is for: the
 * effective one for the sim, the saved one (without a level's overrides) for `feel.json`. A number
 * goes through {@link cleanNumber} with the control's `step`.
 */
export function leafPatch(
  feel: unknown,
  path: readonly PathStep[],
  value: unknown,
  step?: number,
): Record<string, unknown> {
  const arrayAt = path.findIndex((s) => typeof s === 'number');
  const end = arrayAt < 0 ? path.length : arrayAt;
  if (end === 0) return {};
  const clean = typeof value === 'number' ? cleanNumber(value, step) : value;
  const leaf =
    arrayAt < 0
      ? clean
      : withValue(getAtPath(feel, path.slice(0, arrayAt)), path.slice(arrayAt), clean);
  const patch: Record<string, unknown> = {};
  let node = patch;
  for (let i = 0; i < end; i++) {
    const key = path[i] as string;
    if (i === end - 1) node[key] = leaf;
    else {
      const next: Record<string, unknown> = {};
      node[key] = next;
      node = next;
    }
  }
  return patch;
}

/** `patch` laid over `base`: objects merge key by key, anything else (arrays included) replaces. Neither is changed. */
export function mergePatch(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const before = merged[key];
    merged[key] =
      isRecord(before) && isRecord(value)
        ? mergePatch(before, value)
        : isRecord(value)
          ? mergePatch({}, value)
          : value;
  }
  return merged;
}

/** The dotted keys of every leaf of an overrides object (`timing.windowMs`, `mama.starThresholdPoints`): arrays are leaves. */
export function overrideLeafKeys(overrides: unknown, prefix = ''): string[] {
  if (!isRecord(overrides)) return [];
  const keys: string[] = [];
  for (const [key, value] of Object.entries(overrides)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (isRecord(value)) keys.push(...overrideLeafKeys(value, path));
    else keys.push(path);
  }
  return keys;
}

/** Whether the control at `pathKey` is set by a level override: the key itself, or an item of the array it sets. */
export function isOverriddenKey(pathKey: string, overrideKeys: ReadonlySet<string>): boolean {
  if (overrideKeys.has(pathKey)) return true;
  const bracket = pathKey.indexOf('[');
  return bracket >= 0 && overrideKeys.has(pathKey.slice(0, bracket));
}
