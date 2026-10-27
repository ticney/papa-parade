import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  NODE_PREFIXES,
  REQUIRED_ANCHOR_IDS,
  REQUIRED_ZONE_IDS,
  ZONE_KINDS,
} from '../../src/content/levelNodeNames.ts';

// The naming rules are written twice: in TypeScript (the extractor and the client use them) and in
// tools/blender/export_level.py (Blender checks them before it exports). This test reads the Python
// file as text and fails when the two differ. It does not run Python.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const python = readFileSync(join(root, 'tools', 'blender', 'export_level.py'), 'utf8');

function pythonString(name: string): string {
  const match = new RegExp(`^${name} = "([^"]*)"$`, 'm').exec(python);
  if (match === null) throw new Error(`export_level.py has no ${name} = "…"`);
  return match[1] as string;
}

function pythonTuple(name: string): string[] {
  const match = new RegExp(`^${name} = \\(([^)]*)\\)`, 'm').exec(python);
  if (match === null) throw new Error(`export_level.py has no ${name} = (…)`);
  return [...(match[1] as string).matchAll(/"([^"]*)"/g)].map((m) => m[1] as string);
}

describe('Blender naming conventions: Python and TypeScript agree', () => {
  it.each([
    ['PREFIX_COL', NODE_PREFIXES.col],
    ['PREFIX_NAV_FLOOR', NODE_PREFIXES.navFloor],
    ['PREFIX_NAV_BLOCK', NODE_PREFIXES.navBlock],
    ['PREFIX_ANCHOR', NODE_PREFIXES.anchor],
    ['PREFIX_ZONE', NODE_PREFIXES.zone],
    ['PREFIX_PROP', NODE_PREFIXES.prop],
  ])('%s', (name, expected) => {
    expect(pythonString(name)).toBe(expected);
  });

  it('the required anchors', () => {
    expect(pythonTuple('REQUIRED_ANCHOR_IDS')).toEqual([...REQUIRED_ANCHOR_IDS]);
  });

  it('the required zones', () => {
    expect(pythonTuple('REQUIRED_ZONE_IDS')).toEqual([...REQUIRED_ZONE_IDS]);
  });

  it('the zone kinds', () => {
    expect(pythonTuple('ZONE_KINDS')).toEqual([...ZONE_KINDS]);
  });

  it('the shape of a prop name and of the reserved-looking prefixes', () => {
    expect(python).toContain('PROP_SHAPE = re.compile(r"^PROP_([a-z][a-z0-9_]*)_(\\d{2})$")');
    expect(python).toContain(
      'RESERVED_LOOKING = re.compile(r"^(?:col|nav|anchors?|props?|zones?)(?![a-z0-9])", re.IGNORECASE)',
    );
  });
});
