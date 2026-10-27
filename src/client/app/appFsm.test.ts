import { createEmitter } from '@shared/emitter';
import { describe, expect, it } from 'vitest';
import { APP_TRANSITIONS, type AppState, createAppFsm } from './appFsm.ts';
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

  it('reaches oops from loading and from level only', () => {
    const fromLoading = setup();
    goTo(fromLoading.fsm, ['start', 'loading', 'oops']);
    expect(fromLoading.fsm.state).toBe('oops');
    const fromLevel = setup();
    goTo(fromLevel.fsm, ['start', 'loading', 'level', 'oops']);
    expect(fromLevel.fsm.state).toBe('oops');
    for (const state of STATES) {
      const expected = state === 'loading' || state === 'level';
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

  it('leaves oops for good until a later story adds oops → loading', () => {
    const { fsm } = setup();
    goTo(fsm, ['start', 'loading', 'oops']);
    expect(() => fsm.enter('loading')).toThrow(/cannot go/);
  });

  it('keeps every existing transition legal when later stories add states', () => {
    // What story 2.7 will do: calibration between start and loading, start → loading kept.
    const extended: Record<string, readonly string[]> = {
      ...APP_TRANSITIONS,
      start: [...APP_TRANSITIONS.start, 'calibration'],
      calibration: ['loading'],
    };
    for (const [from, targets] of Object.entries(APP_TRANSITIONS)) {
      for (const to of targets) expect(extended[from]).toContain(to);
    }
    const { fsm } = setup(extended);
    fsm.enter('start');
    (fsm.enter as (next: string) => void)('calibration');
    fsm.enter('loading');
    expect(fsm.state).toBe('loading');
    const returning = setup(extended);
    goTo(returning.fsm, ['start', 'loading']);
    expect(returning.fsm.state).toBe('loading');
  });
});
