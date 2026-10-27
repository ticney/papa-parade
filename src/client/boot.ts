import { loadContent } from '@content/loadContent';
import { MAX_TIMER_DELAY_MS } from '@shared/constants';
import { createEmitter, type Emitter } from '@shared/emitter';
import { log } from '@shared/log';
import type { SimEvent } from '@sim';
import { Color, Scene } from 'three';
import { createAppFsm } from './app/appFsm.ts';
import type { ClientEvents } from './app/clientEvents.ts';
import { parseThrowDelayMs } from './app/forcedThrow.ts';
import { waitForForeground } from './app/foreground.ts';
import { installGlobalErrorHandlers } from './app/globalErrorHandlers.ts';
import { createLevelSession } from './app/levelSession.ts';
import { bindOrientation } from './app/orientation.ts';
import { createPauseController } from './app/pauseController.ts';
import { bindSurface } from './app/surface.ts';
import { bindVisibilityPause } from './app/visibilityPause.ts';
import { createBrowserContentSource } from './assets/browserContentSource.ts';
import { createGamepadInput } from './input/gamepadInput.ts';
import { createHitTester } from './input/hitTest.ts';
import { createInputMapper } from './input/inputMapper.ts';
import { bindKeyboard, createHeldKeys } from './input/keyboardInput.ts';
import { createMoveIntent } from './input/moveIntent.ts';
import { bindPointer } from './input/pointerInput.ts';
import { createIsoCamera, fitIsoCamera, type RoomSize } from './render/isoCamera.ts';
import type { LevelScene } from './render/levelScene.ts';
import { PALETTE } from './render/materials/palette.ts';
import { createRenderer } from './render/renderer.ts';
import { loadFonts } from './ui/fonts.ts';
import { createHudBatch } from './ui/hud/hudBatch.ts';
import { createHudLayer } from './ui/hud/hudLayer.ts';
import { createOverlayHost } from './ui/overlayHost.ts';
import { createLoadingScreen } from './ui/screens/loadingScreen.ts';
import { createOopsScreen } from './ui/screens/oopsScreen.ts';
import { createPauseScreen } from './ui/screens/pauseScreen.ts';
import { createPortraitOverlay } from './ui/screens/portraitOverlay.ts';
import { createStartScreen } from './ui/screens/startScreen.ts';
import { createTranslator } from './ui/strings.ts';
import { createUiShell } from './ui/uiShell.ts';
import { createWorldUi } from './ui/world/worldUi.ts';

function logSimEvent(event: SimEvent): void {
  if (event.type === 'InvariantViolated') {
    log.warn('sim', `invariant violated: ${event.name}`, event);
    return;
  }
  // Story 1.9 replaces this with the FeedbackDirector.
  if (log.enabled('debug')) log.debug('sim', event.type, event);
}

/**
 * Debug builds only: `?throwAfterMs=<n>` throws an uncaught error n ms after the app first enters
 * `level`, so a test can prove the « Oups » screen. Once per page load; a value that is not a whole
 * number of ms >= 0 is ignored with a warning.
 */
function armForcedThrow(events: Emitter<ClientEvents>): void {
  const raw = new URLSearchParams(window.location.search).get('throwAfterMs');
  if (raw === null) return;
  const delayMs = parseThrowDelayMs(raw);
  if (delayMs === null) {
    log.warn(
      'boot',
      `ignoring ?throwAfterMs=${raw}: not a whole number of ms in 0..${MAX_TIMER_DELAY_MS}`,
    );
    return;
  }
  const off = events.on('AppStateChanged', ({ to }) => {
    if (to !== 'level') return;
    off();
    window.setTimeout(() => {
      throw new Error('forced by ?throwAfterMs');
    }, delayMs);
  });
}

/**
 * The composition root: the only place that wires content, renderer, UI, flow and pause together.
 * Dependencies are passed explicitly; nothing here is a singleton but `log`. A level (sim, time
 * map, loop) is built by the level session each time the player starts or restarts.
 */
export async function boot(): Promise<void> {
  // First, so that nothing below can fail unseen. The recovery is wired once the level session
  // exists; an error before that is only logged.
  let recoverFromUncaught: () => void = () => {};
  installGlobalErrorHandlers(window, log, () => recoverFromUncaught());
  log.info('boot', 'shell ready');

  const content = await loadContent(createBrowserContentSource());
  if (!content.ok) {
    log.error('content', content.error.message, content.error.problems);
    if (import.meta.env.DEV) {
      const root = document.getElementById('pp-ui');
      if (root === null) {
        log.error('boot', 'missing #pp-ui: cannot show the content error screen');
        return;
      }
      const { showContentError } = await import('./app/contentErrorScreen.ts');
      showContentError(root, content.error);
    }
    return;
  }
  log.info('content', 'content loaded');

  const canvas = document.getElementById('pp-canvas');
  const worldRoot = document.getElementById('pp-world');
  const hudRoot = document.getElementById('pp-hud');
  const uiRoot = document.getElementById('pp-ui');
  if (
    !(canvas instanceof HTMLCanvasElement) ||
    worldRoot === null ||
    hudRoot === null ||
    uiRoot === null
  ) {
    log.error('boot', 'missing #pp-canvas, #pp-world, #pp-hud or #pp-ui: cannot start the game');
    return;
  }

  const t = createTranslator(content.value.strings);
  // A font that fails to load is a `warn` (logged by loadFonts); the fallback stack takes over.
  await loadFonts(document.fonts); // gives up after FONT_LOAD_TIMEOUT_MS

  const created = createRenderer(canvas);
  if (!created.ok) {
    // No WebGL, no scene to put the « Oups » screen over: only logged (see deferred-work.md).
    log.error('render', created.error.message, created.error);
    return;
  }
  const renderer = created.value;

  const camera = createIsoCamera();
  // Behind the start and « Oups » screens until a level has been loaded: an empty ink stage.
  const backdrop = new Scene();
  backdrop.background = new Color(PALETTE.ink);
  let currentLevel: LevelScene | null = null;
  let room: RoomSize | null = null;
  const events = createEmitter<ClientEvents>();
  const appFsm = createAppFsm({ events });
  const pause = createPauseController({ events });

  // Outside a level (start, loading) nothing steps and nothing draws on its own: draw the scene
  // once, and again whenever a resize has cleared the canvas.
  const drawStatic = (): void => {
    if (appFsm.state !== 'level') renderer.render(currentLevel?.scene ?? backdrop, camera);
  };
  // The layer of world-anchored UI (the tap marker): sized like the canvas, or the marker would
  // drift from the tapped point after a resize.
  const worldUi = createWorldUi(worldRoot);
  const fitViewToCanvas = (): void => {
    const aspect = renderer.resize();
    if (aspect !== null && room !== null) fitIsoCamera(camera, room, aspect);
    worldUi.setSize(canvas.clientWidth, canvas.clientHeight);
    drawStatic();
  };
  fitViewToCanvas();
  new ResizeObserver(fitViewToCanvas).observe(canvas);
  window.addEventListener('resize', fitViewToCanvas);
  bindSurface(window, document.documentElement);

  // Debug mirrors of the flow for Playwright, stripped from store builds by the flag. They go
  // before the bindings below, which can emit as soon as they are bound. Story 1.13 brings
  // `window.__PP__`; until then these are how a test sees the app.
  const isMirrored = import.meta.env.VITE_DEBUG_ALLOWED === 'true';
  // Written only when the value changes: a test observing the attributes then sees each real change once.
  const mirror = (
    name:
      | 'ppState'
      | 'ppApp'
      | 'ppLevel'
      | 'ppDrawCalls'
      | 'ppTriangles'
      | 'ppGeometries'
      | 'ppTextures'
      | 'ppPapaState'
      | 'ppPapaAt'
      | 'ppBabyState'
      | 'ppBabyAt'
      | 'ppTap',
    value: string,
  ): void => {
    if (document.documentElement.dataset[name] !== value) {
      document.documentElement.dataset[name] = value;
    }
  };
  const mirrorState = (): void => {
    mirror('ppState', pause.state);
    mirror('ppApp', appFsm.state);
  };
  if (isMirrored) {
    events.on('PauseRequested', mirrorState);
    events.on('ResumeRequested', mirrorState);
    events.on('GameResumed', mirrorState);
    events.on('AppStateChanged', mirrorState);
  }

  // The render stats are mirrored once per level, on its first rendered frame.
  let isStatsMirrored = false;

  // Papa's state and position are mirrored on events, never per frame. The position is read from
  // the live sim (the client only reads the world).
  const mirrorPapaAt = (): void => {
    const papa = levelSession.active?.sim.world.papa;
    if (papa !== undefined) mirror('ppPapaAt', `${papa.xM.toFixed(2)},${papa.zM.toFixed(2)}`);
  };
  const mirrorPapaEvent = (event: SimEvent): void => {
    if (event.type === 'PapaStateChanged') mirror('ppPapaState', event.to);
    if (
      event.type === 'PapaStateChanged' ||
      event.type === 'PapaArrived' ||
      event.type === 'PapaBlocked'
    ) {
      mirrorPapaAt();
    }
  };
  // The baby's, the same way: on its state changes only, read from the live world.
  const mirrorBabyAt = (): void => {
    const baby = levelSession.active?.sim.world.baby;
    if (baby !== undefined) mirror('ppBabyAt', `${baby.xM.toFixed(2)},${baby.zM.toFixed(2)}`);
  };
  const mirrorBabyEvent = (event: SimEvent): void => {
    if (event.type !== 'BabyStateChanged') return;
    mirror('ppBabyState', event.to);
    mirrorBabyAt();
  };
  // A new level begins at the spawn, idle, and has had no tap yet.
  const mirrorNewLevel = (): void => {
    mirror('ppPapaState', levelSession.active?.sim.world.papa.state ?? 'idle');
    mirrorPapaAt();
    mirror('ppBabyState', levelSession.active?.sim.world.baby.state ?? 'babble');
    mirrorBabyAt();
    delete document.documentElement.dataset.ppTap;
  };

  // The level is made later; the screens below only need it when a button is pressed.
  const levelSession = createLevelSession({
    content: content.value,
    appFsm,
    pause,
    renderer,
    camera,
    newSeed: () => crypto.getRandomValues(new Uint32Array(1))[0] as number,
    onSeed: (seed) => {
      if (isMirrored) document.documentElement.dataset.ppSeed = String(seed);
    },
    onLevelReady: (level) => {
      // The room is only known now: fit the camera and show it behind the loading screen.
      currentLevel = level;
      room = level.room;
      isStatsMirrored = false;
      fitViewToCanvas();
      if (isMirrored) mirror('ppLevel', level.id);
    },
    onLevelFrame: () => {
      shell.frame();
      inputMapper.pollGamepad();
      worldUi.render(camera);
      if (isMirrored && !isStatsMirrored) {
        isStatsMirrored = true;
        const { drawCalls, triangles, geometries, textures } = renderer.stats();
        mirror('ppDrawCalls', String(drawCalls));
        mirror('ppTriangles', String(triangles));
        mirror('ppGeometries', String(geometries));
        mirror('ppTextures', String(textures));
      }
    },
    onSimEvent: (event) => {
      logSimEvent(event);
      if (isMirrored) {
        mirrorPapaEvent(event);
        mirrorBabyEvent(event);
      }
      // A key still held after a tap's path ends walks again.
      if (event.type === 'PapaArrived') inputMapper.resumeHeld();
    },
    canResumeNow: () => !shell.isPortrait && document.visibilityState !== 'hidden',
    waitForForeground: () => waitForForeground(document),
  });
  // An error nobody caught, while a level is loading or running: stop it and offer to start again.
  // From any other state (boot, start, result, oops) it is only logged.
  recoverFromUncaught = () => {
    if (appFsm.state !== 'loading' && appFsm.state !== 'level') return;
    levelSession.stop();
    appFsm.enter('oops');
  };

  const hudBatch = createHudBatch([]);
  const hud = createHudLayer(hudRoot, { t, onPausePress: () => pause.requestPause('user') });
  const overlayHost = createOverlayHost(uiRoot, {
    start: () =>
      createStartScreen({
        t,
        target: window,
        onStart: () => {
          // Synchronous, inside the gesture: story 1.9 unlocks the AudioContext on this event.
          events.emit('StartGestureReceived', {});
          void levelSession.start();
        },
      }),
    pause: (mode) =>
      createPauseScreen({
        t,
        events,
        mode,
        onResume: () => pause.requestResume(),
        onRestart: () => void levelSession.start(),
      }),
    portrait: () => createPortraitOverlay({ t }),
    loading: () => createLoadingScreen({ t }),
    oops: () => createOopsScreen({ t, onRetry: () => void levelSession.start() }),
  });
  const shell = createUiShell({ events, appFsm, pause, hud, hudBatch, overlayHost });
  shell.bindKeys(window);

  // Input: raw events become typed, timestamped commands in the mapper, and only while a level is
  // live. Keys and stick are tracked outside that gate so that a resume can send what is held.
  const heldKeys = createHeldKeys();
  const readGamepads = (): ArrayLike<Gamepad | null> => {
    if (typeof navigator.getGamepads === 'function') {
      try {
        return navigator.getGamepads();
      } catch (cause) {
        // A permissions policy (a cross-origin iframe) makes it throw: it must not stop the loop.
        if (!hasWarnedNoGamepads) {
          hasWarnedNoGamepads = true;
          log.warn('input', 'navigator.getGamepads() threw: no gamepad', { cause: String(cause) });
        }
        return [];
      }
    }
    if (!hasWarnedNoGamepads) {
      hasWarnedNoGamepads = true;
      log.warn('input', 'the Gamepad API is not available here (insecure context?): no gamepad');
    }
    return [];
  };
  let hasWarnedNoGamepads = false;
  const inputMapper = createInputMapper({
    appFsm,
    pause,
    getActive: () => levelSession.active,
    hitTester: createHitTester(camera),
    canvasRect: () => canvas.getBoundingClientRect(),
    held: heldKeys.held,
    gamepad: createGamepadInput(readGamepads),
    moveIntent: createMoveIntent({
      camera,
      input: content.value.feel.input,
      send: (command) => levelSession.active?.sim.enqueue(command),
    }),
    showTapMarker: (xM, zM) => worldUi.tapMarker.showAt(xM, zM),
    onTap: (xM, zM) => {
      if (isMirrored) mirror('ppTap', `${xM.toFixed(2)},${zM.toFixed(2)}`);
    },
    nowAtReal: () => performance.now(),
  });
  bindPointer(canvas, (sample) => inputMapper.handlePointerDown(sample));
  bindKeyboard(heldKeys, window, document, {
    onChange: (timeStampAtReal) => inputMapper.onKeysChanged(timeStampAtReal),
    isLive: () => inputMapper.isLive(),
  });
  events.on('GameResumed', () => inputMapper.resync());
  events.on('AppStateChanged', ({ to }) => {
    if (to !== 'level') return;
    inputMapper.resync();
    if (isMirrored) mirrorNewLevel();
  });

  // Subscribers are in place: the bindings below can emit.
  bindOrientation(matchMedia('(orientation: portrait)'), (isPortrait) => {
    shell.setPortrait(isPortrait);
    if (isPortrait && appFsm.state === 'level') pause.requestPause('portrait');
  });
  bindVisibilityPause(document, pause); // also pauses at once if the page starts hidden

  if (import.meta.env.VITE_DEBUG_ALLOWED === 'true') armForcedThrow(events);

  appFsm.enter('start');
  drawStatic();
  // Written once more here so that the attributes only appear once the app is up.
  if (isMirrored) mirrorState();

  log.info('boot', 'ready: waiting for the first gesture');
}
