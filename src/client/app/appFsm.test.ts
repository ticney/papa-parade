import { createEmitter } from '@shared/emitter';
import { describe, expect, it } from 'vitest';
import { APP_TRANSITIONS, type AppState, createAppFsm, isSettingsDetour } from './appFsm.ts';
import type { ClientEvents } from './clientEvents.ts';

const STATES = Object.keys(APP_TRANSITIONS) as AppState[];

function setup(transitions?: Record<string, readonly string[]>) {
  const events = createEmitter<ClientEvents>();
  const seen: Array<{ from: AppState; to: AppState }> = [];
  events.on('AppStateChanged', (payload) => seen.push(payload));
  return { fsm: createAppFsm({ events, transitions }), seen };
}

/** Walks the fsm to `target` along the main path. */
function goTo(fsm: ReturnType<typeof createAppFsm>, path: AppState[]): void {
  for (const state of path) fsm.enter(state);
}

describe('createAppFsm', () => {
  it('starts in boot', () => {
    expect(setup().fsm.state).toBe('boot');
  });

  it('follows boot → start → loading → level → result', () => {
    const { fsm, seen } = setup();
    goTo(fsm, ['start', 'loading', 'level', 'result']);
    expect(fsm.state).toBe('result');
    expect(seen.map((event) => `${event.from}>${event.to}`)).toEqual([
      'boot>start',
      'start>loading',
      'loading>level',
      'level>result',
    ]);
  });

  it('lets a level restart through loading, and a result replay through loading', () => {
    const { fsm } = setup();
    goTo(fsm, ['start', 'loading', 'level', 'loading', 'level', 'result', 'loading']);
    expect(fsm.state).toBe('loading');
  });

  it('reaches oops from loading, level, the calibration, the settings and the credits only', () => {
    const fromLoading = setup();
    goTo(fromLoading.fsm, ['start', 'loading', 'oops']);
    expect(fromLoading.fsm.state).toBe('oops');
    const fromLevel = setup();
    goTo(fromLevel.fsm, ['start', 'loading', 'level', 'oops']);
    expect(fromLevel.fsm.state).toBe('oops');
    for (const state of STATES) {
      const expected =
        state === 'loading' ||
        state === 'level' ||
        state === 'calibration' ||
        state === 'settings' ||
        state === 'credits';
      expect(APP_TRANSITIONS[state].includes('oops'), state).toBe(expected);
    }
  });

  it('refuses every transition the table does not list, without changing state or emitting', () => {
    for (const from of STATES) {
      for (const to of STATES) {
        if (from === to || APP_TRANSITIONS[from].includes(to)) continue;
        const events = createEmitter<ClientEvents>();
        const seen: string[] = [];
        events.on('AppStateChanged', () => seen.push('event'));
        // Start in `from` by a table that allows the one hop from boot.
        const fsm = createAppFsm({ events, transitions: { ...APP_TRANSITIONS, boot: [from] } });
        if (from !== 'boot') fsm.enter(from);
        seen.length = 0;
        expect(() => fsm.enter(to), `${from} → ${to}`).toThrow(/cannot go/);
        expect(fsm.state).toBe(from);
        expect(seen).toEqual([]);
      }
    }
  });

  it('does nothing when entering the current state', () => {
    const { fsm, seen } = setup();
    fsm.enter('boot');
    expect(seen).toEqual([]);
    fsm.enter('start');
    fsm.enter('start');
    expect(seen).toHaveLength(1);
  });

  it('leaves oops through loading only (« Réessayer »)', () => {
    const { fsm } = setup();
    goTo(fsm, ['start', 'loading', 'oops']);
    expect(() => fsm.enter('level')).toThrow(/cannot go/);
    fsm.enter('loading');
    expect(fsm.state).toBe('loading');
  });

  it('has exactly the edges of the app flow: removing one fails here', () => {
    const edges = Object.entries(APP_TRANSITIONS).flatMap(([from, targets]) =>
      targets.map((to) => `${from}>${to}`),
    );
    expect(edges.sort()).toEqual(
      [
        'boot>start',
        'start>loading',
        'start>calibration',
        'calibration>loading',
        'calibration>oops',
        'calibration>settings',
        'settings>level',
        'settings>calibration',
        'settings>credits',
        'settings>oops',
        'credits>settings',
        'credits>oops',
        'loading>level',
        'loading>oops',
        'level>loading',
        'level>result',
        'level>oops',
        'level>settings',
        'result>loading',
        'oops>loading',
      ].sort(),
    );
  });

  it('goes through the calibration on a first launch, and straight to loading on a return', () => {
    const first = setup();
    goTo(first.fsm, ['start', 'calibration', 'loading', 'level']);
    expect(first.fsm.state).toBe('level');
    const returning = setup();
    goTo(returning.fsm, ['start', 'loading']);
    expect(returning.fsm.state).toBe('loading');
  });

  it('leaves the calibration for loading or oops only', () => {
    for (const next of ['level', 'result', 'start'] as const) {
      const { fsm } = setup();
      goTo(fsm, ['start', 'calibration']);
      expect(() => fsm.enter(next), next).toThrow(/cannot go/);
    }
    const { fsm } = setup();
    goTo(fsm, ['start', 'calibration', 'oops']);
    expect(fsm.state).toBe('oops');
  });

  it('detours a level through the settings and back, then through the credits and back (story 2.8)', () => {
    const { fsm, seen } = setup();
    goTo(fsm, ['start', 'loading', 'level', 'settings', 'credits', 'settings', 'level']);
    expect(fsm.state).toBe('level');
    expect(seen.slice(3).map((event) => `${event.from}>${event.to}`)).toEqual([
      'level>settings',
      'settings>credits',
      'credits>settings',
      'settings>level',
    ]);
  });

  it('serves a recalibration from the settings, and keeps the first-launch path', () => {
    const { fsm } = setup();
    goTo(fsm, ['start', 'loading', 'level', 'settings', 'calibration', 'settings']);
    expect(fsm.state).toBe('settings');
    const first = setup();
    goTo(first.fsm, ['start', 'calibration', 'loading']);
    expect(first.fsm.state).toBe('loading');
  });

  it('leaves the credits for the settings only, and the settings never for the result or the start', () => {
    const { fsm } = setup();
    goTo(fsm, ['start', 'loading', 'level', 'settings', 'credits']);
    expect(() => fsm.enter('level')).toThrow(/cannot go/);
    fsm.enter('settings');
    expect(() => fsm.enter('result')).toThrow(/cannot go/);
    expect(() => fsm.enter('start')).toThrow(/cannot go/);
  });
});

describe('isSettingsDetour (story 2.8)', () => {
  it('is true for level → settings and settings → level, and for nothing else', () => {
    for (const from of STATES) {
      for (const to of STATES) {
        const expected =
          (from === 'level' && to === 'settings') || (from === 'settings' && to === 'level');
        expect(isSettingsDetour(from, to), `${from} → ${to}`).toBe(expected);
      }
    }
  });
});
