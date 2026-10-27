import { err, ok, type Result } from '@shared/result';

/**
 * The single TypeScript source of the Blender naming rules (game-architecture › Conventions de
 * nommage › Assets de jeu). `tools/assets/extractLevelGeometry.ts` and the client use it;
 * `tools/blender/export_level.py` repeats the same constants in Python, and
 * `tests/architecture/blenderConventions.test.ts` fails when the two differ.
 *
 * Pure: no `three`, no I/O.
 */

/** Kinds of node the pipeline knows. `visual` is a mesh (or empty) with no prefix. */
export type NodeKind = 'col' | 'navFloor' | 'navBlock' | 'anchor' | 'zone' | 'prop' | 'visual';

/** What a `ZONE_<kind>_<name>` volume means to the game. */
export const ZONE_KINDS = ['hidden', 'safe', 'creak'] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

/** The prefix of each kind of node, as written in Blender. */
export const NODE_PREFIXES = {
  col: 'COL_',
  navFloor: 'NAV_floor',
  navBlock: 'NAV_block_',
  anchor: 'ANCHOR_',
  zone: 'ZONE_',
  prop: 'PROP_',
} as const;

/** The anchors every level must have (AC 1 of story 1.6): ids without the `ANCHOR_` prefix. */
export const REQUIRED_ANCHOR_IDS = [
  'papa_spawn',
  'baby_spawn',
  'outlet_01',
  'stairs_top',
  'coffee_table',
  'phone',
  'coffee_machine',
  'door',
] as const;

/** The zones every level must have: ids without the `ZONE_<kind>_` prefix. */
export const REQUIRED_ZONE_IDS = ['behind_sofa'] as const;

/** `lower_snake_case`, starting with a letter. */
export const SNAKE_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

export interface ParsedNodeName {
  kind: NodeKind;
  /** The name without its prefix (`sofa` for `COL_sofa`, `mug_01` for `PROP_mug_01`, `floor` for `NAV_floor`). */
  id: string;
  /** For a `prop`: `mug` in `PROP_mug_01`. For a `zone`: `hidden` in `ZONE_hidden_behind_sofa`. */
  subKind?: string;
}

const PROP_PATTERN = /^PROP_([a-z][a-z0-9_]*)_(\d{2})$/;
// A name that *looks* like it wants to be a gameplay node must be one: `col_sofa`, `ANCHORS_x`,
// `COL` alone are mistakes, not visuals. `collar` or `navigation` are fine (the prefix word ends).
const RESERVED_LOOKING = /^(?:col|nav|anchors?|props?|zones?)(?![a-z0-9])/i;

/**
 * Classifies one Blender object name. A name that breaks the shape of its prefix is an `err` that
 * names the rule, never a visual mesh.
 */
export function parseNodeName(name: string): Result<ParsedNodeName, string> {
  if (name === NODE_PREFIXES.navFloor) return ok({ kind: 'navFloor', id: 'floor' });

  const prefixed = (prefix: string, kind: NodeKind, what: string) => {
    const rest = name.slice(prefix.length);
    if (!SNAKE_ID_PATTERN.test(rest)) {
      return err(`"${name}": after "${prefix}" ${what} must be lower_snake_case`);
    }
    return ok<ParsedNodeName>({ kind, id: rest });
  };

  if (name.startsWith(NODE_PREFIXES.col)) return prefixed(NODE_PREFIXES.col, 'col', 'the name');
  if (name.startsWith(NODE_PREFIXES.navBlock)) {
    return prefixed(NODE_PREFIXES.navBlock, 'navBlock', 'the name');
  }
  if (name.startsWith(NODE_PREFIXES.anchor)) {
    return prefixed(NODE_PREFIXES.anchor, 'anchor', 'the id');
  }
  if (name.startsWith(NODE_PREFIXES.zone)) {
    const [, zoneKind, id] = /^ZONE_([a-z]+)_(.+)$/.exec(name) ?? [];
    if (zoneKind === undefined || id === undefined || !isZoneKind(zoneKind)) {
      return err(`"${name}": a zone is ZONE_<${ZONE_KINDS.join('|')}>_<name>`);
    }
    if (!SNAKE_ID_PATTERN.test(id)) return err(`"${name}": the zone name must be lower_snake_case`);
    return ok({ kind: 'zone', id, subKind: zoneKind });
  }
  if (name.startsWith(NODE_PREFIXES.prop)) {
    const match = PROP_PATTERN.exec(name);
    if (match === null) return err(`"${name}": a prop is PROP_<kind>_<nn> (two-digit index)`);
    return ok({ kind: 'prop', id: `${match[1]}_${match[2]}`, subKind: match[1] as string });
  }

  if (name === 'NAV' || name.startsWith('NAV_')) {
    return err(`"${name}": a navigation node is NAV_floor or NAV_block_<name>`);
  }
  if (RESERVED_LOOKING.test(name)) {
    return err(
      `"${name}": looks like a gameplay node but breaks the shape (COL_, NAV_floor, NAV_block_, ANCHOR_, ZONE_, PROP_ in capitals)`,
    );
  }
  if (!SNAKE_ID_PATTERN.test(name)) {
    return err(`"${name}": a visual node is lower_snake_case (no capitals, spaces or ".001")`);
  }
  return ok({ kind: 'visual', id: name });
}

function isZoneKind(value: string): value is ZoneKind {
  return (ZONE_KINDS as readonly string[]).includes(value);
}

/** True for a well-formed visual name (no prefix): the nodes the client keeps and the bounds cover. */
export function isVisualNodeName(name: string): boolean {
  const parsed = parseNodeName(name);
  return parsed.ok && parsed.value.kind === 'visual';
}
