import type { ActiveLevel, LevelSession, StartedLevel } from '@client/app/levelSession';
import type { Feel } from '@content/schemas/feel';
import {
  FEEL_WRITER_ENDPOINT,
  FEEL_WRITER_HEADER,
  FEEL_WRITER_HEADER_VALUE,
} from '@shared/constants';
import { log } from '@shared/log';
import { asSimMs } from '@shared/time';
import { createSim, type Sim } from '@sim';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  type FakeBinding,
  FakeCssStyleSheet,
  FakeDocument,
  FakeNode,
  FakePane,
  FakeStyleElement,
  fakePaneControl,
} from '../../tests/support/fakePane.ts';
import { createFakeTestHost, type FakeTestHost } from '../../tests/support/fakeTestHost.ts';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  OUTLET,
  testWave,
} from '../../tests/support/testContent.ts';
import { createFeelPanel, type FeelPanel } from './feelPanel.ts';

vi.mock('tweakpane', async () => {
  const fakes = await import('../../tests/support/fakePane.ts');
  return { Pane: fakes.FakePane };
});

beforeAll(() => {
  log.setLevel('error');
});

const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});

afterEach(() => {
  warnSpy.mockClear();
  FakePane.instances = [];
  fakePaneControl.throwOnCreate = false;
  vi.unstubAllGlobals();
});

const levelOf = (feelOverrides: Record<string, unknown> = {}) =>
  createTestLevel({
    waves: [testWave([OUTLET], { gapMinMs: 2000, gapMaxMs: 2000 })],
    feelOverrides,
  });

async function newSim(feel: Feel, level = levelOf()): Promise<Sim> {
  return createSim({
    content: { ...createTestContent(), feel },
    geometry: createTestGeometry(),
    level,
    seed: 1,
    strictInvariants: true,
  });
}

interface FakeSession {
  active: ActiveLevel | null;
  current: { levelId: string; seed: number | null; feel: Feel };
  rememberFeel: ReturnType<typeof vi.fn>;
}

interface Rig {
  panel: FeelPanel;
  host: FakeTestHost;
  session: FakeSession;
  sim: Sim;
  doc: FakeDocument;
  container: FakeNode;
  fetchFn: ReturnType<typeof vi.fn>;
  /** The newest pane. */
  pane(): FakePane;
  /** The binding at `['timing', 'windowMs']`: folder titles, then the key. */
  binding(...path: string[]): FakeBinding;
  status(): string;
  saveButton(): { disabled: boolean; click(): void };
  setOpen(isOpen: boolean): void;
}

const activeOf = (sim: Sim, feel: Feel, level = levelOf()): ActiveLevel => ({
  sim,
  level,
  timeMap: {} as never,
  geometry: createTestGeometry(),
  feel,
});

const startedOf = (sim: Sim, feel: Feel, level = levelOf()): StartedLevel => ({
  sim,
  levelId: 'salon_crawler',
  seed: 1,
  level,
  feel,
});

const response = (status: number, body: unknown): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

async function createRig(options: { isOpen?: boolean; fetchStatus?: number } = {}): Promise<Rig> {
  const feel = createTestContent().feel;
  const sim = await newSim(feel);
  const session: FakeSession = {
    active: activeOf(sim, feel),
    current: { levelId: 'salon_crawler', seed: 1, feel },
    rememberFeel: vi.fn((next: Feel) => {
      session.current = { ...session.current, feel: next };
    }),
  };
  const host = createFakeTestHost({ levelSession: session as unknown as LevelSession });
  const doc = new FakeDocument();
  const container = new FakeNode('div', doc);
  let isOpen = options.isOpen ?? true;
  const fetchFn = vi.fn(async (_url: unknown, _init?: unknown) =>
    response(options.fetchStatus ?? 200, { ok: true, message: 'saved' }),
  );
  const panel = createFeelPanel({
    host,
    container: container as unknown as HTMLElement,
    fetchFn: fetchFn as unknown as typeof fetch,
    isOpen: () => isOpen,
  });
  const pane = (): FakePane => FakePane.instances[FakePane.instances.length - 1] as FakePane;
  return {
    panel,
    host,
    session,
    sim,
    doc,
    container,
    fetchFn,
    pane,
    binding(...path) {
      let folder = pane() as { folders: FakePane['folders']; bindings: FakePane['bindings'] };
      for (const title of path.slice(0, -1)) {
        const next = folder.folders.find((candidate) => candidate.title === title);
        if (next === undefined) throw new Error(`no folder ${title}`);
        folder = next;
      }
      const key = path[path.length - 1];
      const found = folder.bindings.find((candidate) => candidate.key === key);
      if (found === undefined) throw new Error(`no binding ${path.join('.')}`);
      return found;
    },
    status: () => container.findAll('pp-debug-feel-status')[0]?.textContent ?? '',
    saveButton() {
      const button = pane().buttons.find((candidate) => candidate.title === 'Enregistrer');
      if (button === undefined) throw new Error('no save button');
      return button;
    },
    setOpen(next) {
      isOpen = next;
    },
  };
}

const setFeelPatches = (sim: Sim): unknown[] =>
  sim
    .journal()
    .entries.filter((entry) => entry.command.type === 'SetFeel')
    .map((entry) => (entry.command as { patch: unknown }).patch);

const lastFetchBody = (fetchFn: ReturnType<typeof vi.fn>, call = -1): unknown => {
  const calls = fetchFn.mock.calls;
  const init = calls.at(call)?.[1] as { body: string };
  return JSON.parse(init.body);
};

describe('what the pane shows', () => {
  it('makes one folder per section of the feel, with a control per leaf and a save button', async () => {
    const { pane, binding, saveButton } = await createRig();
    const titles = pane().folders.map((folder) => folder.title);
    expect(titles).toContain('timing');
    expect(titles).toContain('physics');
    expect(binding('timing', 'windowMs').holder.windowMs).toBe(300);
    expect(saveButton().disabled).toBe(true);
  });

  it('shows each hint as visible text under its label, and a tap on the label hides it', async () => {
    const { binding } = await createRig();
    const windowMs = binding('timing', 'windowMs');
    // Under the label: the note follows the blade in the folder.
    const siblings = windowMs.element.parent?.children ?? [];
    const note = siblings[siblings.indexOf(windowMs.element) + 1];
    expect(note?.className).toBe('pp-debug-feel-hint');
    expect(note?.textContent).toBe('Standard response window, in ms (GDD §1).');
    expect(note?.hidden).toBe(false);
    windowMs.label.dispatch('click');
    expect(note?.hidden).toBe(true);
    windowMs.label.dispatch('click');
    expect(note?.hidden).toBe(false);
  });

  it('shows the description of a folder as text too, not only a tooltip', async () => {
    const { pane } = await createRig();
    const timing = pane().folders.find((folder) => folder.title === 'timing');
    const note = timing?.content.children[0];
    expect(note?.className).toBe('pp-debug-feel-folder-note');
    expect(note?.textContent).toMatch(/\S/);
  });

  it('marks a key read at the next level, and a key a level override sets', async () => {
    const feel = createTestContent().feel;
    const sim = await newSim(feel);
    const rig = await createRig();
    rig.session.active = null;
    rig.host.fireLevelStarted(startedOf(sim, feel, levelOf({ timing: { windowMs: 300 } })));
    expect(rig.binding('physics', 'gravityMps2').params.label).toBe('gravityMps2 ⏭');
    expect(rig.binding('physics', 'maxPushImpulseNs').params.label).toBe('maxPushImpulseNs');
    expect(rig.binding('timing', 'windowMs').params.label).toBe('windowMs ★');
    expect(rig.binding('timing', 'perfectMs').params.label).toBe('perfectMs');
    sim.dispose();
  });
});

describe('a level start', () => {
  it('builds from the StartedLevel it is given while levelSession.active is still null', async () => {
    const rig = await createRig();
    const overridden = createTestContent().feel;
    overridden.timing.windowMs = 250;
    const next = await newSim(overridden, levelOf({ timing: { windowMs: 250 } }));
    rig.session.active = null;
    rig.host.fireLevelStarted(startedOf(next, overridden, levelOf({ timing: { windowMs: 250 } })));
    expect(FakePane.instances).toHaveLength(2);
    expect(rig.binding('timing', 'windowMs').holder.windowMs).toBe(250);
    expect(rig.binding('timing', 'windowMs').params.label).toContain('★');
    // Once the app sets `active`, an edit goes to that sim, and is checked against its feel.
    rig.session.active = activeOf(next, overridden);
    rig.binding('timing', 'perfectMs').emit(260);
    expect(setFeelPatches(next)).toEqual([]);
    expect(rig.status()).toContain('perfectMs');
    rig.binding('timing', 'perfectMs').emit(200);
    expect(setFeelPatches(next)).toEqual([{ timing: { perfectMs: 200 } }]);
    expect(setFeelPatches(rig.sim)).toEqual([]);
    next.dispose();
  });

  it('shows the SetFeels the new sim still holds (a restart replays the tweaks at t=0)', async () => {
    const rig = await createRig();
    const feel = createTestContent().feel;
    const next = await newSim(feel);
    next.enqueue({ type: 'SetFeel', t: asSimMs(0), patch: { timing: { windowMs: 222 } } });
    rig.session.active = null;
    rig.host.fireLevelStarted(startedOf(next, feel));
    expect(rig.binding('timing', 'windowMs').holder.windowMs).toBe(222);
    next.dispose();
  });

  it('does not rebuild while the overlay is closed, and rebuild() brings it up to date', async () => {
    const rig = await createRig();
    rig.setOpen(false);
    const feel = createTestContent().feel;
    const next = await newSim(feel);
    rig.session.active = null;
    rig.host.fireLevelStarted(startedOf(next, feel));
    expect(FakePane.instances).toHaveLength(1);
    // The overlay opens: it rebuilds, without argument, from the running level.
    rig.session.active = activeOf(next, feel);
    rig.setOpen(true);
    rig.panel.rebuild();
    expect(FakePane.instances).toHaveLength(2);
    expect(FakePane.instances[0]?.isDisposed).toBe(true);
    next.dispose();
  });

  it('rebuilds at the level start when the overlay is open, disposing the old pane', async () => {
    const rig = await createRig();
    const feel = createTestContent().feel;
    const next = await newSim(feel);
    rig.host.fireLevelStarted(startedOf(next, feel));
    expect(FakePane.instances).toHaveLength(2);
    expect(FakePane.instances[0]?.isDisposed).toBe(true);
    next.dispose();
  });

  it('does not take the game down when the rebuild throws: it warns', async () => {
    const rig = await createRig();
    const feel = createTestContent().feel;
    const next = await newSim(feel);
    fakePaneControl.throwOnCreate = true;
    expect(() => rig.host.fireLevelStarted(startedOf(next, feel))).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      'debug',
      expect.stringContaining('could not rebuild'),
      expect.any(Error),
    );
    next.dispose();
  });

  it('rebuilds instead of sending to another level when the pane is stale', async () => {
    const rig = await createRig();
    const feel = createTestContent().feel;
    const other = await newSim(feel);
    rig.session.active = activeOf(other, feel);
    rig.binding('timing', 'windowMs').emit(250);
    expect(setFeelPatches(rig.sim)).toEqual([]);
    expect(setFeelPatches(other)).toEqual([]);
    expect(rig.status()).toContain('level changed');
    expect(FakePane.instances).toHaveLength(2);
    other.dispose();
  });
});

describe('an edit', () => {
  it('sends the one-leaf SetFeel at the sim time, remembers it for a restart, and enables Save', async () => {
    const rig = await createRig();
    rig.binding('timing', 'windowMs').emit(250);
    expect(setFeelPatches(rig.sim)).toEqual([{ timing: { windowMs: 250 } }]);
    expect(rig.sim.journal().entries[0]?.command).toMatchObject({ type: 'SetFeel', t: 0 });
    expect(rig.session.rememberFeel).toHaveBeenCalledTimes(1);
    expect(rig.session.current.feel.timing.windowMs).toBe(250);
    expect(rig.status()).toBe('sent timing.windowMs = 250');
    expect(rig.saveButton().disabled).toBe(false);
  });

  it('says « next level » for a key the sim reads at creation', async () => {
    const rig = await createRig();
    rig.binding('physics', 'gravityMps2').emit(5);
    expect(rig.status()).toBe('sent physics.gravityMps2 = 5 (next level)');
  });

  it('waits for the final change: a drag in progress sends nothing', async () => {
    const rig = await createRig();
    rig.binding('timing', 'windowMs').emit(240, false);
    rig.binding('timing', 'windowMs').emit(245, false);
    expect(setFeelPatches(rig.sim)).toEqual([]);
    expect(rig.saveButton().disabled).toBe(true);
    rig.binding('timing', 'windowMs').emit(250, true);
    expect(setFeelPatches(rig.sim)).toHaveLength(1);
  });

  it('puts a value with float noise right in the SetFeel and on the control', async () => {
    const rig = await createRig();
    const timeScale = rig.binding('timing', 'slowMoPerfect', 'timeScale');
    timeScale.emit(0.1 + 0.2);
    expect(setFeelPatches(rig.sim)).toEqual([{ timing: { slowMoPerfect: { timeScale: 0.3 } } }]);
    expect(timeScale.holder.timeScale).toBe(0.3);
    expect(rig.status()).toBe('sent timing.slowMoPerfect.timeScale = 0.3');
  });

  it('sends a whole array for an item of an array', async () => {
    const rig = await createRig();
    const base = createTestContent().feel.mama.starThresholdPoints;
    rig.binding('mama', 'starThresholdPoints', '1').emit(50);
    expect(setFeelPatches(rig.sim)).toEqual([
      { mama: { starThresholdPoints: base.map((p, i) => (i === 1 ? 50 : p)) } },
    ]);
  });

  it('checks a second edit against the first, which the sim has not applied yet', async () => {
    const rig = await createRig();
    rig.binding('timing', 'windowMs').emit(150);
    // 175 <= 300 (the sim's feel) but > 150 (the feel the sim will have).
    rig.binding('timing', 'perfectMs').emit(175);
    expect(setFeelPatches(rig.sim)).toEqual([{ timing: { windowMs: 150 } }]);
    expect(rig.status()).toContain('perfectMs');
  });

  describe('refused', () => {
    it('sends nothing, shows the schema message, logs a warn, and puts the control back', async () => {
      const rig = await createRig();
      const perfectMs = rig.binding('timing', 'perfectMs');
      perfectMs.emit(1_000_000);
      expect(setFeelPatches(rig.sim)).toEqual([]);
      expect(rig.status()).toContain('timing.perfectMs');
      expect(warnSpy).toHaveBeenCalledWith(
        'debug',
        expect.stringContaining('timing.perfectMs refused'),
        { reason: expect.any(String) },
      );
      expect(perfectMs.holder.perfectMs).toBe(100);
    });

    it('is not re-sent as a valid one when the control is put back (the revert emits a change)', async () => {
      const rig = await createRig();
      const perfectMs = rig.binding('timing', 'perfectMs');
      perfectMs.emit(1_000_000);
      // The fake, like Tweakpane, emitted a final `change` with 100 on the revert: it was ignored.
      expect(setFeelPatches(rig.sim)).toEqual([]);
      expect(rig.session.rememberFeel).not.toHaveBeenCalled();
      expect(rig.status()).not.toContain('sent');
      expect(rig.status()).toContain('timing.perfectMs');
      // `unsaved` stays empty: Save is still disabled.
      expect(rig.saveButton().disabled).toBe(true);
    });

    it('leaves the feel it is checked against unchanged: the next valid edit sees the old value', async () => {
      const rig = await createRig();
      rig.binding('timing', 'windowMs').emit(-5);
      rig.binding('timing', 'perfectMs').emit(150);
      // Valid only if windowMs is still 300 and not the refused -5.
      expect(setFeelPatches(rig.sim)).toEqual([{ timing: { perfectMs: 150 } }]);
    });

    it('refuses a key that is not in the feel (a patch the sim would drop)', async () => {
      const rig = await createRig();
      // A control cannot be made for a new record key, but a patch for one is refused all the same.
      const { applyFeelPatch } = await import('./feelPatch.ts');
      const feel = createTestContent().feel;
      expect(applyFeelPatch(feel, { physics: { kinds: { new_kind: {} } } }).ok).toBe(false);
      expect(setFeelPatches(rig.sim)).toEqual([]);
    });
  });

  it('is refused once the level has ended, and says so', async () => {
    const rig = await createRig();
    (rig.sim.world as unknown as { flow: { state: string } }).flow.state = 'ended';
    const windowMs = rig.binding('timing', 'windowMs');
    windowMs.emit(250);
    expect(setFeelPatches(rig.sim)).toEqual([]);
    expect(rig.status()).toContain('ended');
    expect(windowMs.holder.windowMs).toBe(300);
    expect(rig.saveButton().disabled).toBe(true);
  });

  it('is refused when no level is running, and the control goes back', async () => {
    const rig = await createRig();
    rig.session.active = null;
    const windowMs = rig.binding('timing', 'windowMs');
    windowMs.emit(250);
    expect(setFeelPatches(rig.sim)).toEqual([]);
    expect(rig.status()).toBe('no level is running');
    expect(windowMs.holder.windowMs).toBe(300);
  });

  it('warns and tells the user when the change cannot be kept for a restart', async () => {
    const rig = await createRig();
    // A base that was tuned so that this change breaks `perfectMs <= windowMs` there, not in the sim.
    const tuned = createTestContent().feel;
    tuned.timing.perfectMs = 280;
    rig.session.current = { ...rig.session.current, feel: tuned };
    rig.binding('timing', 'windowMs').emit(250);
    expect(setFeelPatches(rig.sim)).toEqual([{ timing: { windowMs: 250 } }]);
    expect(rig.session.rememberFeel).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'debug',
      expect.stringContaining('timing.windowMs not kept for a restart'),
      { reason: expect.any(String) },
    );
    expect(rig.status()).toContain('will not survive a restart');
    // It is still sent, and still saved.
    expect(rig.saveButton().disabled).toBe(false);
  });
});

describe('Save', () => {
  it('posts { file, patch } with every change since the last save, JSON and the writer header', async () => {
    const rig = await createRig();
    rig.binding('timing', 'windowMs').emit(250);
    rig.binding('timing', 'perfectMs').emit(120);
    rig.binding('movement', 'walkSpeedMps').emit(2);
    rig.saveButton().click();
    await vi.waitFor(() => expect(rig.fetchFn).toHaveBeenCalledTimes(1));
    const [url, init] = rig.fetchFn.mock.calls[0] as [string, { method: string; headers: object }];
    expect(url).toBe(FEEL_WRITER_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      [FEEL_WRITER_HEADER]: FEEL_WRITER_HEADER_VALUE,
    });
    expect(lastFetchBody(rig.fetchFn)).toEqual({
      file: 'content/feel.json',
      patch: {
        timing: { windowMs: 250, perfectMs: 120 },
        movement: { walkSpeedMps: 2 },
      },
    });
  });

  it('accumulates the same leaf as its last value, not twice', async () => {
    const rig = await createRig();
    rig.binding('timing', 'windowMs').emit(250);
    rig.binding('timing', 'windowMs').emit(260);
    rig.saveButton().click();
    await vi.waitFor(() => expect(rig.fetchFn).toHaveBeenCalledTimes(1));
    expect(lastFetchBody(rig.fetchFn)).toEqual({
      file: 'content/feel.json',
      patch: { timing: { windowMs: 260 } },
    });
  });

  it('clears what was saved after a 200: the button is disabled and the next save sends only newer edits', async () => {
    const rig = await createRig();
    rig.binding('timing', 'windowMs').emit(250);
    rig.saveButton().click();
    await vi.waitFor(() => expect(rig.status()).toBe('saved'));
    expect(rig.saveButton().disabled).toBe(true);
    rig.binding('movement', 'walkSpeedMps').emit(2);
    expect(rig.saveButton().disabled).toBe(false);
    rig.saveButton().click();
    await vi.waitFor(() => expect(rig.fetchFn).toHaveBeenCalledTimes(2));
    expect(lastFetchBody(rig.fetchFn)).toEqual({
      file: 'content/feel.json',
      patch: { movement: { walkSpeedMps: 2 } },
    });
  });

  it('keeps everything after a 400, says why, and sends it again on the next save', async () => {
    const rig = await createRig({ fetchStatus: 400 });
    rig.fetchFn.mockImplementation(async () =>
      response(400, { ok: false, message: 'timing.windowMs: nope' }),
    );
    rig.binding('timing', 'windowMs').emit(250);
    rig.saveButton().click();
    await vi.waitFor(() => expect(rig.status()).toBe('not saved: timing.windowMs: nope'));
    expect(rig.saveButton().disabled).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      'debug',
      expect.stringContaining('refused the save'),
      expect.objectContaining({ status: 400 }),
    );
    rig.saveButton().click();
    await vi.waitFor(() => expect(rig.fetchFn).toHaveBeenCalledTimes(2));
    expect(lastFetchBody(rig.fetchFn, 0)).toEqual(lastFetchBody(rig.fetchFn, 1));
  });

  it('keeps everything when the dev server does not answer', async () => {
    const rig = await createRig();
    rig.fetchFn.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    rig.binding('timing', 'windowMs').emit(250);
    rig.saveButton().click();
    await vi.waitFor(() => expect(rig.status()).toContain('did not answer'));
    expect(rig.saveButton().disabled).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      'debug',
      expect.stringContaining('cannot reach'),
      expect.any(TypeError),
    );
  });

  it('is disabled while the request is in flight, sends no second request, and keeps an edit made meanwhile', async () => {
    const rig = await createRig();
    let answer: (value: Response) => void = () => {};
    rig.fetchFn.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    rig.binding('timing', 'windowMs').emit(250);
    const button = rig.saveButton();
    button.click();
    expect(button.disabled).toBe(true);
    button.click();
    expect(rig.fetchFn).toHaveBeenCalledTimes(1);
    // Edited while saving: another leaf, and the same leaf again with a new value.
    rig.binding('movement', 'walkSpeedMps').emit(2);
    rig.binding('timing', 'windowMs').emit(270);
    expect(button.disabled).toBe(true);
    answer(response(200, { ok: true, message: 'saved' }));
    await vi.waitFor(() => expect(rig.status()).toBe('saved'));
    // Only what was sent is dropped: the newer edits wait for the next save.
    expect(button.disabled).toBe(false);
    button.click();
    await vi.waitFor(() => expect(rig.fetchFn).toHaveBeenCalledTimes(2));
    expect(lastFetchBody(rig.fetchFn)).toEqual({
      file: 'content/feel.json',
      patch: { timing: { windowMs: 270 }, movement: { walkSpeedMps: 2 } },
    });
  });

  it('saves the array from the saved feel, not from the level’s override of it', async () => {
    const rig = await createRig();
    const onDisk = createTestContent().feel.mama.starThresholdPoints;
    // The running level overrides the thresholds: the sim's feel has other values.
    const overridden = createTestContent().feel;
    overridden.mama.starThresholdPoints = onDisk.map((points) => points + 1);
    const next = await newSim(
      overridden,
      levelOf({ mama: { starThresholdPoints: overridden.mama.starThresholdPoints } }),
    );
    rig.session.active = null;
    rig.host.fireLevelStarted(
      startedOf(
        next,
        overridden,
        levelOf({ mama: { starThresholdPoints: overridden.mama.starThresholdPoints } }),
      ),
    );
    rig.session.active = activeOf(next, overridden);
    rig.binding('mama', 'starThresholdPoints', '1').emit(50);
    // The sim gets the effective array with the item changed...
    expect(setFeelPatches(next)).toEqual([
      {
        mama: {
          starThresholdPoints: overridden.mama.starThresholdPoints.map((p, i) =>
            i === 1 ? 50 : p,
          ),
        },
      },
    ]);
    // ...the file gets the saved array with the item changed.
    rig.saveButton().click();
    await vi.waitFor(() => expect(rig.fetchFn).toHaveBeenCalledTimes(1));
    expect(lastFetchBody(rig.fetchFn)).toEqual({
      file: 'content/feel.json',
      patch: { mama: { starThresholdPoints: onDisk.map((p, i) => (i === 1 ? 50 : p)) } },
    });
    next.dispose();
  });

  it('keeps what is not saved across a rebuild', async () => {
    const rig = await createRig();
    rig.binding('timing', 'windowMs').emit(250);
    rig.panel.rebuild();
    expect(rig.saveButton().disabled).toBe(false);
  });
});

describe('the Tweakpane stylesheet under the CSP', () => {
  const stubCssom = (): void => {
    vi.stubGlobal('HTMLStyleElement', FakeStyleElement);
    vi.stubGlobal('CSSStyleSheet', FakeCssStyleSheet);
  };

  const styleChildren = (doc: FakeDocument): FakeNode[] =>
    doc.head.children.filter((child) => child instanceof FakeStyleElement);

  it('never appends a <style> to the page, for any pane, and adopts one sheet', async () => {
    stubCssom();
    const rig = await createRig();
    const feel = createTestContent().feel;
    const next = await newSim(feel);
    rig.host.fireLevelStarted(startedOf(next, feel));
    rig.panel.rebuild();
    rig.host.fireLevelStarted(startedOf(next, feel));
    expect(FakePane.instances).toHaveLength(4);
    expect(styleChildren(rig.doc)).toEqual([]);
    expect(rig.doc.adoptedStyleSheets).toHaveLength(1);
    expect(rig.doc.adoptedStyleSheets[0]?.css).toContain('.tp-fake');
    // The head's own appendChild is back.
    expect(Object.hasOwn(rig.doc.head, 'appendChild')).toBe(false);
    next.dispose();
  });

  it('takes the sheet out of the document on dispose', async () => {
    stubCssom();
    const rig = await createRig();
    expect(rig.doc.adoptedStyleSheets).toHaveLength(1);
    rig.panel.dispose();
    expect(rig.doc.adoptedStyleSheets).toHaveLength(0);
  });

  it('adopts a sheet in each document: nothing is remembered at module level', async () => {
    stubCssom();
    const first = await createRig();
    const second = await createRig();
    expect(first.doc.adoptedStyleSheets).toHaveLength(1);
    expect(second.doc.adoptedStyleSheets).toHaveLength(1);
    expect(styleChildren(second.doc)).toEqual([]);
    first.panel.dispose();
    expect(second.doc.adoptedStyleSheets).toHaveLength(1);
  });

  it('leaves the library alone where adoptedStyleSheets is missing', async () => {
    const rig = await createRig();
    // No CSSStyleSheet global in Node: the pane appends its own <style>.
    expect(styleChildren(rig.doc)).toHaveLength(1);
    expect(rig.doc.adoptedStyleSheets).toHaveLength(0);
  });
});

describe('dispose', () => {
  it('stops listening to level starts and removes the pane and the status', async () => {
    const rig = await createRig();
    rig.panel.dispose();
    const feel = createTestContent().feel;
    const next = await newSim(feel);
    rig.host.fireLevelStarted(startedOf(next, feel));
    expect(FakePane.instances).toHaveLength(1);
    expect(FakePane.instances[0]?.isDisposed).toBe(true);
    expect(rig.container.children).toEqual([]);
    next.dispose();
  });
});
