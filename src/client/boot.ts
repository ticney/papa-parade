import { loadContent } from '@content/loadContent';
import {
  PROVISIONAL_ROOM_DEPTH_M,
  PROVISIONAL_ROOM_HEIGHT_M,
  PROVISIONAL_ROOM_WIDTH_M,
} from '@shared/constants';
import { createEmitter } from '@shared/emitter';
import { log } from '@shared/log';
import { createSim, type SimEvent } from '@sim';
import type { ClientEvents } from './app/clientEvents.ts';
import { installGlobalErrorHandlers } from './app/globalErrorHandlers.ts';
import { createPauseController } from './app/pauseController.ts';
import { bindVisibilityPause } from './app/visibilityPause.ts';
import { createBrowserContentSource } from './assets/browserContentSource.ts';
import { createGameLoop } from './loop.ts';
import { createIsoCamera, fitIsoCamera, type RoomSize } from './render/isoCamera.ts';
import { createProvisionalScene } from './render/provisionalScene.ts';
import { createRenderer } from './render/renderer.ts';
import { createTimeMap } from './timeMap.ts';

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
 * The composition root: the only place that wires content, sim, renderer, loop and pause
 * together. Dependencies are passed explicitly; nothing here is a singleton but `log`.
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
  if (!(canvas instanceof HTMLCanvasElement)) {
    log.error('boot', 'missing #pp-canvas: cannot start the game');
    return;
  }

  // The client may use randomness (the sim may not). Logging the seed makes any run reproducible.
  const seed = crypto.getRandomValues(new Uint32Array(1))[0] as number;
  const sim = await createSim({ content: content.value, seed });
  log.info('boot', 'sim ready', { seed });

  const created = createRenderer(canvas);
  if (!created.ok) {
    // The player-facing fallback is story 1.6 (the « Oups » screen).
    log.error('render', created.error.message, created.error);
    return;
  }
  const renderer = created.value;

  const camera = createIsoCamera();
  const scene = createProvisionalScene();
  const fitViewToCanvas = (): void => {
    const aspect = renderer.resize();
    if (aspect !== null) fitIsoCamera(camera, ROOM, aspect);
  };
  fitViewToCanvas();
  new ResizeObserver(fitViewToCanvas).observe(canvas);
  window.addEventListener('resize', fitViewToCanvas);

  const events = createEmitter<ClientEvents>();
  const pause = createPauseController({ events });

  // Provisional: story 1.5 replaces it with the pause panel.
  // Mirrors the pause state for Playwright; stripped from store builds by the flag. Subscribed
  // before the visibility binding, which pauses at once (and emits) if the page starts hidden.
  const isStateMirrored = import.meta.env.VITE_DEBUG_ALLOWED === 'true';
  const mirrorPauseState = (): void => {
    document.documentElement.dataset.ppState = pause.state;
  };
  if (isStateMirrored) {
    events.on('PauseRequested', mirrorPauseState);
    events.on('ResumeRequested', mirrorPauseState);
    events.on('GameResumed', mirrorPauseState);
  }
  bindVisibilityPause(document, pause); // also pauses at once if the page starts hidden

  const timeMap = createTimeMap();
  const render = (alpha: number): void => {
    scene.update(sim.world, alpha);
    renderer.render(scene.scene, camera);
  };
  const loop = createGameLoop({ sim, timeMap, pause, render, onSimEvent: logSimEvent });
  loop.start();

  // Provisional: story 1.5 replaces it with the pause panel.
  // Until then a tap anywhere resumes a paused game (otherwise a tab switch would pause it for good).
  canvas.addEventListener('pointerdown', () => {
    if (pause.state === 'paused') pause.requestResume();
  });

  // Written once more here so that the attribute only appears once the game is up and running.
  if (isStateMirrored) mirrorPauseState();

  log.info('boot', 'game running');
}
