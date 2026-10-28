import { hashJson } from '@shared/hash';
import { replayJournal } from '@sim';
import { describe, expect, it } from 'vitest';
import { createTestContent, createTestGeometry } from '../support/testContent.ts';
import { recordScenario, SCENARIOS } from './scenarios.ts';

/**
 * The golden compares hashes, which say nothing about what a scenario exercises. This pins that
 * `threat_trio` really is what it is there for: the director cycles through the three defs, each
 * unanswered threat ends in its gag, the stairs gag is a near miss, and the coffee-table gag pushes
 * the mug off the table onto the vase. A later edit of the feel fixture, the director or the
 * physics cannot silently turn it into three threats that gag with no consequence.
 */
const scenario = SCENARIOS.find((candidate) => candidate.name === 'threat_trio');
if (scenario === undefined) throw new Error('missing scenario threat_trio');
const content = createTestContent();
const geometry = createTestGeometry();
const { events, journal, worldHash } = await recordScenario(content, geometry, scenario);

const telegraphs = events.filter((event) => event.type === 'ThreatTelegraphed');
const gags = events.filter((event) => event.type === 'GagTriggered');
const { breakImpulseNs } = content.feel.physics.kinds.vase as { breakImpulseNs: number };

describe('golden scenario threat_trio covers what it is there for', () => {
  it('telegraphs the three defs, each at its own anchor, and cycles (picked by the PRNG, in no fixed order)', () => {
    const anchorOf = new Map(telegraphs.map((event) => [event.kind, event.anchorId]));
    expect(Object.fromEntries(anchorOf)).toEqual({
      outlet: 'outlet_01',
      stairs: 'stairs_top',
      coffee_table_object: 'coffee_table',
    });
    expect(new Set(telegraphs.slice(0, 3).map((event) => event.waveIndex))).toEqual(new Set([0]));
    expect(telegraphs.length).toBeGreaterThan(3);
  });

  it('ends each threat in its own gag', () => {
    const kindOf = new Map(telegraphs.map((event) => [event.threatId, event.kind]));
    const gagOf: Record<string, string> = {
      outlet: 'outlet_hair',
      stairs: 'stairs_slide',
      coffee_table_object: 'table_object_fall',
    };
    expect(gags.length).toBeGreaterThanOrEqual(3);
    for (const event of gags) expect(event.gag).toBe(gagOf[kindOf.get(event.threatId) ?? '']);
    expect(new Set(gags.map((event) => event.gag))).toEqual(new Set(Object.values(gagOf)));
  });

  it('emits a NearMiss for the stairs gag only, right after its GagTriggered, at the same time', () => {
    const nearMisses = events.filter((event) => event.type === 'NearMiss');
    const stairsGags = gags.filter((event) => event.gag === 'stairs_slide');
    expect(nearMisses.length).toBe(stairsGags.length);
    expect(nearMisses.length).toBeGreaterThan(0);
    for (const nearMiss of nearMisses) {
      const index = events.indexOf(nearMiss);
      expect(events[index - 1]).toMatchObject({
        type: 'GagTriggered',
        gag: 'stairs_slide',
        t: nearMiss.t,
        threatId: nearMiss.threatId,
      });
      expect(nearMiss).toMatchObject({ gag: 'stairs_slide' });
    }
  });

  it('drops the mug on the vase after the coffee-table gag, and breaks the vase once', () => {
    const tableGagIndex = events.findIndex(
      (event) => event.type === 'GagTriggered' && event.gag === 'table_object_fall',
    );
    expect(tableGagIndex).toBeGreaterThanOrEqual(0);
    const after = events.slice(tableGagIndex);
    expect(after).toContainEqual(expect.objectContaining({ type: 'PropImpact', propId: 'mug_01' }));
    const broken = events.filter((event) => event.type === 'PropBroken');
    expect(broken).toEqual([
      expect.objectContaining({ propId: 'vase_01', impulseNs: expect.any(Number) }),
    ]);
    const brokenEvent = broken[0];
    expect(brokenEvent?.type === 'PropBroken' && brokenEvent.impulseNs).toBeGreaterThanOrEqual(
      breakImpulseNs,
    );
    // The vase breaks after the gag that pushed the mug, never before.
    expect(events.indexOf(brokenEvent as (typeof events)[number])).toBeGreaterThan(tableGagIndex);
  });

  it('has no prop event before the coffee-table gag, and no other prop breaks later', () => {
    const tableGagIndex = events.findIndex(
      (event) => event.type === 'GagTriggered' && event.gag === 'table_object_fall',
    );
    expect(tableGagIndex).toBeGreaterThanOrEqual(0);
    const propEvents = new Set(['PropImpact', 'PropBroken']);
    expect(events.slice(0, tableGagIndex).some((event) => propEvents.has(event.type))).toBe(false);
  });

  it('leaves the mess at {propsOnFloor: 1, propsBroken: 1}, whatever the later gags do', async () => {
    const replay = await replayJournal({
      content,
      geometry,
      level: scenario.level,
      journal,
      untilSimMs: scenario.untilSimMs,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    const { world } = replay.value.sim;
    expect(world.mess).toEqual({ propsOnFloor: 1, propsBroken: 1 });
    expect(world.props.map((prop) => [prop.id, prop.isBroken, prop.isOnFloor])).toEqual([
      ['mug_01', false, true],
      ['vase_01', true, true],
    ]);
    replay.value.sim.dispose();
  });

  it('replays bit-identically', async () => {
    const replay = await replayJournal({
      content,
      geometry,
      level: scenario.level,
      journal,
      untilSimMs: scenario.untilSimMs,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(hashJson(replay.value.sim.world)).toBe(worldHash);
    replay.value.sim.dispose();
  });
});
