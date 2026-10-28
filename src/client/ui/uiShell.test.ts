import { createEmitter } from '@shared/emitter';
import { asRealMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import { createAppFsm } from '../app/appFsm.ts';
import type { ClientEvents } from '../app/clientEvents.ts';
import type { OverlayKind } from '../app/overlay.ts';
import { createPauseController } from '../app/pauseController.ts';
import type { PadButton } from '../input/gamepadInput.ts';
import type { OverlayHost } from './overlayHost.ts';
import { createUiShell } from './uiShell.ts';

// What the shell tells the screens, recorded. The host derives its `kind` the way the real one is
// synced: by the shell, through `sync`.
function setup() {
  const events = createEmitter<ClientEvents>();
  const appFsm = createAppFsm({ events });
  const pause = createPauseController({ events, countdownMs: 3000 });
  const calls: string[] = [];
  let kind: OverlayKind | null = null;
  const pauseScreen = {
    setMode: (mode: string) => calls.push(`setMode:${mode}`),
    setPadDisconnected: (is: boolean) => calls.push(`padDisconnected:${is}`),
    updateCountdown: () => undefined,
    moveFocus: (code: string) => calls.push(`moveFocus:${code}`),
    activateFocused: () => calls.push('activateFocused'),
    back: () => calls.push('back'),
  };
  const screen = { activate: () => calls.push('screen.activate') };
  const overlayHost = {
    get kind() {
      return kind;
    },
    get screen() {
      return kind === 'pause' ? pauseScreen : screen;
    },
    get pauseScreen() {
      return kind === 'pause' ? pauseScreen : null;
    },
    sync: (next: typeof kind) => {
      kind = next;
    },
  } as unknown as OverlayHost;
  const shell = createUiShell({
    events,
    appFsm,
    pause,
    hud: { setVisible: () => undefined, setInteractive: () => undefined },
    hudBatch: { flush: () => undefined } as never,
    overlayHost,
  });
  const toLevel = (): void => {
    appFsm.enter('start');
    appFsm.enter('loading');
    appFsm.enter('level');
    shell.refresh();
  };
  const press = (button: PadButton): void => {
    calls.length = 0;
    shell.handlePadButton(button);
  };
  return { appFsm, pause, shell, calls, press, toLevel, getKind: () => kind };
}

describe('createUiShell: handlePadButton (story 1.17)', () => {
  it('pauses on Start in play, and B and the D-pad do nothing there', () => {
    const { shell, pause, calls, press, toLevel } = setup();
    toLevel();
    for (const button of ['back', 'up', 'left', 'confirm'] as const) {
      press(button);
      expect(pause.state).toBe('running');
      expect(calls).toEqual([]);
    }
    shell.handlePadButton('start');
    expect(pause.state).toBe('paused');
  });

  it('drives the pause panel: the D-pad moves the focus, A presses, B goes back', () => {
    const { pause, calls, press, toLevel, getKind } = setup();
    toLevel();
    pause.requestPause('user');
    expect(getKind()).toBe('pause');
    press('down');
    expect(calls).toEqual(['moveFocus:ArrowDown']);
    press('left');
    expect(calls).toEqual(['moveFocus:ArrowLeft']);
    press('confirm');
    expect(calls).toEqual(['activateFocused']);
    press('back');
    expect(calls).toEqual(['back']);
  });

  it('resumes on Start from the panel, through the countdown', () => {
    const { pause, shell, toLevel } = setup();
    toLevel();
    pause.requestPause('user');
    shell.handlePadButton('start');
    expect(pause.state).toBe('resuming');
  });

  it('starts the game with A or Start on the start screen, and retries with A on « Oups »', () => {
    const { appFsm, shell, calls, press } = setup();
    appFsm.enter('start');
    shell.refresh();
    press('confirm');
    expect(calls).toEqual(['screen.activate']);
    press('start');
    expect(calls).toEqual(['screen.activate']);
    press('back');
    expect(calls).toEqual([]);
    appFsm.enter('loading');
    appFsm.enter('oops');
    shell.refresh();
    press('confirm');
    expect(calls).toEqual(['screen.activate']);
    press('start');
    expect(calls).toEqual([]);
  });

  it('ignores every button in portrait, Start included', () => {
    const { pause, shell, calls, press, toLevel, getKind } = setup();
    toLevel();
    shell.setPortrait(true);
    expect(getKind()).toBe('portrait');
    for (const button of ['start', 'confirm', 'back', 'down'] as const) {
      press(button);
      expect(calls).toEqual([]);
    }
    expect(pause.state).toBe('running');
  });

  it('ignores the buttons while the level loads', () => {
    const { appFsm, calls, press } = setup();
    appFsm.enter('start');
    appFsm.enter('loading');
    press('confirm');
    press('start');
    expect(calls).toEqual([]);
  });

  it('lets Start cancel a countdown like Escape, and nothing else touch it', () => {
    const { pause, shell, calls, press, toLevel } = setup();
    toLevel();
    pause.requestPause('user');
    pause.requestResume();
    pause.update(asRealMs(100));
    expect(pause.state).toBe('resuming');
    press('confirm');
    press('back');
    expect(calls).toEqual([]);
    expect(pause.state).toBe('resuming');
    shell.handlePadButton('start');
    expect(pause.state).toBe('paused');
  });
});

describe('createUiShell: setPadDisconnected (story 1.17)', () => {
  it('tells the pause screen once per change, and again to a screen built later', () => {
    const { shell, calls, pause, toLevel } = setup();
    toLevel();
    pause.requestPause('gamepadDisconnected');
    calls.length = 0;
    shell.setPadDisconnected(true);
    shell.setPadDisconnected(true);
    expect(calls).toEqual(['padDisconnected:true']);
    // A refresh (a new face of the panel) says it again, so the line is not lost on a rebuilt screen.
    shell.refresh();
    expect(calls).toContain('padDisconnected:true');
    calls.length = 0;
    shell.setPadDisconnected(false);
    expect(calls).toEqual(['padDisconnected:false']);
  });

  it('is harmless when no pause screen shows', () => {
    const { shell, calls } = setup();
    shell.setPadDisconnected(true);
    expect(calls).toEqual([]);
  });
});
