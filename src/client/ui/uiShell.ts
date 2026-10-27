import type { Emitter } from '@shared/emitter';
import type { AppFsm } from '../app/appFsm.ts';
import type { ClientEvents } from '../app/clientEvents.ts';
import { chooseOverlay } from '../app/overlay.ts';
import type { PauseController } from '../app/pauseController.ts';
import type { HudBatch } from './hud/hudBatch.ts';
import type { HudLayer } from './hud/hudLayer.ts';
import { escapeAction } from './keys.ts';
import type { OverlayHost } from './overlayHost.ts';

/** The slice of `window` the shell's key handling listens on. */
export interface KeyTarget {
  addEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void): void;
  removeEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void): void;
}

export interface UiShellOptions {
  events: Emitter<ClientEvents>;
  appFsm: AppFsm;
  pause: PauseController;
  hud: HudLayer;
  hudBatch: HudBatch;
  overlayHost: OverlayHost;
}

export interface UiShell {
  readonly isPortrait: boolean;
  setPortrait(isPortrait: boolean): void;
  /** Re-derives what is shown from the app and pause states. Cheap when nothing changed. */
  refresh(): void;
  /** Once per frame, from the loop's render: the countdown digit, then the batched HUD writes. */
  frame(): void;
  /** Escape and the arrow keys. Returns the function that unbinds. */
  bindKeys(target: KeyTarget): () => void;
}

/**
 * Ties the app state, the pause state and the portrait flag to what the player sees: which overlay,
 * which pause face, whether the HUD shows and takes input. It reacts to events; nothing here polls
 * except `frame`, which only follows the countdown.
 */
export function createUiShell(options: UiShellOptions): UiShell {
  const { events, appFsm, pause, hud, hudBatch, overlayHost } = options;
  let isPortrait = false;

  const refresh = (): void => {
    const kind = chooseOverlay({
      appState: appFsm.state,
      isPortrait,
      pauseState: pause.state,
    });
    const pauseMode = pause.state === 'paused' ? 'panel' : 'countdown';
    overlayHost.sync(kind, pauseMode);
    overlayHost.pauseScreen?.setMode(pauseMode);
    const isInLevel = appFsm.state === 'level';
    hud.setVisible(isInLevel);
    hud.setInteractive(isInLevel && !isPortrait && pause.state === 'running');
  };

  events.on('AppStateChanged', refresh);
  events.on('PauseRequested', refresh);
  events.on('ResumeRequested', refresh);
  events.on('GameResumed', refresh);

  return {
    get isPortrait() {
      return isPortrait;
    },
    setPortrait(next) {
      if (next === isPortrait) return;
      isPortrait = next;
      refresh();
    },
    refresh,
    frame() {
      if (pause.state === 'resuming') {
        overlayHost.pauseScreen?.updateCountdown(pause.countdownRemainingMs);
      }
      hudBatch.flush();
    },
    bindKeys(target) {
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.code === 'Escape') {
          const action = escapeAction({
            appState: appFsm.state,
            pauseState: pause.state,
            isPortrait,
            repeat: event.repeat,
          });
          if (action === null) return;
          event.preventDefault();
          if (action === 'pause') pause.requestPause('user');
          else pause.requestResume();
          return;
        }
        if (isPortrait || overlayHost.pauseScreen === null) return;
        if (overlayHost.pauseScreen.moveFocus(event.code)) event.preventDefault();
      };
      target.addEventListener('keydown', onKeyDown);
      return () => target.removeEventListener('keydown', onKeyDown);
    },
  };
}
