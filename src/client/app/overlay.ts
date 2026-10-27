import type { AppState } from './appFsm.ts';
import type { PauseState } from './pauseController.ts';

/** The one overlay shown over the game, if any. Overlays never stack. */
export type OverlayKind = 'portrait' | 'oops' | 'pause' | 'loading' | 'start';

export interface OverlayInput {
  appState: AppState;
  isPortrait: boolean;
  pauseState: PauseState;
}

/**
 * What to show, from the state of the app. Precedence: portrait > oops > pause > loading > start. Portrait is
 * a condition of the device, not a pause reason: it covers whatever else is due, and that comes
 * back when the phone is turned. `pause` stands for both the panel (`paused`) and the countdown
 * (`resuming`); the overlay host tells them apart from `pauseState`.
 */
export function chooseOverlay(input: OverlayInput): OverlayKind | null {
  if (input.isPortrait) return 'portrait';
  if (input.appState === 'oops') return 'oops';
  if (input.appState === 'level' && input.pauseState !== 'running') return 'pause';
  if (input.appState === 'loading') return 'loading';
  if (input.appState === 'start') return 'start';
  return null;
}
