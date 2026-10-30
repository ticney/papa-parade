import type { Emitter } from '@shared/emitter';
import type { AppFsm } from '../app/appFsm.ts';
import type { ClientEvents } from '../app/clientEvents.ts';
import { chooseOverlay } from '../app/overlay.ts';
import type { PauseController } from '../app/pauseController.ts';
import type { PadButton } from '../input/gamepadInput.ts';
import type { HudBatch } from './hud/hudBatch.ts';
import type { HudLayer } from './hud/hudLayer.ts';
import { escapeAction, padAction } from './keys.ts';
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
  /**
   * A pad that was connected went away during a level, or came back (story 1.17, D13): while it is
   * set the pause panel shows the line, whatever paused the game. It never blocks a resume.
   */
  setPadDisconnected(isDisconnected: boolean): void;
  /**
   * A gamepad button for the UI (the sim's A is the input mapper's): Start does what Escape does,
   * the D-pad and A drive the pause panel, B goes back, A starts the game or retries. `atReal` is the
   * edge's own stamp (the calibration's taps, story 2.7). The settings and the credits take the
   * D-pad, A and B too (story 2.8). Nothing in
   * portrait (the portrait overlay covers everything), and B never pauses in play.
   */
  handlePadButton(button: PadButton, atReal: number): void;
  /** Escape (pause, resume, or back out of the settings) and the arrow keys. Returns the function that unbinds. */
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
  let isPadDisconnected = false;

  const refresh = (): void => {
    const kind = chooseOverlay({
      appState: appFsm.state,
      isPortrait,
      pauseState: pause.state,
    });
    const pauseMode = pause.state === 'paused' ? 'panel' : 'countdown';
    overlayHost.sync(kind, pauseMode);
    overlayHost.pauseScreen?.setMode(pauseMode);
    overlayHost.pauseScreen?.setPadDisconnected(isPadDisconnected);
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
    setPadDisconnected(next) {
      if (next === isPadDisconnected) return;
      isPadDisconnected = next;
      overlayHost.pauseScreen?.setPadDisconnected(next);
    },
    handlePadButton(button, atReal) {
      const action = padAction({
        appState: appFsm.state,
        pauseState: pause.state,
        overlay: overlayHost.kind,
        button,
      });
      switch (action) {
        case null:
          return;
        case 'pause':
          pause.requestPause('user');
          return;
        case 'resume':
          pause.requestResume();
          return;
        case 'activate':
          if (overlayHost.kind === 'pause') overlayHost.pauseScreen?.activateFocused();
          else overlayHost.screen?.activate?.(atReal);
          return;
        case 'skip':
          overlayHost.screen?.skip?.();
          return;
        case 'back':
          overlayHost.screen?.back?.();
          return;
        default:
          overlayHost.screen?.moveFocus?.(action);
      }
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
          else if (action === 'resume') pause.requestResume();
          else overlayHost.screen?.back?.();
          return;
        }
        if (isPortrait) return;
        if (overlayHost.screen?.moveFocus?.(event.code)) event.preventDefault();
      };
      target.addEventListener('keydown', onKeyDown);
      return () => target.removeEventListener('keydown', onKeyDown);
    },
  };
}
