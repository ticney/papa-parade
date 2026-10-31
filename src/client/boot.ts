import { feedbackClips } from '@content/feedbackClips';
import { loadContent } from '@content/loadContent';
import { loadLevelContent } from '@content/loadLevelContent';
import type { Feel } from '@content/schemas/feel';
import { GAUGE_IDS, type GaugeId } from '@content/schemas/level';
import type { Settings } from '@content/schemas/save';
import type { SequenceDef } from '@content/schemas/sequence';
import { createPlatform } from '@platform/createPlatform';
import { DEFAULT_DIFFICULTY_TIER, MAX_TIMER_DELAY_MS, MS_PER_S, STEP_MS } from '@shared/constants';
import { createEmitter, type Emitter } from '@shared/emitter';
import { log } from '@shared/log';
import { ok } from '@shared/result';
import {
  type BeatEntry,
  beatTimelineOf,
  isFlowLive,
  isPapaBusy,
  type LevelEndReason,
  type MamaScore,
  type Sim,
  type SimEvent,
  type SimObjectSpec,
} from '@sim';
import { Color, Group, Scene, Vector3 } from 'three';
import { createAccessibilitySettings } from './app/accessibilitySettings.ts';
import { createAppFsm, isSettingsDetour } from './app/appFsm.ts';
import { createCalibrationFlow } from './app/calibrationFlow.ts';
import type { ClientEvents } from './app/clientEvents.ts';
import { isTestApiEnabled, readDebugParams } from './app/debugParams.ts';
import { parseThrowDelayMs } from './app/forcedThrow.ts';
import { waitForForeground } from './app/foreground.ts';
import { installGlobalErrorHandlers } from './app/globalErrorHandlers.ts';
import { createLevelSession, type StartedLevel } from './app/levelSession.ts';
import { bindOrientation } from './app/orientation.ts';
import { createPauseController } from './app/pauseController.ts';
import { bindSurface } from './app/surface.ts';
import type { BeatSampleRecord, CuePlayedRecord, TestHost } from './app/testHost.ts';
import { readThreatsOff, withoutThreats } from './app/threatsSwitch.ts';
import { bindVisibilityPause } from './app/visibilityPause.ts';
import { createBrowserContentSource } from './assets/browserContentSource.ts';
import { isSlowMoActive, isTensionActive } from './audio/adaptiveMusic.ts';
import { createAudioEngine } from './audio/audioEngine.ts';
import {
  type BeatSchedulerFrame,
  beatLeadMs,
  createBeatScheduler,
  type SoundedNote,
} from './audio/beatScheduler.ts';
import { createFeedbackDirector } from './feedback/feedbackDirector.ts';
import { createGatedHaptics } from './feedback/gatedHaptics.ts';
import { isNoiseAlertCrossing } from './feedback/noiseAlert.ts';
import { createResponseChoreography } from './feedback/responseChoreography.ts';
import { playSimEventFeedback } from './feedback/simEventFeedback.ts';
import { createGamepadInput } from './input/gamepadInput.ts';
import { createHitTester, type ObjectTarget, type ThreatTargets } from './input/hitTest.ts';
import { createInputMapper } from './input/inputMapper.ts';
import { bindKeyboard, createHeldKeys } from './input/keyboardInput.ts';
import { keyGlyph, loadKeyboardLayoutMap, padConfirmGlyph } from './input/keyGlyphs.ts';
import { createMoveIntent } from './input/moveIntent.ts';
import { bindPointer } from './input/pointerInput.ts';
import { createAdaptivePixelRatio } from './render/adaptivePixelRatio.ts';
import { createCameraFx, type SequenceFraming, sequenceFramingBlendAt } from './render/cameraFx.ts';
import { slideDirection } from './render/gags.ts';
import { createIsoCamera, fitIsoCamera, type RoomSize } from './render/isoCamera.ts';
import type { LevelScene } from './render/levelScene.ts';
import { PALETTE } from './render/materials/palette.ts';
import { createRenderer, type RenderStats } from './render/renderer.ts';
import { BABY_CARRIED_FORWARD_M, BABY_CARRIED_HEIGHT_M } from './render/views/babyView.ts';
import { createSaveStore } from './save/saveStore.ts';
import { loadFonts } from './ui/fonts.ts';
import { createEpicStamp } from './ui/hud/epicStamp.ts';
import { createGaugesHud } from './ui/hud/gaugesHud.ts';
import { createHudBatch } from './ui/hud/hudBatch.ts';
import { createHudLayer } from './ui/hud/hudLayer.ts';
import { createInstinctVignette } from './ui/hud/instinctVignette.ts';
import { createScreenFlash } from './ui/hud/screenFlash.ts';
import { createSequenceBar } from './ui/hud/sequenceBar.ts';
import { createSilenceBubble } from './ui/hud/silenceBubble.ts';
import { createTimerHud } from './ui/hud/timerHud.ts';
import { createOverlayHost } from './ui/overlayHost.ts';
import { createCreditsScreen } from './ui/screens/creditsScreen.ts';
import { createLoadingScreen } from './ui/screens/loadingScreen.ts';
import { createOopsScreen } from './ui/screens/oopsScreen.ts';
import { createPauseScreen } from './ui/screens/pauseScreen.ts';
import { createPortraitOverlay } from './ui/screens/portraitOverlay.ts';
import { type CopyLogOutcome, createResultScreen } from './ui/screens/resultScreen.ts';
import { createSettingsScreen } from './ui/screens/settingsScreen.ts';
import { createStartScreen } from './ui/screens/startScreen.ts';
import { createTranslator } from './ui/strings.ts';
import { createUiShell } from './ui/uiShell.ts';
import { createWorldUi } from './ui/world/worldUi.ts';

/** The timer's slot in the HUD batch. */
const TIMER_SLOT = 0;
/** One slot per gauge after the timer's: the batch writes a gauge's integer percent when it changes. */
const gaugeSlotOf = (id: GaugeId): number => GAUGE_IDS.indexOf(id) + 1;
/** The sequence bar's slot, after the gauges' (story 4.4): its whole percent. */
const SEQUENCE_SLOT = GAUGE_IDS.length + 1;
/** The most the scheduler takes off the audio clock to pair it with the loop's, in real ms (story 4.5): a frame older than this is a clock to distrust, not a skew to correct. */
const BEAT_CLOCK_AGE_MAX_MS = 100;
const NO_OBJECTS: readonly ObjectTarget[] = [];
const NO_SIM_OBJECTS: readonly SimObjectSpec[] = [];
/** What the Result screen shows if it ever has no note (a bug, warned about): all zero. */
const NO_SCORE: MamaScore = {
  laughPoints: 0,
  babyStatePoints: 0,
  sighPoints: 0,
  screamPoints: 0,
  scorePoints: 0,
  stars: 0,
  lostStars: 0,
};

function logSimEvent(event: SimEvent): void {
  if (event.type === 'InvariantViolated') {
    log.warn('sim', `invariant violated: ${event.name}`, event);
    return;
  }
  if (event.type === 'LevelEnded') {
    log.info('sim', 'level ended', { reason: event.reason, t: event.t });
    return;
  }
  // Everything else is for the feedback director (it plays what `content/feedback.json` lists).
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

  const contentSource = createBrowserContentSource();
  const content = await loadContent(contentSource);
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
  // The perfect's zoom, pan and turn, around the framing `fitIsoCamera` computes (story 2.5).
  const cameraFx = createCameraFx(camera);
  // The special sequence's framing, one object written each frame (story 4.4), and the defs of the
  // level being played, set at its start.
  const sequenceFraming: SequenceFraming = { blend: 0, zoomPct: 0, focusPct: 0, xM: 0, zM: 0 };
  let currentSequences: Readonly<Record<string, SequenceDef>> | null = null;
  // Behind the start and « Oups » screens until a level has been loaded: an empty ink stage.
  const backdrop = new Scene();
  backdrop.background = new Color(PALETTE.ink);
  let currentLevel: LevelScene | null = null;
  /** The debug views' group in the level scene, made on demand (a debug build only asks); null per new scene. */
  let debugGroup: Group | null = null;
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
  const worldUi = createWorldUi(worldRoot, document, undefined, {
    translate: t,
    isMotionReduced: () => prefersReducedMotion(),
  });
  const fitViewToCanvas = (): void => {
    const aspect = renderer.resize();
    if (aspect !== null && room !== null) {
      fitIsoCamera(camera, room, aspect);
      cameraFx.captureBase();
    }
    worldUi.setSize(canvas.clientWidth, canvas.clientHeight);
    drawStatic();
  };
  fitViewToCanvas();
  // `loadFonts` gives up after a timeout and the game starts on the fallback font: a verb measured on it
  // is refitted when the display font does arrive (story 2.2, AC 6).
  void document.fonts.ready.then(() => worldUi.refitVerbs());
  new ResizeObserver(fitViewToCanvas).observe(canvas);
  window.addEventListener('resize', fitViewToCanvas);
  bindSurface(window, document.documentElement);

  // Debug mirrors of the flow for Playwright, stripped from store builds by the flag. They go
  // before the bindings below, which can emit as soon as they are bound. The existing specs read
  // these; `window.__PP__` (installed at the end of boot) is the API for new ones.
  const isMirrored = import.meta.env.VITE_DEBUG_ALLOWED === 'true';
  // `?debug`, `?autoplay`, `?seed`, `?speed`: read only where debug code is allowed at all.
  const params = isMirrored
    ? readDebugParams(window.location.search)
    : { isDebug: false, autoplay: null, seed: null, speed: null };
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
      | 'ppPixelRatio'
      | 'ppPapaState'
      | 'ppPapaAt'
      | 'ppBabyState'
      | 'ppPutDown'
      | 'ppCombo'
      | 'ppComboCashed'
      | 'ppBabyAt'
      | 'ppTap'
      | 'ppAudio'
      | 'ppAudioClips'
      | 'ppBabble'
      | 'ppMusic'
      | 'ppMusicTense'
      | 'ppMusicSlow'
      | 'ppMusicTenseCount'
      | 'ppMusicSlowCount'
      | 'ppHaptics'
      | 'ppVolumes'
      | 'ppCue'
      | 'ppFlow'
      | 'ppSequence'
      | 'ppSequenceOutcome'
      | 'ppSequenceMusic'
      | 'ppBeatHits'
      | 'ppBeatMisses'
      | 'ppBabyWake'
      | 'ppCueCount'
      | 'ppFlashCount'
      | 'ppStampCount'
      | 'ppThreat'
      | 'ppThreatPx'
      | 'ppResponse'
      | 'ppGag'
      | 'ppPress'
      | 'ppFatigue'
      | 'ppNoise'
      | 'ppBladder'
      | 'ppPhone'
      | 'ppSilence'
      | 'ppInstinct'
      | 'ppBabyPx'
      | 'ppObjectPx'
      | 'ppTarget'
      | 'ppScore'
      | 'ppStars'
      | 'ppLostStars'
      | 'ppEndReason'
      | 'ppResult'
      | 'ppCalibration'
      | 'ppCalibrationBeats',
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

  // The device, then the sound and the feedback of the game, wired in the composition root: the
  // platform may not import content, so the vibration patterns reach it from here.
  const feedbackTable = content.value.feedback;
  const platform = createPlatform({
    target: import.meta.env.VITE_TARGET,
    hapticPatternsMs: {
      light: feedbackTable.haptics.light.patternMs,
      medium: feedbackTable.haptics.medium.patternMs,
      heavy: feedbackTable.haptics.heavy.patternMs,
      heartbeat: feedbackTable.haptics.heartbeat.patternMs,
    },
  });
  // The save (story 2.7): read before the start screen is up (below), so that `onStart` can decide
  // between the calibration and the level without an await, inside the first gesture.
  const saveStore = createSaveStore(platform.storage);
  // The calibrated screen latency, subtracted from every input stamp (the mapper) and told to the
  // sim as the lag it must wait for (`SetInputLag`). 0 until the player has calibrated.
  const visualOffsetMs = (): number => saveStore.current().calibration?.visualOffsetMs ?? 0;
  // Each entry into a music mood, counted (story 2.6): polling misses a short slow-mo at speed 4.
  const musicMoodCounts = { tense: 0, slow: 0 };
  // Whether a sequence's own music really plays (the engine says so): the level stems give way to it
  // only then, so a clip that is not decoded or fails to start never leaves the sequence in silence.
  let isSequenceMusicOn = false;
  const audio = createAudioEngine({
    table: feedbackTable,
    getMusicFeel: () => levelFeel().music,
    onMusicMoodChange: (mood, isOn) => {
      if (isOn) musicMoodCounts[mood] += 1;
      if (!isMirrored) return;
      if (mood === 'tense') {
        mirror('ppMusicTense', isOn ? 'on' : 'off');
        mirror('ppMusicTenseCount', String(musicMoodCounts.tense));
      } else {
        mirror('ppMusicSlow', isOn ? 'on' : 'off');
        mirror('ppMusicSlowCount', String(musicMoodCounts.slow));
      }
    },
    onStateChange: (state) => {
      if (isMirrored) mirror('ppAudio', state);
    },
    onClipsDecoded: (count) => {
      if (isMirrored) mirror('ppAudioClips', String(count));
    },
    onLoopChange: (loop, isOn) => {
      if (loop === 'sequenceMusic') isSequenceMusicOn = isOn;
      if (!isMirrored) return;
      const name =
        loop === 'babble' ? 'ppBabble' : loop === 'sequenceMusic' ? 'ppSequenceMusic' : 'ppMusic';
      mirror(name, isOn ? 'on' : 'off');
    },
  });
  // The notes of a rhythm step (story 4.5), planned one by one on the audio clock. The debug build
  // listens to the notes that sounded and to the (audio, game) clock pairs, for `__PP__.beatLog()`.
  const beatSoundedListeners: ((note: SoundedNote) => void)[] = [];
  const beatSampleListeners: ((sample: BeatSampleRecord) => void)[] = [];
  const beatSample: { audioNowS: number; clockMs: number } = { audioNowS: 0, clockMs: 0 };
  // The lullaby walk's counters, for the mirrors (declared here: `mirrorNewLevel` resets them).
  let beatHitCount = 0;
  let beatMissCount = 0;
  const beatScheduler = createBeatScheduler({
    audio,
    scheduleAheadMs: feedbackTable.beatScheduler.scheduleAheadMs,
    replanToleranceMs: feedbackTable.beatScheduler.replanToleranceMs,
    onSounded: (note) => {
      for (const listener of beatSoundedListeners) listener(note);
    },
  });
  // The one frame object the scheduler reads, rewritten each frame (no allocation), and the beat
  // timeline of every step of the level's sequences (derived from content at the level's start).
  const beatFrame: BeatSchedulerFrame = {
    timeline: null,
    track: null,
    stepStartAt: 0,
    cueIndex: 0,
    clockMs: 0,
    simPerRealMs: 0,
    leadMs: 0,
    clockAgeMs: 0,
  };
  let currentBeatTimelines: Readonly<Record<string, readonly (readonly BeatEntry[] | null)[]>> = {};
  let cuesPlayedCount = 0;
  let flashesDrawnCount = 0;
  let stampsShownCount = 0;
  // The full-screen flash of a perfect (story 2.4): one overlay in the HUD root, on real time.
  const screenFlash = createScreenFlash(document, { nowReal: () => performance.now() });
  hudRoot.append(screenFlash.element);
  // The « PARADE PARFAITE » stamp (story 2.5): one overlay above the flash, on real time.
  const epicStamp = createEpicStamp(document, { text: t('stamp.perfect_parry') });
  hudRoot.append(epicStamp.element);
  // The visuals the cue being played drew (`onVisual`), handed to the test host with `onCue`, which
  // the director calls last. Debug builds only listen; an empty array otherwise.
  const visualsOfCue: string[] = [];
  const cuePlayedListeners: ((record: CuePlayedRecord) => void)[] = [];
  // The two comfort settings (story 2.10): one source for JS (`isMotionReduced`) and CSS (the root's
  // `data-pp-motion` and `--pp-verb-scale`). The OS query is followed live (its `change` event): the
  // player can change it while the page is open. Applied once now (what shows before the save is read
  // follows the OS), once the save is loaded, and on each `SettingsChanged`. A real feature, in prod
  // too: never through `mirror()`.
  const accessibility = createAccessibilitySettings({
    root: document.documentElement,
    motionQuery: matchMedia('(prefers-reduced-motion: reduce)'),
    settings: () => saveStore.current().settings,
    onVerbScaleChanged: () => worldUi.refitVerbs(),
  });
  accessibility.apply();
  // The one source of « motion reduced » for every effect of the screen (story 2.5).
  const prefersReducedMotion = accessibility.isMotionReduced;
  const director = createFeedbackDirector({
    table: feedbackTable,
    audio,
    // Read at each pulse: the settings' switch applies to the very next one (story 2.8).
    haptics: createGatedHaptics(platform.haptics, () => saveStore.current().settings.haptics),
    // Only while a level is on: a scene behind the loading screen must not play for a dead sim.
    getScene: () => (appFsm.state === 'level' ? (currentLevel?.fx ?? null) : null),
    // Where an `object`-anchored ring (the phone's) starts from.
    getObjects: () => levelSession.active?.sim.objects ?? NO_SIM_OBJECTS,
    prefersReducedMotion,
    flash: (peakOpacityPct, durationMs, isMotionReduced) =>
      screenFlash.flash(peakOpacityPct, durationMs, isMotionReduced),
    // The live feel: a change in the debug panel applies to the next cue.
    getFx: () => levelFeel().fx,
    nowReal: () => performance.now(),
    stamp: (durationMs, isMotionReduced) => epicStamp.show(durationMs, isMotionReduced),
    onVisual: (_cueId, kind) => {
      if (!isMirrored) return;
      visualsOfCue.push(kind);
      if (kind === 'flash') mirror('ppFlashCount', String(++flashesDrawnCount));
      if (kind === 'stamp') mirror('ppStampCount', String(++stampsShownCount));
    },
    onCue: (cueId) => {
      cuesPlayedCount++;
      if (isMirrored) {
        const record: CuePlayedRecord = {
          cueId,
          visuals: [...visualsOfCue],
          atReal: performance.now(),
          haptic: Object.hasOwn(feedbackTable.cues, cueId)
            ? (feedbackTable.cues[cueId]?.haptic ?? null)
            : null,
        };
        visualsOfCue.length = 0;
        // A copy: a listener may unsubscribe while it runs. A throwing one does not stop the others.
        for (const listener of [...cuePlayedListeners]) {
          try {
            listener(record);
          } catch (error) {
            log.warn('boot', 'a cue listener threw', { cueId, error: String(error) });
          }
        }
      }
      if (isMirrored) {
        mirror('ppCue', cueId);
        mirror('ppCueCount', String(cuesPlayedCount));
      }
    },
  });
  if (isMirrored) {
    mirror('ppAudio', audio.state);
    mirror('ppAudioClips', '0');
    mirror('ppBabble', 'off');
    mirror('ppMusic', 'off');
    mirror('ppSequenceMusic', 'off');
    mirror('ppMusicTense', 'off');
    mirror('ppMusicSlow', 'off');
    mirror('ppMusicTenseCount', '0');
    mirror('ppMusicSlowCount', '0');
    mirror('ppHaptics', String(platform.capabilities.haptics));
    mirror('ppCueCount', '0');
    mirror('ppFlashCount', '0');
    mirror('ppStampCount', '0');
  }
  // The context is suspended with every pause, the countdown's included, and resumed only when the
  // countdown is over; the loops follow the level. None of these throws: the engine logs its own.
  events.on('PauseRequested', () => audio.suspend());
  events.on('GameResumed', () => audio.resume());
  // Story 2.8: the settings are a detour over a live level (`isSettingsDetour`), so the music stays
  // across them (silent: the context is suspended, and it goes on where it was). A calibration needs
  // a running context and no music under its beeps: the loops stop, and `startLevelLoops` (idempotent)
  // restarts them from the top when the settings go back to the level.
  events.on('AppStateChanged', ({ from, to }) => {
    if (to === 'level') audio.startLevelLoops();
    else if (to === 'calibration') audio.stopLevelLoops();
    else if (from === 'level' && to !== 'settings') audio.stopLevelLoops();
    // « Oups » out of the settings or the credits: the level is gone.
    else if (to === 'oops') audio.stopLevelLoops();
  });
  // A recalibration from the pause woke the context for its beeps (`startRecalibration`): the game is
  // still paused, so the countdown and the panel must stay silent (D3).
  events.on('AppStateChanged', ({ from, to }) => {
    if (from === 'calibration' && to === 'settings' && pause.state !== 'running') audio.suspend();
  });
  // The volumes of the settings (story 2.8). A mirror in debug builds, so that a spec sees them applied.
  const applyPlayerVolumes = (volumes: Settings['volumes']): void => {
    audio.setPlayerVolumes(volumes);
    if (isMirrored)
      mirror('ppVolumes', `${volumes.music},${volumes.sfx},${volumes.voice},${volumes.ui}`);
  };
  events.on('SettingsChanged', ({ settings }) => {
    applyPlayerVolumes(settings.volumes);
    accessibility.apply();
  });
  // The countdown's digit is a haptic tick (its visual twin is the digit's pulse).
  events.on('CountdownTicked', () => director.handle('CountdownTicked', null));

  // The threat the player pressed last, until it is no longer active: the world UI highlights it
  // from the next frame (D8), before the sim has applied the press.
  let highlightedThreatId: number | null = null;
  // The names the browser gives the keys of the layout in use; null until loaded, or where it cannot.
  let keyboardLayoutMap: ReadonlyMap<string, string> | null = null;
  // The chip's text, recomputed only when what it depends on changes (no string built per frame).
  let chipText = '';
  let chipDevice: 'keyboard' | 'gamepad' | null = null;
  let chipFamily: 'xbox' | 'playstation' | null = null;
  let chipMap: ReadonlyMap<string, string> | null = null;
  const choreography = createResponseChoreography();
  const noLiftFx = { liftBaby: () => {} };
  /** The direction of the last gag's slide, written once per `GagTriggered`. */
  const slideDir = { x: 0, z: 0 };
  const stripThreats = isMirrored && readThreatsOff(window.location.search);

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
    // Where the baby was put down, on the event (story 4.1): `safe` in a safe zone, else `unsafe`.
    if (event.type === 'BabyPutDown') {
      mirror('ppPutDown', event.safe ? 'safe' : 'unsafe');
      return;
    }
    if (event.type !== 'BabyStateChanged') return;
    mirror('ppBabyState', event.to);
    mirrorBabyAt();
  };
  // The combo (story 4.2), on its events: the multiplier on `ComboChanged`, the points on `ComboCashedIn`.
  const mirrorComboEvent = (event: SimEvent): void => {
    if (event.type === 'ComboChanged') mirror('ppCombo', String(event.multiplier));
    else if (event.type === 'ComboCashedIn') mirror('ppComboCashed', String(event.points));
  };
  // Papa's fatigue, rounded: on `FatigueThresholdCrossed` and `CoffeeDrunk` only, never per frame.
  const mirrorFatigue = (): void => {
    const active = levelSession.active;
    if (active === null || active.level.level.gauges.fatigue === undefined) {
      delete document.documentElement.dataset.ppFatigue;
      return;
    }
    mirror('ppFatigue', String(Math.round(active.sim.world.gauges.fatigue)));
  };
  // The noise, rounded: at the level start and on each `NoiseChanged`, never per frame (the decay is
  // silent: a test reads `__PP__` for exact values). Removed in a level with no noise gauge.
  const mirrorNoise = (): void => {
    const active = levelSession.active;
    if (active === null || active.level.level.gauges.noise === undefined) {
      delete document.documentElement.dataset.ppNoise;
      return;
    }
    mirror('ppNoise', String(Math.round(active.sim.world.gauges.noisePct)));
  };
  // The need, rounded, like the noise (story 4.3): at the level start and on `BladderFilled`,
  // `ToiletStarted` and `ToiletFinished`, never per frame. Removed in a level with no need gauge.
  const mirrorBladder = (): void => {
    const active = levelSession.active;
    if (active === null || active.level.level.gauges.need === undefined) {
      delete document.documentElement.dataset.ppBladder;
      return;
    }
    mirror('ppBladder', String(Math.round(active.sim.world.gauges.bladderPct)));
  };
  // Where each interactive object's icon point is on the page, in px: `coffee_machine:x,y;phone:x,y`.
  // Written once per level (the camera is fitted by then), for a Playwright tap on an object.
  const mirrorObjectPoints = (): void => {
    const objects = levelSession.active?.sim.objects;
    if (objects === undefined) return;
    const rect = canvas.getBoundingClientRect();
    mirror(
      'ppObjectPx',
      objects
        .map((object) => {
          iconPoint.set(object.xM, object.yM, object.zM).project(camera);
          const x = rect.left + ((iconPoint.x + 1) / 2) * rect.width;
          const y = rect.top + ((1 - iconPoint.y) / 2) * rect.height;
          return `${object.id}:${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(';'),
    );
  };
  // A new level begins at the spawn, idle, and has had no tap yet.
  const mirrorNewLevel = (): void => {
    mirror('ppFlow', 'playing');
    mirror('ppPapaState', levelSession.active?.sim.world.papa.state ?? 'idle');
    mirrorPapaAt();
    mirror('ppBabyState', levelSession.active?.sim.world.baby.state ?? 'babble');
    mirrorBabyAt();
    mirrorFatigue();
    mirrorNoise();
    mirrorBladder();
    mirrorObjectPoints();
    mirror('ppCombo', String(levelSession.active?.sim.world.combo.multiplier ?? 1));
    delete document.documentElement.dataset.ppTap;
    for (const name of [
      'ppPutDown',
      'ppComboCashed',
      'ppThreat',
      'ppThreatPx',
      'ppResponse',
      'ppGag',
      'ppPress',
      'ppTarget',
      'ppPhone',
      'ppSilence',
      'ppInstinct',
      'ppBabyPx',
      'ppScore',
      'ppStars',
      'ppLostStars',
      'ppEndReason',
      'ppResult',
      'ppSequence',
      'ppSequenceOutcome',
      'ppBeatHits',
      'ppBeatMisses',
      'ppBabyWake',
    ] as const) {
      delete document.documentElement.dataset[name];
    }
    beatHitCount = 0;
    beatMissCount = 0;
  };
  // The special sequence, on its events only (story 4.4): the flow state follows it and back, the id
  // is there while it runs, and the last outcome stays. `levelEnded` leaves the flow to `LevelEnded`.
  const mirrorSequenceEvent = (event: SimEvent): void => {
    if (event.type === 'SequenceStarted') {
      mirror('ppFlow', 'sequence');
      mirror('ppSequence', event.id);
    } else if (event.type === 'SequenceEnded') {
      delete document.documentElement.dataset.ppSequence;
      mirror('ppSequenceOutcome', event.outcome);
      if (event.outcome !== 'levelEnded') mirror('ppFlow', 'playing');
    }
  };
  // The lullaby walk, on its events only (story 4.5): the hits and misses so far, and the baby's wake.
  // They count one walk: a new `SequenceStarted` starts them afresh (a second walk in one level, a
  // retry), so a spec never reads the last one's numbers.
  const mirrorBeatEvent = (event: SimEvent): void => {
    if (event.type === 'SequenceStarted') {
      beatHitCount = 0;
      beatMissCount = 0;
      delete document.documentElement.dataset.ppBeatHits;
      delete document.documentElement.dataset.ppBeatMisses;
      delete document.documentElement.dataset.ppBabyWake;
    } else if (event.type === 'BeatHit') {
      beatHitCount += 1;
      mirror('ppBeatHits', String(beatHitCount));
    } else if (event.type === 'BeatMissed') {
      beatMissCount += 1;
      mirror('ppBeatMisses', String(beatMissCount));
    } else if (event.type === 'BabyStirred') {
      mirror('ppBabyWake', String(event.wakePct));
    }
  };
  // The suspicious silence, on its events only (story 1.21): `on` at `SilenceStarted`, then `found`
  // or `timedOut`; and where the baby is on the page then, in px, for a Playwright tap on him.
  // Fatherly Instinct (story 2.9), on its events only: `on` at `InstinctTriggered`, then the reason
  // (`timer` or `levelEnded`) of `InstinctEnded`.
  const mirrorInstinctEvent = (event: SimEvent): void => {
    if (event.type === 'InstinctTriggered') mirror('ppInstinct', 'on');
    else if (event.type === 'InstinctEnded') mirror('ppInstinct', event.reason);
  };
  const mirrorSilenceEvent = (event: SimEvent): void => {
    if (event.type === 'SilenceEnded') {
      mirror('ppSilence', event.reason);
      return;
    }
    if (event.type !== 'SilenceStarted') return;
    mirror('ppSilence', 'on');
    const active = levelSession.active;
    if (active === null) return;
    const { baby } = active.sim.world;
    const rect = canvas.getBoundingClientRect();
    iconPoint.set(baby.xM, startFeel().baby.bodyRadiusM, baby.zM).project(camera);
    const x = rect.left + ((iconPoint.x + 1) / 2) * rect.width;
    const y = rect.top + ((1 - iconPoint.y) / 2) * rect.height;
    mirror('ppBabyPx', `${x.toFixed(1)},${y.toFixed(1)}`);
  };
  // The phone, on its events only: ringing, then answered or timedOut (never per frame).
  const mirrorPhoneEvent = (event: SimEvent): void => {
    if (event.type === 'PhoneRingStarted') mirror('ppPhone', 'ringing');
    else if (event.type === 'PhoneRingEnded') mirror('ppPhone', event.reason);
  };
  // The threats, on their events only: the state of the threat, where its icon is on the page
  // (CSS px, for a test to tap), the last response and the last gag.
  const iconPoint = new Vector3();
  const mirrorThreatEvent = (event: SimEvent): void => {
    switch (event.type) {
      case 'ThreatTelegraphed': {
        mirror('ppThreat', `${event.threatId}:telegraph`);
        const entry = worldUi.threatEntries.find(
          (candidate) => candidate.threatId === event.threatId,
        );
        if (entry !== undefined) {
          const rect = canvas.getBoundingClientRect();
          iconPoint.set(entry.xM, entry.yM, entry.zM).project(camera);
          const x = rect.left + ((iconPoint.x + 1) / 2) * rect.width;
          const y = rect.top + ((1 - iconPoint.y) / 2) * rect.height;
          mirror('ppThreatPx', `${x.toFixed(1)},${y.toFixed(1)}`);
        } else {
          // No icon for this threat: a point left by a previous one must not be tapped.
          document.documentElement.removeAttribute('data-pp-threat-px');
        }
        return;
      }
      case 'WindowOpened':
        mirror('ppThreat', `${event.threatId}:windowOpen`);
        return;
      case 'ResponseResolved':
        mirror('ppThreat', `${event.threatId}:${event.quality === 'fail' ? 'gag' : 'resolved'}`);
        mirror('ppResponse', event.quality);
        return;
      case 'GagTriggered':
        mirror('ppGag', event.gag);
        return;
      case 'ThreatRearmed':
      case 'ThreatCancelled':
        mirror('ppThreat', `${event.threatId}:idle`);
        return;
      default:
        return;
    }
  };

  // The one chip beside the targeted threat's icon: the key or the button that parries it. Finds the
  // icon by index (`world.threats[i]` is `worldUi.threatEntries[i]`), allocates nothing.
  const showGlyphChip = (
    world: Readonly<{ threats: readonly Readonly<{ id: number }>[] }> | undefined,
    targetedId: number | null,
    device: 'pointer' | 'keyboard' | 'gamepad' | null,
  ): void => {
    if (
      world === undefined ||
      targetedId === null ||
      (device !== 'keyboard' && device !== 'gamepad')
    ) {
      worldUi.glyphChip.hide();
      return;
    }
    const family = inputMapper.padFamily;
    if (device !== chipDevice || family !== chipFamily || keyboardLayoutMap !== chipMap) {
      chipDevice = device;
      chipFamily = family;
      chipMap = keyboardLayoutMap;
      chipText =
        device === 'keyboard'
          ? keyGlyph('Space', keyboardLayoutMap, t)
          : padConfirmGlyph(family, t);
    }
    const entries = worldUi.threatEntries;
    for (let i = 0; i < world.threats.length; i++) {
      if ((world.threats[i] as { id: number }).id !== targetedId) continue;
      const entry = entries[i];
      if (entry !== undefined && entry.threatId === targetedId) {
        worldUi.glyphChip.showAt(entry, chipText);
        return;
      }
      break;
    }
    worldUi.glyphChip.hide();
  };

  // What the debug modules hang on (see `TestHost`); empty, and so free, unless one is installed.
  let stepHook: ((sim: Sim) => void) | null = null;
  const levelStartedListeners: ((started: StartedLevel) => void)[] = [];
  const simEventListeners: ((event: SimEvent) => void)[] = [];
  const renderedFrameListeners: ((frameAtReal: number, stats: Readonly<RenderStats>) => void)[] =
    [];
  // The adaptive pixel ratio (story 1.24): fed in every build, with the real interval between two
  // level frames. A level start and a resume start a clean window (`resetFramePacing`).
  const pixelPacing = createAdaptivePixelRatio(window.devicePixelRatio);
  let previousLevelFrameAtReal = -1;
  const resetFramePacing = (): void => {
    previousLevelFrameAtReal = -1;
    pixelPacing.resetWindow();
  };
  events.on('GameResumed', resetFramePacing);
  document.addEventListener('visibilitychange', resetFramePacing);
  let isGameInputBlocked = false;
  let hasLoggedSilentStart = false;
  // Mama's note of the level that ended (story 1.22), and whether its Result sequence has started: a
  // screen rebuilt after the portrait overlay, whatever phase it was in, then shows its end at once.
  // Both cleared when a level loads.
  let resultScore: MamaScore | null = null;
  // Why it ended (story 3.2): a woken Mama puts a header on the Result screen. Cleared with the note.
  let resultEndReason: LevelEndReason = 'timer';
  let hasResultStarted = false;
  // The action behind « Copier le journal » (story 3.3): set at boot by the debug block, in
  // playtest builds only, and read when the Result screen is built.
  let playtestCopyLog: (() => Promise<CopyLogOutcome>) | null = null;

  // Tells a sim how far the inputs it will receive were corrected into the past (story 2.7 D1), so
  // that it waits that long before it decides what no command has said. Only for a positive lag at a
  // level's start (a new sim starts at 0, and a player who did not calibrate sends nothing, so
  // goldens, bots and journals gain no entry); a recalibration re-sends it whatever it is. An
  // autoplay bot's commands never pass through the mapper: its sim is never told.
  const sendInputLag = (sim: Sim, isRecalibration: boolean): void => {
    if (isAutoplaying) return;
    const lagMs = Math.max(0, visualOffsetMs());
    if (lagMs <= 0 && !isRecalibration) return;
    sim.enqueue({ type: 'SetInputLag', t: sim.world.time.sim, lagMs });
  };

  // Tells a sim the player's difficulty tier (story 2.8, D1), at a level's start only: a game under
  // way never changes, and a restart or the next game reads the save again, which is what « Appliqué
  // à la prochaine partie » means. Nothing at `normal` (a new sim starts there), so goldens, bots and
  // journals gain no entry. `?autoplay` ignores the player's save, as it does for the lag (D5).
  const sendDifficultyTier = (sim: Sim): void => {
    if (isAutoplaying) return;
    const { tier } = saveStore.current().settings;
    if (tier === DEFAULT_DIFFICULTY_TIER) return;
    sim.enqueue({ type: 'SetDifficultyTier', t: sim.world.time.sim, tier });
  };

  // Fills `beatFrame` from the world and the loop: the running `beats` step's timeline and track, or
  // none. The notes lead by `audioOffsetMs − visualOffsetMs` (D1): the inputs keep `visualOffsetMs`
  // alone, in the mapper, so the latency is corrected once.
  const updateBeatFrame = (world: Sim['world'] | undefined, frameAtReal: number): void => {
    beatFrame.timeline = null;
    beatFrame.track = null;
    if (world === undefined || !world.sequence.beat.isRunning || world.sequence.id === null) return;
    const step = currentSequences?.[world.sequence.id]?.steps[world.sequence.stepIndex];
    if (step === undefined || step.kind !== 'beats') return;
    const track = feedbackTable.beatTracks[step.track];
    const timeline = currentBeatTimelines[world.sequence.id]?.[world.sequence.stepIndex] ?? null;
    if (track === undefined || timeline === null) return;
    const clock = levelSession.loopClock;
    const calibration = saveStore.current().calibration;
    beatFrame.timeline = timeline;
    beatFrame.track = track;
    beatFrame.stepStartAt = world.sequence.stepEndsAt - step.durationMs;
    beatFrame.cueIndex = world.sequence.beat.cueIndex;
    beatFrame.clockMs = clock.clockMs;
    beatFrame.simPerRealMs = clock.simPerRealMs;
    beatFrame.leadMs = beatLeadMs(calibration);
    // The loop recorded `clockMs` at the frame's timestamp; the audio clock is read now, after the
    // steps and the draw. Both are on `performance.now()`'s timeline, so the age is their difference
    // (bounded: a timestamp far from it is not a skew to correct but a clock to distrust).
    beatFrame.clockAgeMs = Math.min(
      BEAT_CLOCK_AGE_MAX_MS,
      Math.max(0, performance.now() - frameAtReal),
    );
  };
  // The level is made later; the screens below only need it when a button is pressed.
  const levelSession = createLevelSession({
    content: content.value,
    t,
    appFsm,
    pause,
    renderer,
    camera,
    // `?seed=<n>` fixes the seed of every level of the page, restarts included.
    newSeed: () => params.seed ?? (crypto.getRandomValues(new Uint32Array(1))[0] as number),
    speed: params.speed ?? undefined,
    beforeStep: isMirrored ? (sim) => stepHook?.(sim) : undefined,
    onLevelStarted: (started) => {
      sendInputLag(started.sim, false);
      sendDifficultyTier(started.sim);
      currentSequences = started.level.sequences;
      currentBeatTimelines = Object.fromEntries(
        Object.entries(started.level.sequences).map(([id, def]) => [
          id,
          def.steps.map((step) => (step.kind === 'beats' ? beatTimelineOf(step) : null)),
        ]),
      );
      beatScheduler.reset();
      sequenceBar.reset();
      timerHud.setCompact(false);
      timerHud.setVariant(started.level.level.variant);
      // The gauges this level has, each at its start value (a restart never shows the last level's).
      const { gauges } = started.level.level;
      gaugesHud.setGauges(GAUGE_IDS.filter((id) => id in gauges));
      if (gauges.noise !== undefined) {
        gaugesHud.setValue('noise', Math.round(started.sim.world.gauges.noisePct));
      }
      if (gauges.fatigue !== undefined) {
        gaugesHud.setValue('fatigue', Math.round(started.sim.world.gauges.fatigue));
      }
      if (gauges.need !== undefined) {
        gaugesHud.setValue('need', Math.round(started.sim.world.gauges.bladderPct));
      }
      worldUi.mountObjects(started.sim.objects);
      // The full duration at once, so a restart never shows the last level's `0:00`.
      hudBatch.set(TIMER_SLOT, Math.ceil(started.level.level.durationMs / MS_PER_S));
      resetFramePacing();
      for (const listener of levelStartedListeners) listener(started);
    },
    onSeed: (seed) => {
      if (isMirrored) document.documentElement.dataset.ppSeed = String(seed);
    },
    onLevelReady: (level, threatEntries) => {
      // The room is only known now: fit the camera and show it behind the loading screen.
      currentLevel = level;
      debugGroup = null; // the previous scene (and so its group) is gone
      worldUi.mountThreats(threatEntries);
      highlightedThreatId = null;
      choreography.reset();
      room = level.room;
      isStatsMirrored = false;
      fitViewToCanvas();
      if (isMirrored) mirror('ppLevel', level.id);
    },
    beforeRender: (alpha) => {
      // Before the draw (`onLevelFrame` runs after it): the camera of a perfect, on the sim clock as
      // drawn, so the hitstop holds it back and a pause holds it (story 2.5).
      const world = levelSession.active?.sim.world;
      if (world === undefined) return;
      const clockMs = world.time.sim - STEP_MS * (1 - alpha);
      // The special sequence's framing (story 4.4): the world's slice and the sim clock only.
      const { sequence } = world;
      const framingDef =
        sequence.lastId === null || currentSequences === null
          ? undefined
          : currentSequences[sequence.lastId];
      if (framingDef === undefined) {
        sequenceFraming.blend = 0;
      } else {
        const { camera: framingCamera } = framingDef.framing;
        sequenceFraming.blend = sequenceFramingBlendAt(
          sequence.startedAt,
          sequence.endedAt,
          clockMs,
          framingCamera.inMs,
          framingCamera.outMs,
        );
        sequenceFraming.zoomPct = framingCamera.zoomPct;
        sequenceFraming.focusPct = framingCamera.focusPct;
        sequenceFraming.xM = world.papa.xM;
        sequenceFraming.zM = world.papa.zM;
      }
      cameraFx.update(
        world,
        clockMs,
        world.feel.fx.perfectCamera,
        prefersReducedMotion(),
        sequenceFraming,
      );
    },
    onFxReset: () => {
      cameraFx.reset();
      epicStamp.cancel();
      // The loop stopped: no further frame would turn the vignette off (a restart, a crash recovery).
      instinctVignette.update(false);
    },
    onLevelFrame: (alpha, frameAtReal) => {
      // The baby's babble loops while the sim says it babbles: an edge-triggered boolean per frame.
      // Once the level has ended the sim is frozen with `babbling` as it was: silence it.
      const babbleWorld = levelSession.active?.sim.world;
      audio.setBabbling(
        babbleWorld !== undefined && isFlowLive(babbleWorld) && babbleWorld.baby.babbling,
      );
      // The suspicious silence (story 1.21): the music stays off, and the « … » bubble stays up,
      // while the sim says a silence has started. State, not events, so that a pause, a restart or
      // the end of the level can never leave the music off. The bubble also waits for a running
      // game: a pause veil or a countdown has the screen.
      const isSilent =
        babbleWorld !== undefined &&
        isFlowLive(babbleWorld) &&
        babbleWorld.silence.startedAt !== null;
      // A special sequence with its own music (story 4.4) replaces the level stems for as long as it
      // runs: state, not events, so a restart or a level end cannot leave either on.
      const sequenceMusicId =
        babbleWorld !== undefined && babbleWorld.flow.state === 'sequence'
          ? (currentSequences?.[babbleWorld.sequence.id ?? '']?.framing.musicLoop ?? null)
          : null;
      audio.setSequenceMusic(sequenceMusicId);
      audio.setMusicMuted(isSilent || isSequenceMusicOn);
      // The notes of a rhythm step (story 4.5), planned on the audio clock from the loop's continuous
      // clock: state, every frame, so a pause, a slow-mo, a restart or a level end needs no code.
      const beatWorld = levelSession.active?.sim.world;
      updateBeatFrame(beatWorld, frameAtReal);
      beatScheduler.update(beatFrame);
      if (beatSampleListeners.length > 0 && beatFrame.timeline !== null) {
        const nowS = audio.currentTimeS;
        if (nowS !== null) {
          // The audio time of the instant `clockMs` belongs to: a pair read together, or the check is circular.
          beatSample.audioNowS = nowS - beatFrame.clockAgeMs / 1000;
          beatSample.clockMs = beatFrame.clockMs;
          for (const listener of beatSampleListeners) listener(beatSample);
        }
      }
      // The music follows the world's state too (story 2.6): tense while a threat is on, slowed
      // while the time scale is down. Allocation-free: a loop over a handful of threats.
      const isPlaying = babbleWorld !== undefined && isFlowLive(babbleWorld);
      audio.setMusicMood(
        isPlaying && isTensionActive(babbleWorld.threats),
        isPlaying && isSlowMoActive(babbleWorld, levelFeel().music.slowMo.belowScale),
      );
      silenceBubble.update(isSilent && pause.state === 'running', babbleWorld);
      // Fatherly Instinct's vignette follows the state too (story 2.9), never the events: a pause, a
      // restart or the end of the level can never leave it on.
      instinctVignette.update(
        isPlaying && babbleWorld.instinct.state === 'active' && pause.state === 'running',
      );
      // The timer counts sim time, rounded up to the second (`0:00` exactly when the level ends);
      // `hudBatch` writes the DOM only when the second changes. Before `shell.frame()` flushes it.
      const running = levelSession.active;
      if (running !== null) {
        const remainingMs = Math.max(
          0,
          running.level.level.durationMs - running.sim.world.time.sim,
        );
        hudBatch.set(TIMER_SLOT, Math.ceil(remainingMs / MS_PER_S));
        // Noise, fatigue and need in whole percent: the batch writes each when its integer changes.
        if (running.level.level.gauges.noise !== undefined) {
          hudBatch.set(gaugeSlotOf('noise'), Math.round(running.sim.world.gauges.noisePct));
        }
        if (running.level.level.gauges.fatigue !== undefined) {
          hudBatch.set(gaugeSlotOf('fatigue'), Math.round(running.sim.world.gauges.fatigue));
        }
        if (running.level.level.gauges.need !== undefined) {
          hudBatch.set(gaugeSlotOf('need'), Math.round(running.sim.world.gauges.bladderPct));
        }
      }
      // The sequence bar and the compact timer follow the world's state each frame (story 4.4).
      if (running !== null) {
        const barDef =
          currentSequences?.[
            running.sim.world.sequence.id ?? running.sim.world.sequence.lastId ?? ''
          ] ?? null;
        hudBatch.set(SEQUENCE_SLOT, sequenceBar.update(running.sim.world, barDef));
        sequenceBar.frame(performance.now());
        timerHud.setCompact(sequenceBar.isMounted);
      }
      shell.frame();
      gaugesHud.frame(performance.now());
      inputMapper.pollGamepad();
      const world = levelSession.active?.sim.world;
      // The auto-target shows for the keyboard and the gamepad only, never after a touch or a click
      // (D8); `targetedThreatId` is null when no level is live (paused, autoplay, countdown).
      const device = inputMapper.lastDevice;
      const targetedId =
        device === 'keyboard' || device === 'gamepad' ? inputMapper.targetedThreatId() : null;
      const isHighlightShown =
        world !== undefined &&
        worldUi.updateThreats(
          world.threats,
          highlightedThreatId,
          targetedId,
          currentLevel?.papaPose ?? null,
          // The sim time as drawn (the views interpolate from the previous step by `alpha`): the
          // hold-ring fills against it, so a slow-mo or a hitstop slows it as it slows the judgement.
          world.time.sim - STEP_MS * (1 - alpha),
          levelSession.active?.sim.world.feel.input.holdMinMs ?? 0,
          world.baby.state === 'carried',
        );
      // One state per kind of object (story 4.3): the coffee follows the fatigue, the door the need.
      worldUi.updateObjects(
        world?.gauges.isFatigueAbove ?? false,
        world !== undefined && world.gauges.bladderPct >= world.feel.bladder.urgentFromPct,
        world?.papa.state === 'onToilet',
      );
      if (world !== undefined) {
        // Papa has no pose while he is out of the room: the badge and the hint hide with him.
        const papaPose = world.papa.state === 'onToilet' ? null : (currentLevel?.papaPose ?? null);
        const nowAtReal = performance.now();
        worldUi.updateCombo(
          world.combo,
          world.feel.combo.minMultiplier,
          papaPose,
          world.threats,
          nowAtReal,
        );
        worldUi.updatePapaHint(papaPose, nowAtReal);
        worldUi.updateBeatRing(
          beatFrame.timeline,
          beatFrame.stepStartAt,
          beatFrame.clockMs,
          feedbackTable.beatRing.approachMs,
          papaPose,
        );
      }
      showGlyphChip(world, targetedId, device);
      if (isMirrored) mirror('ppTarget', targetedId === null ? 'none' : String(targetedId));
      worldUi.render(camera);
      if (isHighlightShown && isMirrored) {
        performance.clearMarks('highlightRendered');
        performance.mark('highlightRendered');
      }
      // The highlight is drawn once at least; it goes when its threat is no longer active
      // (resolved, or gag). A quick tap resolves the threat in the very frame that draws it.
      if (world !== undefined && highlightedThreatId !== null) {
        let isActive = false;
        for (const threat of world.threats) {
          if (threat.id === highlightedThreatId) {
            isActive = threat.state === 'telegraph' || threat.state === 'windowOpen';
            break;
          }
        }
        if (!isActive) highlightedThreatId = null;
      }
      if (isMirrored && !isStatsMirrored) {
        isStatsMirrored = true;
        const { drawCalls, triangles, geometries, textures } = renderer.stats();
        mirror('ppDrawCalls', String(drawCalls));
        mirror('ppTriangles', String(triangles));
        mirror('ppGeometries', String(geometries));
        mirror('ppTextures', String(textures));
        mirror('ppPixelRatio', String(renderer.stats().pixelRatio));
      }
      // Last, after the level and the world UI are drawn: the display frame's timestamp, for the
      // adaptive pixel ratio and for the debug meters. No allocation: an indexed loop, no closure.
      // Only a running game is measured: a pause, its countdown and a hidden tab are not frames of
      // play. A repeated timestamp is an `advance` render, not a frame.
      if (pause.state !== 'running' || frameAtReal <= previousLevelFrameAtReal) {
        if (pause.state !== 'running') resetFramePacing();
        return;
      }
      if (previousLevelFrameAtReal >= 0) {
        const fromCap = pixelPacing.cap;
        const toCap = pixelPacing.frame(frameAtReal - previousLevelFrameAtReal);
        if (toCap !== fromCap) {
          try {
            renderer.setPixelRatioCap(toCap);
            log.info('render', 'pixel ratio stepped down', {
              fromCap,
              toCap,
              meanFrameMs: Math.round(pixelPacing.lastWindowMeanMs * 10) / 10,
            });
            if (isMirrored) mirror('ppPixelRatio', String(renderer.stats().pixelRatio));
          } catch (cause) {
            log.warn('render', 'cannot lower the pixel ratio', { toCap, error: cause });
          }
        }
      }
      previousLevelFrameAtReal = frameAtReal;
      if (renderedFrameListeners.length > 0) {
        const stats = renderer.stats();
        for (let i = 0; i < renderedFrameListeners.length; i++) {
          try {
            renderedFrameListeners[i]?.(frameAtReal, stats);
          } catch (cause) {
            // A debug listener must never stop the game loop (fail-stop): drop it, say so once.
            log.warn('debug', 'a rendered-frame listener threw and was removed', { error: cause });
            renderedFrameListeners.splice(i--, 1);
          }
        }
      }
    },
    loadLevelContent: async (id) => {
      const loaded = await loadLevelContent(contentSource, id);
      if (!stripThreats || !loaded.ok) return loaded;
      return ok(withoutThreats(loaded.value));
    },
    loadAudio: () => {
      // A level started with no gesture (autoplay, `__PP__.loadLevel` from the start screen) has
      // no audio context: the game is silent, which is the expected run of an agent, not a warning.
      if (isMirrored && audio.state === 'none') {
        if (!hasLoggedSilentStart) {
          hasLoggedSilentStart = true;
          log.info('audio', 'no start gesture: the game is silent');
        }
        return Promise.resolve();
      }
      return audio.preload(feedbackClips(feedbackTable));
    },
    onSimEvent: (event) => {
      logSimEvent(event);
      const active = levelSession.active;
      // The sounds fire in this very call: judgement, not arrival (story 2.3 D5).
      playSimEventFeedback(event, active, director);
      if (active !== null) {
        // A perfect: the camera leans toward the threat that was just parried (state of the slow-mo).
        if (event.type === 'ResponseResolved' && event.quality === 'perfect') {
          const resolved = active.sim.world.threats.find((one) => one.id === event.threatId);
          if (resolved !== undefined) cameraFx.focusOn(resolved.xM, resolved.zM);
        }
        if (currentLevel !== null) {
          // Reduced motion: no hop of the baby, no snap of Papa's hair (the lights carry the gag).
          const isMotionReduced = prefersReducedMotion();
          choreography.onEvent(
            event,
            active.sim.world,
            isMotionReduced ? noLiftFx : currentLevel.fx,
          );
          if (event.type === 'GagTriggered') {
            const { world } = active.sim;
            const threat = world.threats.find((candidate) => candidate.id === event.threatId);
            // The stairs slide: from the threat's anchor to the baby (D6 of story 1.16).
            if (threat === undefined) {
              // Never a stale direction from the previous gag: with no anchor, the baby is "on" it.
              log.warn('render', 'GagTriggered for a threat the world does not have', event);
            }
            slideDirection(
              threat?.xM ?? world.baby.xM,
              threat?.zM ?? world.baby.zM,
              world.baby.xM,
              world.baby.zM,
              world.baby.gazeX,
              world.baby.gazeZ,
              slideDir,
            );
            currentLevel.fx.gag(event.gag, event.t, isMotionReduced, slideDir.x, slideDir.z);
          }
        }
      }
      // The noise crossed the alert threshold upwards (story 3.1 D10): the haptic cue and its visual
      // twin, the shake of the gauge. A client feedback event, like the star stamps.
      if (isNoiseAlertCrossing(event, levelFeel().noise.alertPct)) {
        director.handle('NoiseAlertReached', null);
        gaugesHud.alert('noise');
      }
      // Fatherly Instinct started (story 2.9 D4): the heartbeat and its vibration. The vignette is a UI
      // element drawn from the state, so the cue goes through a client event like the noise alert.
      if (event.type === 'InstinctTriggered') director.handle('InstinctVignetteShown', null);
      if (isMirrored) {
        if (event.type === 'NoiseChanged') mirrorNoise();
        if (
          event.type === 'BladderFilled' ||
          event.type === 'ToiletStarted' ||
          event.type === 'ToiletFinished'
        ) {
          mirrorBladder();
        }
        if (event.type === 'LevelEnded') {
          mirror('ppFlow', 'ended');
          mirror('ppEndReason', event.reason);
        }
        mirrorPapaEvent(event);
        mirrorBabyEvent(event);
        mirrorComboEvent(event);
        mirrorThreatEvent(event);
        mirrorPhoneEvent(event);
        mirrorSilenceEvent(event);
        mirrorInstinctEvent(event);
        mirrorSequenceEvent(event);
        mirrorBeatEvent(event);
      }
      // A refused toilet says why above Papa, for `holdMs` of real time (story 4.3).
      if (event.type === 'ToiletRefused') {
        worldUi.papaHint.show(feedbackTable.papaHint.holdMs, performance.now());
      }
      // It has said its piece once the baby is down or Papa is in.
      if (event.type === 'BabyPutDown' || event.type === 'ToiletStarted') {
        worldUi.papaHint.hide();
      }
      // The points of a cash-in show on the badge for `cashInHoldMs` of real time (story 4.2, D6).
      if (event.type === 'ComboCashedIn') {
        worldUi.comboBadge.showCashIn(
          event.points,
          feedbackTable.comboBadge.cashInHoldMs,
          performance.now(),
        );
      }
      // A key still held after a tap's path ends walks again, and so after a coffee or a nap.
      if (event.type === 'PapaArrived') inputMapper.resumeHeld();
      // Taking or putting down the baby stops Papa where he stands (`walkDir` → idle): a direction
      // still held walks again, with the baby in his arms or without.
      if (event.type === 'BabyPickedUp' || event.type === 'BabyPutDown') inputMapper.resumeHeld();
      // A key still held through a special sequence walks again at its end (story 4.4); a failure then
      // waits for the nap, through the `PapaStateChanged` call just below.
      if (event.type === 'SequenceEnded') {
        inputMapper.resumeHeld();
        // The baby woke: the calm bar slides out empty, not on the value of the frame before.
        if (event.outcome === 'failed') sequenceBar.markFailed();
      }
      if (
        event.type === 'PapaStateChanged' &&
        event.to === 'idle' &&
        isPapaBusy({ state: event.from })
      ) {
        inputMapper.resumeHeld();
      }
      if (
        isMirrored &&
        (event.type === 'FatigueThresholdCrossed' ||
          event.type === 'CoffeeDrunk' ||
          event.type === 'PhoneAnswered')
      ) {
        mirrorFatigue();
      }
      // The debug modules last: they see the event after the app has handled it.
      for (let i = 0; i < simEventListeners.length; i++) simEventListeners[i]?.(event);
      if (event.type === 'LevelEnded') resultEndReason = event.reason;
      // Mama's note ends the level (story 1.22): the loop stops on the frozen room, which stays
      // drawn behind the Result screen; the world stays readable until the next start.
      if (event.type === 'LevelScored') {
        const { type: _type, t: _t, ...score } = event;
        resultScore = score;
        hasResultStarted = false;
        if (isMirrored) {
          mirror('ppScore', String(score.scorePoints));
          mirror('ppStars', String(score.stars));
          mirror('ppLostStars', String(score.lostStars));
        }
        levelSession.finish();
        appFsm.enter('result');
        drawStatic();
      }
    },
    canResumeNow: () => !shell.isPortrait && document.visibilityState !== 'hidden',
    waitForForeground: () => waitForForeground(document),
  });
  // An error nobody caught, while a level is loading or running: stop it and offer to start again.
  // From any other state (boot, start, result, oops) it is only logged.
  recoverFromUncaught = () => {
    const state = appFsm.state;
    // The settings and the credits sit over a live level; so does a recalibration started from them
    // (the first launch's calibration has no level, and stays outside, as 2.7 wants).
    const isOverLevel =
      state === 'settings' ||
      state === 'credits' ||
      (state === 'calibration' && levelSession.active !== null);
    if (state !== 'loading' && state !== 'level' && !isOverLevel) return;
    levelSession.stop();
    appFsm.enter('oops');
  };

  const timerHud = createTimerHud(document, { t });
  const sequenceBar = createSequenceBar(document, {
    t,
    slideMs: feedbackTable.sequenceBar.slideMs,
  });
  const gaugesHud = createGaugesHud(document, { t, nowAtReal: () => performance.now() });
  // Slot 0 is the timer's; then one per gauge in `GAUGE_IDS` order, matching `gaugeSlotOf`.
  const hudBatch = createHudBatch([
    (seconds) => timerHud.setRemainingS(seconds),
    ...GAUGE_IDS.map((id) => (percent: number) => gaugesHud.setValue(id, percent)),
    (percent) => sequenceBar.setPercent(percent),
  ]);
  // The silence bubble is screen-anchored, in the HUD root beside the row (UX `silence-bubble`).
  const bubblePoint = new Vector3();
  const silenceBubble = createSilenceBubble(document, {
    t,
    project: (xM, yM, zM, out) => {
      if (room === null) return false;
      const rect = canvas.getBoundingClientRect();
      const hudRect = hudRoot.getBoundingClientRect();
      bubblePoint.set(xM, yM, zM).project(camera);
      out.x = rect.left + ((bubblePoint.x + 1) / 2) * rect.width - hudRect.left;
      out.y = rect.top + ((1 - bubblePoint.y) / 2) * rect.height - hudRect.top;
      return true;
    },
    viewport: () => ({ width: hudRoot.clientWidth, height: hudRoot.clientHeight }),
    targetHeightM: () => startFeel().baby.bodyRadiusM,
    hudBottomPx: () => hudRoot.querySelector('.pp-hud-row')?.getBoundingClientRect().bottom ?? 0,
  });
  window.addEventListener('resize', () => silenceBubble.relayout());
  const hud = createHudLayer(hudRoot, {
    t,
    onPausePress: () => pause.requestPause('user'),
    gauges: gaugesHud.element,
    timer: timerHud.element,
    sequenceBar,
  });
  hudRoot.append(silenceBubble.element);
  // Right before `#pp-world` (z-index 4 against its 5): it darkens the room, not the verbs and the icons.
  const instinctVignette = createInstinctVignette(document);
  worldRoot.before(instinctVignette.element);
  // The latency calibration (story 2.7): the first launch's detour, and what story 2.8's Recalibrate
  // row will call. The flow outlives the screen, which the portrait overlay rebuilds.
  const calibrationFlow = createCalibrationFlow({
    appFsm,
    events,
    t,
    getFeel: () => content.value.feel.calibration,
    beep: feedbackTable.calibration.beep,
    audio,
    saveStore,
    device: `${platform.capabilities.target}-${platform.capabilities.touch ? 'touch' : 'desktop'}`,
    // The wall clock, for the save only: it names a moment in the player's life, not in a game.
    nowIso: () => new Date().toISOString(),
    frames: {
      request: (run) => requestAnimationFrame(run),
      cancel: (handle) => cancelAnimationFrame(handle),
    },
    nowAtReal: () => performance.now(),
    target: window,
    page: document,
    isMotionReduced: prefersReducedMotion,
    startLevel: () => void levelSession.start(),
    onPhase: (phase) => {
      if (isMirrored) mirror('ppCalibration', phase);
    },
    onBeat: (count) => {
      if (isMirrored) mirror('ppCalibrationBeats', String(count));
    },
  });
  // A recalibration while a level is on: its sim must wait for the new lag from the next step.
  events.on('CalibrationDone', () => {
    const active = levelSession.active;
    if (active !== null) sendInputLag(active.sim, true);
  });
  events.on('AppStateChanged', ({ from }) => {
    if (from !== 'calibration' || !isMirrored) return;
    delete document.documentElement.dataset.ppCalibration;
    delete document.documentElement.dataset.ppCalibrationBeats;
  });
  const overlayHost = createOverlayHost(uiRoot, {
    start: () =>
      createStartScreen({
        t,
        target: window,
        onStart: () => {
          // Synchronous, inside the gesture, before anything else and with no await in front: iOS
          // only unlocks audio there.
          audio.unlock();
          events.emit('StartGestureReceived', {});
          // A new device calibrates once, then goes straight to Age 1; a calibrated one loads at once.
          if (saveStore.current().calibration === null)
            calibrationFlow.startRecalibration('loading');
          else void levelSession.start();
        },
      }),
    pause: (mode) =>
      createPauseScreen({
        t,
        events,
        mode,
        onResume: () => pause.requestResume(),
        onRestart: () => void levelSession.start(),
        onSettings: () => appFsm.enter('settings'),
      }),
    portrait: () => createPortraitOverlay({ t }),
    loading: () => createLoadingScreen({ t }),
    calibration: () => calibrationFlow.createScreen(),
    // Rebuilt from the save after the portrait overlay: the screen holds no state of its own.
    settings: () =>
      createSettingsScreen({
        t,
        settings: saveStore.current().settings,
        hasHaptics: platform.capabilities.haptics,
        isDeviceMotionReduced: accessibility.isDeviceMotionReduced,
        onChange: (settings) => {
          // In memory at once, the write settles on its own and warns once on failure. No `log` per
          // slider tick.
          void saveStore.setSettings(settings);
          events.emit('SettingsChanged', { settings });
        },
        onRecalibrate: () => calibrationFlow.startRecalibration('settings'),
        onCredits: () => appFsm.enter('credits'),
        // The only entry today is the pause panel; the Fridge (story 3.11) adds its own.
        onBack: () => {
          if (appFsm.state === 'settings') appFsm.enter('level');
        },
      }),
    credits: () =>
      createCreditsScreen({
        t,
        onBack: () => {
          if (appFsm.state === 'credits') appFsm.enter('settings');
        },
      }),
    oops: () => createOopsScreen({ t, onRetry: () => void levelSession.start() }),
    result: () => {
      if (resultScore === null) {
        // `LevelScored` stores it before the app enters `result`: this is a bug, not a game.
        log.warn('boot', 'the Result screen has no note to show: showing an empty one');
      }
      const { mama } = levelFeel();
      return createResultScreen({
        t,
        score: resultScore ?? NO_SCORE,
        endReason: resultEndReason,
        maxima: mama,
        timings: feedbackTable.resultScreen,
        // Rebuilt after the portrait overlay: the stars do not stamp (nor sound) twice.
        isDone: hasResultStarted,
        scheduler: {
          schedule: (run, delayMs) => window.setTimeout(run, delayMs),
          cancel: (handle) => window.clearTimeout(handle),
        },
        now: () => performance.now(),
        keyTarget: window,
        onStar: (isLast) =>
          director.handle(isLast ? 'ResultLastStarStamped' : 'ResultStarStamped', null),
        // The header of a woken Mama and the star she took off have their own cues (story 3.2 D4, D5).
        onMamaWoke: () => director.handle('ResultMamaWokeShown', null),
        onStarLost: () => director.handle('ResultStarLost', null),
        onPhase: (phase) => {
          hasResultStarted = true;
          if (isMirrored) mirror('ppResult', phase);
        },
        // Same level, same feel, a new seed (`?seed=` keeps its own): through loading and the countdown.
        onReplay: () => void levelSession.start(),
        // Playtest builds only (story 3.3). The literal comparison is folded by Vite, so a store
        // build holds no `copyLog` here (story 1.24); the screen has its own gate besides.
        ...(import.meta.env.VITE_DEBUG_ALLOWED === 'true' && playtestCopyLog !== null
          ? { copyLog: playtestCopyLog }
          : {}),
      });
    },
  });
  const shell = createUiShell({ events, appFsm, pause, hud, hudBatch, overlayHost });
  shell.bindKeys(window);

  // The live feel (story 2.1): the sim's effective one, so a `SetFeel` reaches the hit test and the
  // hold ring on the next frame. `ActiveLevel.feel` is the feel at the start.
  const levelFeel = (): Feel => levelSession.active?.sim.world.feel ?? content.value.feel;
  // `baby.bodyRadiusM` is read when the level starts (the baby mesh, the nav grid and the threat
  // icons keep it), so everything drawn or hit-tested on the baby's body uses the start value too.
  const startFeel = (): Feel => levelSession.active?.feel ?? content.value.feel;

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
    // An autoplay bot owns the game: the player's taps, keys and stick reach the sim no more.
    getActive: () => (isGameInputBlocked ? null : levelSession.active),
    hitTester: createHitTester(camera),
    canvasRect: () => canvas.getBoundingClientRect(),
    held: heldKeys.held,
    gamepad: createGamepadInput(readGamepads),
    moveIntent: createMoveIntent({
      camera,
      // The feel of the level being played (its `feelOverrides` merged), the base one outside a level.
      get input() {
        return levelFeel().input;
      },
      send: (command) => {
        if (!isGameInputBlocked) levelSession.active?.sim.enqueue(command);
      },
    }),
    getThreatTargets: () => {
      const active = levelSession.active;
      if (active === null) return null;
      const targets: ThreatTargets = {
        threats: active.sim.world.threats,
        entries: worldUi.threatEntries,
      };
      return targets;
    },
    get touchRadiusPx() {
      return levelFeel().input.touchRadiusPx;
    },
    get objectTouchRadiusPx() {
      return levelFeel().input.objectTouchRadiusPx;
    },
    get babyBodyRadiusM() {
      return startFeel().baby.bodyRadiusM;
    },
    babyCarriedHeightM: BABY_CARRIED_HEIGHT_M,
    babyCarriedForwardM: BABY_CARRIED_FORWARD_M,
    get input() {
      return levelFeel().input;
    },
    getObjects: () => levelSession.active?.sim.objects ?? NO_OBJECTS,
    onPadButton: (button, atReal) => shell.handlePadButton(button, atReal),
    onPadPresence: (isPresent, family) => {
      log.info('input', isPresent ? 'gamepad connected' : 'gamepad gone', { family });
      if (isPresent) {
        shell.setPadDisconnected(false);
        return;
      }
      // Only a pad lost while playing pauses the game (D13): the panel then shows the line. The
      // pause is a no-op when the game is already paused for another reason. A pad the player is
      // not playing with (the last input was a key or a touch) may sleep or leave unnoticed.
      // The settings and the credits sit over the paused level: the line shows on the pause panel
      // when it comes back (the shell keeps the flag).
      const { state } = appFsm;
      if (state !== 'level' && state !== 'settings' && state !== 'credits') return;
      if (inputMapper.lastDevice !== 'gamepad') {
        log.info('input', 'an unused gamepad went away: no pause');
        return;
      }
      shell.setPadDisconnected(true);
      pause.requestPause('gamepadDisconnected');
    },
    onThreatPressed: (threatId) => {
      highlightedThreatId = threatId;
      if (isMirrored) {
        performance.clearMarks('press');
        performance.mark('press');
        mirror('ppPress', String(threatId));
      }
    },
    showTapMarker: (xM, zM) => worldUi.tapMarker.showAt(xM, zM),
    onTap: (xM, zM) => {
      if (isMirrored) mirror('ppTap', `${xM.toFixed(2)},${zM.toFixed(2)}`);
    },
    nowAtReal: () => performance.now(),
    visualOffsetMs,
  });
  bindPointer(
    canvas,
    window,
    (sample) => inputMapper.handlePointerDown(sample),
    (sample) => inputMapper.handlePointerUp(sample),
  );
  // A finger still on a threat when the game pauses is released at the sim clock.
  events.on('PauseRequested', () => inputMapper.releaseHeld());
  bindKeyboard(heldKeys, window, document, {
    onChange: (timeStampAtReal) => inputMapper.onKeysChanged(timeStampAtReal),
    isLive: () => inputMapper.isLive(),
    onAction: (phase, timeStampAtReal) =>
      inputMapper.handleAction(phase, timeStampAtReal, 'keyboard'),
  });
  // The names the browser gives the keys (Chromium only). Space is never in the map (D10), so the
  // chip says « Espace » until a letter key needs a name; one `warn` where it cannot be read.
  void loadKeyboardLayoutMap(navigator).then((loaded) => {
    if (loaded.ok) keyboardLayoutMap = loaded.value;
    else log.warn('input', loaded.error.message, loaded.error.cause);
  });
  // A pad plugged in or pulled out is seen by the next frame's poll; the events only ask for that
  // poll now. Nothing reads `event.gamepad`: the poll is the truth, and a second pad cannot pause.
  window.addEventListener('gamepadconnected', () => inputMapper.pollGamepad());
  window.addEventListener('gamepaddisconnected', () => inputMapper.pollGamepad());
  // Outside a level (start, « Oups », the Result screen) nothing else polls: a light frame loop
  // reads the pad so that A or Start can start the game, A can retry, skip the Result sequence or
  // replay. It runs only in those states and while a level loads.
  let menuPollHandle: number | null = null;
  const menuPoll = (): void => {
    inputMapper.pollGamepad();
    menuPollHandle = requestAnimationFrame(menuPoll);
  };
  events.on('AppStateChanged', ({ to }) => {
    // « loading » too: a button pressed or let go while the level loads is no new edge in its first frame.
    const wantsPoll =
      to === 'start' ||
      to === 'calibration' ||
      to === 'settings' ||
      to === 'credits' ||
      to === 'oops' ||
      to === 'loading' ||
      to === 'result';
    if (wantsPoll && menuPollHandle === null) {
      menuPollHandle = requestAnimationFrame(menuPoll);
    } else if (!wantsPoll && menuPollHandle !== null) {
      cancelAnimationFrame(menuPollHandle);
      menuPollHandle = null;
    }
  });
  events.on('GameResumed', () => inputMapper.resync());
  // A pad press is no browser user activation: a game started with A or Start can leave the audio
  // context suspended. The first key or touch while playing resumes it, and says so once.
  let isAudioRescueWarned = false;
  const rescueAudio = (): void => {
    if (audio.state !== 'suspended' || appFsm.state !== 'level' || pause.state !== 'running') {
      return;
    }
    if (!isAudioRescueWarned) {
      isAudioRescueWarned = true;
      log.warn('audio', 'audio is still suspended in play (a pad start): resuming on this gesture');
    }
    audio.resume();
  };
  window.addEventListener('pointerdown', rescueAudio, { passive: true });
  window.addEventListener('keydown', rescueAudio, { passive: true });
  // A restart or an error leaves the level: its threat icons must not stay up behind the next screen.
  // Not the settings detour (story 2.8): the level is alive under it, and its icons and labels would
  // never come back.
  events.on('AppStateChanged', ({ from, to }) => {
    const isLevelGone =
      (from === 'level' && !isSettingsDetour(from, to)) ||
      (to === 'oops' && (from === 'settings' || from === 'credits' || from === 'calibration'));
    if (!isLevelGone) return;
    worldUi.unmountThreats();
    worldUi.unmountObjects();
    worldUi.glyphChip.hide();
    worldUi.comboBadge.hide();
    worldUi.papaHint.hide();
    highlightedThreatId = null;
    // A pad lost in that level does not follow the player into the next one (the line is for the pause).
    shell.setPadDisconnected(false);
  });
  events.on('AppStateChanged', ({ to }) => {
    if (to !== 'loading') return;
    resultScore = null;
    resultEndReason = 'timer';
    hasResultStarted = false;
    // The previous game's note must not be read as the next one's while it loads (`mirrorNewLevel`
    // clears them only once the level has started).
    if (isMirrored) {
      for (const name of [
        'ppScore',
        'ppStars',
        'ppLostStars',
        'ppEndReason',
        'ppResult',
      ] as const) {
        delete document.documentElement.dataset[name];
      }
    }
  });
  events.on('AppStateChanged', ({ from, to }) => {
    // Back from the settings is no new level: `mirrorNewLevel` would reset the mirrors mid-game.
    if (to !== 'level' || isSettingsDetour(from, to)) return;
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

  // Debug builds only. The two modules are loaded by a literal dynamic import behind the flag, so a
  // store build ships neither them nor the bots.
  let isAutoplaying = false;
  let testHost: TestHost | null = null;
  if (import.meta.env.VITE_DEBUG_ALLOWED === 'true') {
    const subscribe = <T>(listeners: T[], listener: T): (() => void) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    };
    testHost = {
      content: content.value,
      levelSession,
      pauseState: () => pause.state,
      setStepHook: (hook) => {
        stepHook = hook;
      },
      onLevelStarted: (listener) => subscribe(levelStartedListeners, listener),
      onSimEvent: (listener) => subscribe(simEventListeners, listener),
      onCuePlayed: (listener) => subscribe(cuePlayedListeners, listener),
      onBeatSounded: (listener) => subscribe(beatSoundedListeners, listener),
      onBeatSample: (listener) => subscribe(beatSampleListeners, listener),
      onGameResumed: (listener) => events.on('GameResumed', listener),
      onRenderedFrame: (listener) => subscribe(renderedFrameListeners, listener),
      setGameInputBlocked: (isBlocked) => {
        isGameInputBlocked = isBlocked;
      },
      lastInputDevice: () => inputMapper.lastDevice,
      debugGroup: () => {
        if (currentLevel === null) return null;
        if (debugGroup === null) {
          debugGroup = new Group();
          debugGroup.name = 'pp-debug';
          currentLevel.scene.add(debugGroup);
        }
        return debugGroup;
      },
      auditionCue: (cueId) => {
        // A tap on the pane is a user gesture: a suspended context (a pause, the Result screen) is
        // resumed here. It starts asynchronously, so this tap plays nothing and the next one does.
        if (audio.state === 'suspended') audio.resume();
        if (audio.state !== 'running') return false;
        const cue = Object.hasOwn(feedbackTable.cues, cueId)
          ? feedbackTable.cues[cueId]
          : undefined;
        if (cue?.audio === undefined) return false;
        for (const part of [cue.audio, ...(cue.layers ?? [])]) {
          try {
            audio.playOneShot(part.clip, part.bus, part.gainPct);
          } catch (cause) {
            log.warn('audio', `sound board: "${part.clip}" could not play`, cause);
          }
        }
        return true;
      },
      fxState: () => {
        const real = currentLevel?.realFxState();
        return {
          cameraZoom: camera.zoom,
          cameraYawDeg: cameraFx.yawDeg,
          shakeOffsetM: Math.hypot(real?.shakeOffsetXM ?? 0, real?.shakeOffsetZM ?? 0),
          particlesAlive: real?.particlesAlive ?? 0,
          stampCount: stampsShownCount,
        };
      },
      threatScreenPoints: () => {
        const rect = canvas.getBoundingClientRect();
        return worldUi.threatEntries.map((entry) => {
          iconPoint.set(entry.xM, entry.yM, entry.zM).project(camera);
          return {
            threatId: entry.threatId,
            xPx: rect.left + ((iconPoint.x + 1) / 2) * rect.width,
            yPx: rect.top + ((1 - iconPoint.y) / 2) * rect.height,
          };
        });
      },
    };
    if (params.autoplay !== null) {
      try {
        const { installAutoplay } = await import('@debug/autoplay');
        const installed = installAutoplay(testHost, params.autoplay);
        if (installed.ok) isAutoplaying = true;
        else log.warn('boot', `ignoring ?autoplay=${params.autoplay}: ${installed.error.message}`);
      } catch (cause) {
        // A broken debug module must not take the game down: the normal start screen follows.
        log.warn('boot', 'ignoring ?autoplay: the autoplay module did not load', cause);
      }
    }
    // The FPS counter, for `?debug=1` only (a plain dev run and the screenshot specs do not see it).
    if (params.isDebug) {
      try {
        const { installPerfHud } = await import('@debug/perfHud');
        // Not in #pp-ui: the overlay host empties that layer at each screen change.
        installPerfHud(testHost, document.body);
      } catch (cause) {
        log.warn('boot', 'no FPS counter: the perf HUD module did not load', cause);
      }
    }
    // « Copier le journal » (story 3.3), for every playtest build: testers open the plain URL, so
    // it is not behind `?debug=1`. Installed now, not on the first press, so that a press never
    // waits for a chunk and the journal follows the very first level. A module that does not load
    // only costs the button: the game goes on.
    try {
      const { installPlaytestJournal } = await import('@debug/playtestJournal');
      const journal = installPlaytestJournal(testHost, {
        target: platform.capabilities.target,
        autoplay: isAutoplaying ? params.autoplay : null,
      });
      playtestCopyLog = () => journal.copyLog();
    } catch (cause) {
      log.warn('boot', 'no « Copier le journal »: the playtest journal module did not load', cause);
    }
  }

  // Before the start screen is up (story 2.7): never throws, a bad save is set aside with a `warn`.
  await saveStore.load();
  accessibility.apply();
  // The player's volumes wait in the engine for the unlock (story 2.8): the graph is made then.
  applyPlayerVolumes(saveStore.current().settings.volumes);
  appFsm.enter('start');
  drawStatic();
  // Written once more here so that the attributes only appear once the app is up.
  if (isMirrored) mirrorState();

  // Last, so that a test that sees `window.__PP__` is looking at an app that is up.
  if (
    import.meta.env.VITE_DEBUG_ALLOWED === 'true' &&
    testHost !== null &&
    isTestApiEnabled({
      isDebugAllowed: true,
      isDev: import.meta.env.DEV,
      isDebug: params.isDebug,
    })
  ) {
    try {
      const { installTestApi } = await import('@debug/testApi');
      installTestApi(window, testHost);
    } catch (cause) {
      log.warn('boot', 'window.__PP__ is not available: the test API module did not load', cause);
    }
    // The debug overlay (F1 or three fingers), hidden until toggled: same gate as the test API.
    try {
      const { installDebugOverlay } = await import('@debug/debugOverlay');
      installDebugOverlay(testHost);
    } catch (cause) {
      log.warn('boot', 'no debug overlay: its module did not load', cause);
    }
  }

  log.info(
    'boot',
    isAutoplaying ? 'ready: autoplay starts the level' : 'ready: waiting for the first gesture',
  );
  // No start screen to press: the bot's level begins by itself (start → loading is a legal move).
  if (isAutoplaying) void levelSession.start();
}
