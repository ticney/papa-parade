import { createEmitter } from '@shared/emitter';
import { describe, expect, it } from 'vitest';
import type { ClientEvents } from './clientEvents.ts';
import { createPauseController } from './pauseController.ts';
import { bindVisibilityPause, type VisibilitySource } from './visibilityPause.ts';

function setup(initial: string = 'visible') {
  const listeners = new Set<() => void>();
  const source: VisibilitySource & { visibilityState: string } = {
    visibilityState: initial,
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
  };
  const events = createEmitter<ClientEvents>();
  const seen: string[] = [];
  events.on('PauseRequested', (payload) => seen.push(`PauseRequested:${payload.reason}`));
  events.on('ResumeRequested', () => seen.push('ResumeRequested'));
  events.on('GameResumed', () => seen.push('GameResumed'));
  const pause = createPauseController({ events });
  const change = (visibilityState: string): void => {
    source.visibilityState = visibilityState;
    for (const listener of [...listeners]) listener();
  };
  return { source, pause, seen, listeners, change };
}

describe('bindVisibilityPause', () => {
  it('pauses with the visibilityHidden reason when the page goes to the background', () => {
    const { source, pause, seen, change } = setup();
    bindVisibilityPause(source, pause);
    change('hidden');
    expect(pause.state).toBe('paused');
    expect(seen).toEqual(['PauseRequested:visibilityHidden']);
  });

  it('does nothing when the page comes back: resuming is the player’s call', () => {
    const { source, pause, seen, change } = setup();
    bindVisibilityPause(source, pause);
    change('hidden');
    change('visible');
    expect(pause.state).toBe('paused');
    expect(seen).toEqual(['PauseRequested:visibilityHidden']);
  });

  it('does nothing for a visibility change that leaves the page visible', () => {
    const { source, pause, seen, change } = setup();
    bindVisibilityPause(source, pause);
    change('visible');
    expect(pause.state).toBe('running');
    expect(seen).toEqual([]);
  });

  it('starts paused when the page is already hidden at bind time (a tab opened in the background)', () => {
    const { source, pause, seen } = setup('hidden');
    bindVisibilityPause(source, pause);
    expect(pause.state).toBe('paused');
    expect(seen).toEqual(['PauseRequested:visibilityHidden']);
  });

  it('stays running at bind time when the page is visible', () => {
    const { source, pause } = setup('visible');
    bindVisibilityPause(source, pause);
    expect(pause.state).toBe('running');
  });

  it('removes its listener when unbound', () => {
    const { source, pause, listeners, change } = setup();
    const unbind = bindVisibilityPause(source, pause);
    expect(listeners.size).toBe(1);
    unbind();
    expect(listeners.size).toBe(0);
    change('hidden');
    expect(pause.state).toBe('running');
  });
});
