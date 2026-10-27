import { loadContent } from '@content/loadContent';
import {
  PROVISIONAL_ROOM_DEPTH_M,
  PROVISIONAL_ROOM_HEIGHT_M,
  PROVISIONAL_ROOM_WIDTH_M,
} from '@shared/constants';
import { createEmitter } from '@shared/emitter';
import { log } from '@shared/log';
import type { SimEvent } from '@sim';
import { createAppFsm } from './app/appFsm.ts';
import type { ClientEvents } from './app/clientEvents.ts';
import { installGlobalErrorHandlers } from './app/globalErrorHandlers.ts';
import { createLevelSession } from './app/levelSession.ts';
import { bindOrientation } from './app/orientation.ts';
import { createPauseController } from './app/pauseController.ts';
import { bindSurface } from './app/surface.ts';
import { bindVisibilityPause } from './app/visibilityPause.ts';
import { createBrowserContentSource } from './assets/browserContentSource.ts';
import { createIsoCamera, fitIsoCamera, type RoomSize } from './render/isoCamera.ts';
import { createProvisionalScene } from './render/provisionalScene.ts';
import { createRenderer } from './render/renderer.ts';
import { loadFonts } from './ui/fonts.ts';
import { createHudBatch } from './ui/hud/hudBatch.ts';
import { createHudLayer } from './ui/hud/hudLayer.ts';
import { createOverlayHost } from './ui/overlayHost.ts';
import { createPauseScreen } from './ui/screens/pauseScreen.ts';
import { createPortraitOverlay } from './ui/screens/portraitOverlay.ts';
import { createStartScreen } from './ui/screens/startScreen.ts';
import { createTranslator } from './ui/strings.ts';
import { createUiShell } from './ui/uiShell.ts';

// Provisional, like the scene: story 1.6 passes the real level bounds.
const ROOM: RoomSize = {
  widthM: PROVISIONAL_ROOM_WIDTH_M,
  depthM: PROVISIONAL_ROOM_DEPTH_M,
  heightM: PROVISIONAL_ROOM_HEIGHT_M,
};

function logSimEvent(event: SimEvent): void {
  if (event.type === 'InvariantViolated') {
    log.warn('sim', `invariant violated: ${event.name}`, event);
    return;
  }
  // Story 1.9 replaces this with the FeedbackDirector.
  if (log.enabled('debug')) log.debug('sim', event.type, event);
}

/**
 * The composition root: the only place that wires content, renderer, UI, flow and pause together.
 * Dependencies are passed explicitly; nothing here is a singleton but `log`. A level (sim, time
 * map, loop) is built by the level session each time the player starts or restarts.
 */
export async function boot(): Promise<void> {
  // First, so that nothing below can fail unseen.
  installGlobalErrorHandlers(window);
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
  const hudRoot = document.getElementById('pp-hud');
  const uiRoot = document.getElementById('pp-ui');
  if (!(canvas instanceof HTMLCanvasElement) || hudRoot === null || uiRoot === null) {
    log.error('boot', 'missing #pp-canvas, #pp-hud or #pp-ui: cannot start the game');
    return;
  }

  const t = createTranslator(content.value.strings);
  // A font that fails to load is a `warn` (logged by loadFonts); the fallback stack takes over.
  await loadFonts(document.fonts); // gives up after FONT_LOAD_TIMEOUT_MS

  const created = createRenderer(canvas);
  if (!created.ok) {
    // The player-facing fallback is story 1.6 (the « Oups » screen).
    log.error('render', created.error.message, created.error);
    return;
  }
  const renderer = created.value;

  const camera = createIsoCamera();
  const scene = createProvisionalScene();
  const events = createEmitter<ClientEvents>();
  const appFsm = createAppFsm({ events });
  const pause = createPauseController({ events });

  // Outside a level (start, loading) nothing steps and nothing draws on its own: draw the scene
  // once, and again whenever a resize has cleared the canvas.
  const drawStatic = (): void => {
    if (appFsm.state !== 'level') renderer.render(scene.scene, camera);
  };
  const fitViewToCanvas = (): void => {
    const aspect = renderer.resize();
    if (aspect !== null) fitIsoCamera(camera, ROOM, aspect);
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
  const mirror = (name: 'ppState' | 'ppApp', value: string): void => {
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

  // The level is made later; the screens below only need it when a button is pressed.
  const levelSession = createLevelSession({
    content: content.value,
    appFsm,
    pause,
    renderer,
    camera,
    scene,
    newSeed: () => crypto.getRandomValues(new Uint32Array(1))[0] as number,
    onSeed: (seed) => {
      if (isMirrored) document.documentElement.dataset.ppSeed = String(seed);
    },
    onLevelFrame: () => shell.frame(),
    onSimEvent: logSimEvent,
    canResumeNow: () => !shell.isPortrait && document.visibilityState !== 'hidden',
  });

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
  });
  const shell = createUiShell({ events, appFsm, pause, hud, hudBatch, overlayHost });
  shell.bindKeys(window);

  // Subscribers are in place: the bindings below can emit.
  bindOrientation(matchMedia('(orientation: portrait)'), (isPortrait) => {
    shell.setPortrait(isPortrait);
    if (isPortrait && appFsm.state === 'level') pause.requestPause('portrait');
  });
  bindVisibilityPause(document, pause); // also pauses at once if the page starts hidden

  appFsm.enter('start');
  drawStatic();
  // Written once more here so that the attributes only appear once the app is up.
  if (isMirrored) mirrorState();

  log.info('boot', 'ready: waiting for the first gesture');
}
