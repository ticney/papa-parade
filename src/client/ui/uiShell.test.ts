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

/** The pad edge's own stamp, as the mapper passes it on. */
const PAD_EDGE_AT_REAL = 1234.5;

// What the shell tells the screens, recorded. The host derives its `kind` the way the real one is
// synced: by the shell, through `sync`.
function setup() {
  const events = createEmitter<ClientEvents>();
  const appFsm = createAppFsm({ events });
  const pause = createPauseController({ events, countdownMs: 3000 });
  const calls: string[] = [];
  let kind: OverlayKind | null = null;
  let isHudVisible = false;
  const pauseScreen = {
    setMode: (mode: string) => calls.push(`setMode:${mode}`),
    setPadDisconnected: (is: boolean) => calls.push(`padDisconnected:${is}`),
    updateCountdown: () => undefined,
    moveFocus: (code: string) => calls.push(`moveFocus:${code}`),
    activateFocused: () => calls.push('activateFocused'),
    back: () => calls.push('back'),
  };
  const screen = {
    activate: (atReal?: number) => calls.push(`screen.activate:${atReal}`),
    skip: () => calls.push('screen.skip'),
    moveFocus: (code: string) => {
      calls.push(`screen.moveFocus:${code}`);
      return code.startsWith('Arrow');
    },
    back: () => calls.push('screen.back'),
  };
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
    hud: {
      setVisible: (is: boolean) => {
        isHudVisible = is;
      },
      setInteractive: () => undefined,
    },
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
    shell.handlePadButton(button, PAD_EDGE_AT_REAL);
  };
  return {
    appFsm,
    pause,
    shell,
    calls,
    press,
    toLevel,
    getKind: () => kind,
    isHudVisible: () => isHudVisible,
  };
}

describe('createUiShell: the HUD, and so the level timer (story 1.18)', () => {
  it('shows the HUD in a level only, and hides it on the other screens', () => {
    const { appFsm, shell, isHudVisible } = setup();
    appFsm.enter('start');
    shell.refresh();
    expect(isHudVisible()).toBe(false);
    appFsm.enter('loading');
    shell.refresh();
    expect(isHudVisible()).toBe(false);
    appFsm.enter('level');
    shell.refresh();
    expect(isHudVisible()).toBe(true);
    appFsm.enter('result');
    shell.refresh();
    expect(isHudVisible()).toBe(false);
  });
});

describe('createUiShell: handlePadButton (story 1.17)', () => {
  it('pauses on Start in play, and B and the D-pad do nothing there', () => {
    const { shell, pause, calls, press, toLevel } = setup();
    toLevel();
    for (const button of ['back', 'up', 'left', 'confirm'] as const) {
      press(button);
      expect(pause.state).toBe('running');
      expect(calls).toEqual([]);
    }
    shell.handlePadButton('start', PAD_EDGE_AT_REAL);
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
    shell.handlePadButton('start', PAD_EDGE_AT_REAL);
    expect(pause.state).toBe('resuming');
  });

  it('starts the game with A or Start on the start screen, and retries with A on « Oups »', () => {
    const { appFsm, shell, calls, press } = setup();
    appFsm.enter('start');
    shell.refresh();
    press('confirm');
    expect(calls).toEqual(['screen.activate:1234.5']);
    press('start');
    expect(calls).toEqual(['screen.activate:1234.5']);
    press('back');
    expect(calls).toEqual([]);
    appFsm.enter('loading');
    appFsm.enter('oops');
    shell.refresh();
    press('confirm');
    expect(calls).toEqual(['screen.activate:1234.5']);
    press('start');
    expect(calls).toEqual([]);
  });

  it('on the calibration screen A is a tap with its own edge stamp, B skips, Start and the D-pad do nothing', () => {
    const { appFsm, shell, calls, press } = setup();
    appFsm.enter('start');
    appFsm.enter('calibration');
    shell.refresh();
    press('confirm');
    expect(calls).toEqual(['screen.activate:1234.5']);
    press('back');
    expect(calls).toEqual(['screen.skip']);
    for (const button of ['start', 'up', 'down', 'left', 'right'] as const) {
      press(button);
      expect(calls, button).toEqual([]);
    }
  });

  it('shows no HUD on the calibration screen', () => {
    const { appFsm, shell, isHudVisible } = setup();
    appFsm.enter('start');
    appFsm.enter('calibration');
    shell.refresh();
    expect(isHudVisible()).toBe(false);
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
    shell.handlePadButton('start', PAD_EDGE_AT_REAL);
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

describe('createUiShell: the settings and the credits (story 2.8)', () => {
  function settingsSetup() {
    const base = setup();
    base.toLevel();
    base.pause.requestPause('user');
    base.appFsm.enter('settings');
    base.shell.refresh();
    return base;
  }

  it('hides the HUD under the settings, and shows it again back in the level', () => {
    const { appFsm, shell, isHudVisible } = settingsSetup();
    expect(isHudVisible()).toBe(false);
    appFsm.enter('level');
    shell.refresh();
    expect(isHudVisible()).toBe(true);
  });

  it('gives the D-pad to the screen, A its own edge stamp, B back, and Start nothing', () => {
    const { calls, press, pause } = settingsSetup();
    press('down');
    expect(calls).toEqual(['screen.moveFocus:ArrowDown']);
    press('left');
    expect(calls).toEqual(['screen.moveFocus:ArrowLeft']);
    press('confirm');
    expect(calls).toEqual(['screen.activate:1234.5']);
    press('back');
    expect(calls).toEqual(['screen.back']);
    press('start');
    expect(calls).toEqual([]);
    expect(pause.state).toBe('paused');
  });

  it('does the same over the credits', () => {
    const { appFsm, shell, calls, press } = settingsSetup();
    appFsm.enter('credits');
    shell.refresh();
    press('back');
    expect(calls).toEqual(['screen.back']);
    press('confirm');
    expect(calls).toEqual(['screen.activate:1234.5']);
  });

  describe('the keys', () => {
    function keysSetup() {
      const base = settingsSetup();
      let listener: ((event: KeyboardEvent) => void) | null = null;
      base.shell.bindKeys({
        addEventListener: (_type, fn) => {
          listener = fn;
        },
        removeEventListener: () => undefined,
      });
      const key = (code: string, repeat = false): { prevented: boolean } => {
        const result = { prevented: false };
        base.calls.length = 0;
        (listener as unknown as (event: unknown) => void)({
          code,
          repeat,
          preventDefault: () => {
            result.prevented = true;
          },
        });
        return result;
      };
      return { ...base, key };
    }

    it('Escape goes back one level, and never resumes the paused level', () => {
      const { key, calls, pause } = keysSetup();
      expect(key('Escape').prevented).toBe(true);
      expect(calls).toEqual(['screen.back']);
      expect(pause.state).toBe('paused');
    });

    it('Escape does not repeat', () => {
      const { key, calls } = keysSetup();
      expect(key('Escape', true).prevented).toBe(false);
      expect(calls).toEqual([]);
    });

    it('hands the arrows to the screen and cancels their default, so a focused range moves once', () => {
      const { key, calls } = keysSetup();
      for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
        expect(key(code).prevented, code).toBe(true);
        expect(calls).toEqual([`screen.moveFocus:${code}`]);
      }
    });

    it('leaves the other keys alone', () => {
      const { key } = keysSetup();
      expect(key('KeyA').prevented).toBe(false);
    });

    it('takes nothing in portrait', () => {
      const { key, shell, calls } = keysSetup();
      shell.setPortrait(true);
      expect(key('ArrowDown').prevented).toBe(false);
      expect(key('Escape').prevented).toBe(false);
      expect(calls).toEqual([]);
    });
  });
});
