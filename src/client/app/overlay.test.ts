import { describe, expect, it } from 'vitest';
import type { AppState } from './appFsm.ts';
import { chooseOverlay, type OverlayKind } from './overlay.ts';
import type { PauseState } from './pauseController.ts';

const APP_STATES: AppState[] = ['boot', 'start', 'loading', 'level', 'result', 'oops'];
const PAUSE_STATES: PauseState[] = ['running', 'paused', 'resuming'];

/** The rule, written out as a table for the landscape case. */
function expectedLandscape(appState: AppState, pauseState: PauseState): OverlayKind | null {
  if (appState === 'oops') return 'oops';
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

  it('never picks pause outside a level (a restart leaves the pause state behind)', () => {
    expect(
      chooseOverlay({ appState: 'loading', isPortrait: false, pauseState: 'paused' }),
    ).toBeNull();
  });
});
