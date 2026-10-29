import { log } from '@shared/log';
import { createSim } from '@sim';
import { beforeAll, describe, expect, it } from 'vitest';
import { createFakeRoot, type FakeElement } from '../../tests/support/fakeDom.ts';
import { createFakeTestHost } from '../../tests/support/fakeTestHost.ts';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
} from '../../tests/support/testContent.ts';
import { createStateInspector } from './stateInspector.ts';

beforeAll(() => {
  log.setLevel('error');
});

async function rig() {
  const sim = await createSim({
    content: createTestContent(),
    geometry: createTestGeometry(),
    level: createTestLevel(),
    seed: 5,
  });
  // The session knows no active level yet: it is set after the `onLevelStarted` listeners ran.
  const host = createFakeTestHost({ levelSession: { active: null } as never });
  const root = createFakeRoot();
  const inspector = createStateInspector(host, root);
  const summary = (): string =>
    (root.findAll('pp-debug-inspector-summary')[0] as FakeElement).textContent;
  const slices = root.findAll('pp-debug-slice');
  const openAll = (): void => {
    for (const slice of slices) (slice as unknown as { open: boolean }).open = true;
  };
  const sliceText = (name: string): string => {
    const slice = slices.find((candidate) => candidate.children[0]?.textContent === name);
    if (slice === undefined) throw new Error(`no slice ${name}`);
    return (slice.children[1] as FakeElement).textContent;
  };
  return { sim, host, root, inspector, summary, slices, openAll, sliceText };
}

describe('createStateInspector', () => {
  it('says no level is running until there is one', async () => {
    const { inspector, summary } = await rig();
    inspector.setActive(true);
    expect(summary()).toBe('no level is running');
  });

  it('shows the new world at once when a level starts, from the started level (the session has no active one yet)', async () => {
    const { host, sim, inspector, summary } = await rig();
    inspector.setActive(true);
    host.fireLevelStarted({ sim } as never);
    expect(summary()).toContain('t 0 ms');
    expect(summary()).toContain('flow playing');
  });

  it('lists the rng and nextId slices, with the others, in blocks that fill when opened', async () => {
    const { host, sim, inspector, slices, openAll, sliceText } = await rig();
    expect(slices.map((slice) => slice.children[0]?.textContent)).toEqual(
      expect.arrayContaining(['time', 'threats', 'score', 'rng', 'nextId', 'feel']),
    );
    inspector.setActive(true);
    host.fireLevelStarted({ sim } as never);
    // Closed blocks are not rendered.
    expect(sliceText('rng')).toBe('');
    openAll();
    host.fireLevelStarted({ sim } as never);
    expect(JSON.parse(sliceText('rng'))).toEqual(sim.world.rng);
    expect(JSON.parse(sliceText('nextId'))).toBe(sim.world.nextId);
  });

  it('refreshes nothing while inactive', async () => {
    const { host, sim, summary } = await rig();
    host.fireLevelStarted({ sim } as never);
    expect(summary()).toBe('');
  });

  it('logs a warning and goes on when reading the world throws: the listeners of the game are not broken', async () => {
    const { host, inspector, summary } = await rig();
    inspector.setActive(true);
    const broken = {
      sim: {
        get world(): never {
          throw new Error('world exploded');
        },
      },
    };
    expect(() => host.fireLevelStarted(broken as never)).not.toThrow();
    expect(() => host.fireRenderedFrame(1000)).not.toThrow();
    const warning = log
      .buffer()
      .reverse()
      .find((entry) => entry.message.startsWith('state inspector: refresh on a new level'));
    expect(warning?.level).toBe('warn');
    expect(summary()).toBe('no level is running');
  });
});
