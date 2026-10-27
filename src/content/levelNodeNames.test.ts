import { describe, expect, it } from 'vitest';
import {
  isVisualNodeName,
  NODE_PREFIXES,
  parseNodeName,
  REQUIRED_ANCHOR_IDS,
  REQUIRED_ZONE_IDS,
  ZONE_KINDS,
} from './levelNodeNames.ts';

describe('parseNodeName', () => {
  it.each([
    ['COL_sofa', { kind: 'col', id: 'sofa' }],
    ['COL_side_table', { kind: 'col', id: 'side_table' }],
    ['NAV_floor', { kind: 'navFloor', id: 'floor' }],
    ['NAV_block_coffee_table', { kind: 'navBlock', id: 'coffee_table' }],
    ['ANCHOR_papa_spawn', { kind: 'anchor', id: 'papa_spawn' }],
    ['ANCHOR_outlet_01', { kind: 'anchor', id: 'outlet_01' }],
    ['PROP_mug_01', { kind: 'prop', id: 'mug_01', subKind: 'mug' }],
    ['PROP_toy_car_12', { kind: 'prop', id: 'toy_car_12', subKind: 'toy_car' }],
    ['ZONE_hidden_behind_sofa', { kind: 'zone', id: 'behind_sofa', subKind: 'hidden' }],
    ['ZONE_safe_playmat', { kind: 'zone', id: 'playmat', subKind: 'safe' }],
    ['ZONE_creak_old_board', { kind: 'zone', id: 'old_board', subKind: 'creak' }],
    ['sofa', { kind: 'visual', id: 'sofa' }],
    ['wall_back', { kind: 'visual', id: 'wall_back' }],
    ['collar', { kind: 'visual', id: 'collar' }],
    ['navigation_sign', { kind: 'visual', id: 'navigation_sign' }],
    ['property_box', { kind: 'visual', id: 'property_box' }],
  ])('classifies %s', (name, expected) => {
    expect(parseNodeName(name)).toEqual({ ok: true, value: expected });
  });

  it.each([
    'COL',
    'COL_',
    'COL_Sofa',
    'col_sofa',
    'COLLIDER_sofa',
    'ANCHORS_x',
    'ANCHOR_',
    'ANCHOR_Door',
    'NAV_',
    'NAV_block_',
    'NAV_floor_2',
    'NAV_walkable',
    'PROP_mug',
    'PROP_mug_1',
    'PROP_mug_001',
    'PROP_Mug_01',
    'ZONE_hidden',
    'ZONE_scary_basement',
    'ZONE_hidden_Behind',
    'prop_mug_01',
    'zone_hidden_x',
    'Sofa',
    'sofa.001',
    'wall back',
    '_hidden',
    '',
  ])('refuses %j and says why', (name) => {
    const parsed = parseNodeName(name);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain(`"${name}"`);
  });
});

describe('isVisualNodeName', () => {
  it('is true for a well-formed visual name only', () => {
    expect(isVisualNodeName('floor')).toBe(true);
    expect(isVisualNodeName('COL_sofa')).toBe(false);
    expect(isVisualNodeName('col_sofa')).toBe(false);
  });
});

describe('the conventions', () => {
  it('requires eight anchors and the hidden zone behind the sofa', () => {
    expect(REQUIRED_ANCHOR_IDS).toHaveLength(8);
    expect(REQUIRED_ANCHOR_IDS).toContain('papa_spawn');
    expect(REQUIRED_ZONE_IDS).toEqual(['behind_sofa']);
  });

  it('has a prefix for every kind of gameplay node', () => {
    expect(Object.values(NODE_PREFIXES)).toEqual([
      'COL_',
      'NAV_floor',
      'NAV_block_',
      'ANCHOR_',
      'ZONE_',
      'PROP_',
    ]);
    expect(ZONE_KINDS).toEqual(['hidden', 'safe', 'creak']);
  });
});
