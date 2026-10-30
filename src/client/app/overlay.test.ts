import { describe, expect, it } from 'vitest';
import type { AppState } from './appFsm.ts';
import { chooseOverlay, type OverlayKind } from './overlay.ts';
import type { PauseState } from './pauseController.ts';

const APP_STATES: AppState[] = [
  'boot',
  'start',
  'calibration',
  'settings',
  'credits',
  'loading',
  'level',
  'result',
  'oops',
];
const PAUSE_STATES: PauseState[] = ['running', 'paused', 'resuming'];

/** The rule, written out as a table for the landscape case. */
function expectedLandscape(appState: AppState, pauseState: PauseState): OverlayKind | null {
  if (appState === 'calibration') return 'calibration';
  if (appState === 'settings') return 'settings';
  if (appState === 'credits') return 'credits';
  if (appState === 'oops') return 'oops';
  if (appState === 'result') return 'result';
  if (appState === 'loading') return 'loading';
  if (appState === 'start') return 'start';
  if (appState === 'level') return pauseState === 'running' ? null : 'pause';
  return null;
}

describe('chooseOverlay', () => {
  for (const appState of APP_STATES) {
    for (const pauseState of PAUSE_STATES) {
      it(`landscape, ${appState}, ${pauseState}`, () => {
        expect(chooseOverlay({ appState, isPortrait: false, pauseState })).toBe(
          expectedLandscape(appState, pauseState),
        );
      });

      it(`portrait covers everything: ${appState}, ${pauseState}`, () => {
        expect(chooseOverlay({ appState, isPortrait: true, pauseState })).toBe('portrait');
      });
    }
  }

  it('shows the pause panel again when the phone goes back to landscape', () => {
    const paused = { appState: 'level', pauseState: 'paused' } as const;
    expect(chooseOverlay({ ...paused, isPortrait: true })).toBe('portrait');
    expect(chooseOverlay({ ...paused, isPortrait: false })).toBe('pause');
  });

  it('never picks pause outside a level: a restart leaves the pause state behind, the loading screen shows', () => {
    expect(chooseOverlay({ appState: 'loading', isPortrait: false, pauseState: 'paused' })).toBe(
      'loading',
    );
  });

  it('shows the Result screen whatever the pause state: a hidden page leaves no pause veil on it (story 1.22)', () => {
    for (const pauseState of PAUSE_STATES) {
      expect(chooseOverlay({ appState: 'result', isPortrait: false, pauseState })).toBe('result');
    }
  });

  it('puts oops before pause and pause before loading and start', () => {
    expect(chooseOverlay({ appState: 'oops', isPortrait: false, pauseState: 'paused' })).toBe(
      'oops',
    );
    expect(chooseOverlay({ appState: 'level', isPortrait: false, pauseState: 'paused' })).toBe(
      'pause',
    );
  });

  it('shows the calibration whatever the pause state: a hidden page leaves no veil on it (story 2.7)', () => {
    for (const pauseState of PAUSE_STATES) {
      expect(chooseOverlay({ appState: 'calibration', isPortrait: false, pauseState })).toBe(
        'calibration',
      );
    }
  });

  it('puts the portrait overlay over the calibration, which comes back when the phone is turned', () => {
    const calibrating = { appState: 'calibration', pauseState: 'running' } as const;
    expect(chooseOverlay({ ...calibrating, isPortrait: true })).toBe('portrait');
    expect(chooseOverlay({ ...calibrating, isPortrait: false })).toBe('calibration');
  });

  it('shows the settings and the credits whatever the pause state: the paused level stays below (story 2.8)', () => {
    for (const pauseState of PAUSE_STATES) {
      expect(chooseOverlay({ appState: 'settings', isPortrait: false, pauseState })).toBe(
        'settings',
      );
      expect(chooseOverlay({ appState: 'credits', isPortrait: false, pauseState })).toBe('credits');
    }
  });

  it('puts the portrait overlay over the settings, which come back when the phone is turned', () => {
    const settings = { appState: 'settings', pauseState: 'paused' } as const;
    expect(chooseOverlay({ ...settings, isPortrait: true })).toBe('portrait');
    expect(chooseOverlay({ ...settings, isPortrait: false })).toBe('settings');
  });
});
