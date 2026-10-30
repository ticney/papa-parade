import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page, type Route } from '@playwright/test';
import { Vector3 } from 'three';
import { createIsoCamera, fitIsoCamera } from '../../../src/client/render/isoCamera.ts';
import { roomOf } from '../../../src/client/render/levelScene.ts';
import { feedbackClips } from '../../../src/content/feedbackClips.ts';
import type { FeedbackTable } from '../../../src/content/schemas/feedback.ts';
import type { LevelGeometry } from '../../../src/content/schemas/levelGeometry.ts';
import { RESUME_COUNTDOWN_MS, STEP_MS } from '../../../src/shared/constants.ts';
import { ppAdvance, ppEvents, ppWorld } from './testApi.ts';

// The live room and feel, read here and never copied: Geo re-exports the room and retunes the feel freely.
const liveGeometry = JSON.parse(
  readFileSync('content/levels/salon_crawler.geometry.json', 'utf8'),
) as {
  anchors: { id: string; positionM: [number, number, number] }[];
  nav: { originM: [number, number]; cols: number; rowCount: number };
  cellM: number;
};
/** The live feedback table, read here and never copied: Geo retunes it freely. */
export const liveFeedback = JSON.parse(readFileSync('content/feedback.json', 'utf8')) as {
  haptics: Record<'light' | 'medium' | 'heavy', { patternMs: number[] }>;
  loops: { babble: { clip: string }; music: { stems: { calm: string; tense: string } } };
  cues: Record<string, { audio?: { clip: string }; haptic?: 'light' | 'medium' | 'heavy' }>;
  events: Record<string, string>;
  resultScreen: { inputGraceMs: number };
  calibration: { beep: { clip: string } };
};

/** How many distinct clips the live feedback table names: what the preload must have decoded. */
export const liveClipCount = feedbackClips(liveFeedback as unknown as FeedbackTable).length;

/**
 * The vibration pattern the live table gives an event (`events` -> cue -> `haptic` -> `haptics`), or
 * `null` when its cue has none. Geo retunes or deletes cues: no id and no kind is typed in a spec.
 */
export function hapticPatternOf(event: string): number[] | null {
  const cueId = liveFeedback.events[event];
  const kind = cueId === undefined ? undefined : liveFeedback.cues[cueId]?.haptic;
  return kind === undefined ? null : liveFeedback.haptics[kind].patternMs;
}

export const liveFeel = JSON.parse(readFileSync('content/feel.json', 'utf8')) as {
  timing: {
    telegraphDelayDefaultMs: number;
    windowMs: number;
    perfectMs: number;
    toleranceMs: number;
    hitstopMs: number;
  };
  movement: { walkSpeedMps: number };
  input: {
    contextReachM: number;
    autoTargetConeDeg: number;
    holdMinMs: number;
    touchRadiusPx: number;
  };
  baby: {
    crawlSpeedMps: number;
    babbleMinMs: number;
    babbleMaxMs: number;
    wanderMaxDistM: number;
    silenceAlertMs: number;
    sneakSpeedMps: number;
  };
  mama: {
    laughMaxPoints: number;
    babyStateMaxPoints: number;
    sighMaxPoints: number;
    screamMaxPoints: number;
    earlyWakePenaltyStars: number;
  };
  music: { slowMo: { belowScale: number } };
  calibration: { offsetMinMs: number; offsetMaxMs: number; audioWaitMs: number };
};

const feelSchema = JSON.parse(readFileSync('content/_schemas/feel.schema.json', 'utf8')) as unknown;

/**
 * A value `delta` above the live feel's `path` (e.g. `['timing', 'windowMs']`), kept inside the
 * schema's own `[minimum, maximum]` (`content/_schemas/feel.schema.json`, read here, never copied):
 * Geo retunes `feel.json` freely, and a spec that adds a constant to a live value must not walk out
 * of the range the schema allows. Above the maximum it goes below the live value instead. Always
 * different from the live value, so a spec can tell that it was sent.
 */
export function shiftedFeelValue(path: readonly string[], delta: number): number {
  const at = (root: unknown): Record<string, unknown> | undefined => {
    let node = root as Record<string, unknown> | undefined;
    for (const key of path)
      node = (node?.[key] ?? undefined) as Record<string, unknown> | undefined;
    return node;
  };
  const live = at(liveFeel) as unknown as number;
  const schemaNode = (): { minimum?: number; maximum?: number } => {
    let node = feelSchema as { properties?: Record<string, unknown> };
    for (const key of path) node = (node.properties?.[key] ?? {}) as typeof node;
    return node as { minimum?: number; maximum?: number };
  };
  const { minimum = Number.NEGATIVE_INFINITY, maximum = Number.POSITIVE_INFINITY } = schemaNode();
  const up = live + delta;
  if (up <= maximum) return up;
  const down = live - delta;
  if (down >= minimum && down !== live) return down;
  throw new Error(
    `no room to shift ${path.join('.')} (${live}) by ${delta} in [${minimum}, ${maximum}]`,
  );
}

/** The live level's waves, read here and never copied: Geo retunes them freely. */
const liveLevel = JSON.parse(readFileSync('content/levels/salon_crawler.json', 'utf8')) as {
  durationMs: number;
  waves: {
    fromMs: number;
    maxSimultaneous: number;
    gapMinMs: number;
    gapMaxMs: number;
    lullMs: number;
    threats: { def: string; anchor: string }[];
  }[];
};
/**
 * What the specs read of the live suspicious silence (`content/threats/silence_mischief.json`),
 * never copied: Geo retunes it freely (story 1.21).
 */
export interface LiveSilenceDef {
  id: string;
  telegraphDelayMs: number | null;
  windowMs: number | null;
  findMaxMs: number;
  surpriseGags: string[];
  feedback: { telegraph: string; success: string; perfect: string; gag: string };
}
export const liveSilence = JSON.parse(
  readFileSync('content/threats/silence_mischief.json', 'utf8'),
) as LiveSilenceDef;

/** What the specs read of the live phone (`content/disruptions/phone.json`), never copied: Geo retunes it freely. */
export interface LivePhoneDef {
  ringMaxMs: number;
  answerBusyMs: number;
  answerFatiguePoints: number;
  feedback: { ring: string; answer: string };
}
export const livePhone = JSON.parse(
  readFileSync('content/disruptions/phone.json', 'utf8'),
) as LivePhoneDef;
/** The live level's length, in sim ms: the timer reads it at the start and ends the level there. */
export const LEVEL_DURATION_MS = liveLevel.durationMs;
export const liveWaves = liveLevel.waves;
const firstWave = liveWaves[0];
if (firstWave === undefined) throw new Error('the live level has no wave');

/** What the specs read of a threat def (`content/threats/<def>.json`). */
export interface LiveThreatDef {
  id: string;
  telegraphDelayMs: number | null;
  windowMs: number | null;
  cooldownMs: number;
  gag: string;
  /** The key of `strings.fr.json` of the verb shown above the threat (story 2.2). */
  verbKey: string | null;
  iconShape: 'circle' | 'triangle';
  color: 'parry' | 'dodge';
  feedback: { telegraph: string; success: string; perfect: string; gag: string };
}
const liveThreatCache = new Map<string, LiveThreatDef>();
/** A live threat def, read here and never copied. */
export function liveThreat(defId: string): LiveThreatDef {
  const cached = liveThreatCache.get(defId);
  if (cached !== undefined) return cached;
  const def = JSON.parse(readFileSync(`content/threats/${defId}.json`, 'utf8')) as LiveThreatDef;
  liveThreatCache.set(defId, def);
  return def;
}
/** Sim ms from a telegraph to the opening of the window of `def`. */
export const telegraphDelayMsOf = (def: LiveThreatDef): number =>
  def.telegraphDelayMs ?? liveFeel.timing.telegraphDelayDefaultMs;
/** Sim ms a window of `def` stays open for a press, tolerance included. */
export const windowOpenMsOf = (def: LiveThreatDef): number =>
  (def.windowMs ?? liveFeel.timing.windowMs) + liveFeel.timing.toleranceMs;

/**
 * The latest sim ms of the first telegraph of the live plan: the first wave's start plus its
 * longest gap, plus a step for the grid. The first threat is drawn by the PRNG: a bound, not a time.
 */
export const FIRST_TELEGRAPH_MAX_MS = firstWave.fromMs + firstWave.gapMaxMs + STEP_MS;
/** The longest a threat of the first wave takes from its telegraph to the end of its window. */
export const FIRST_WAVE_RESPONSE_MAX_MS = Math.max(
  ...firstWave.threats.map(
    ({ def }) => telegraphDelayMsOf(liveThreat(def)) + windowOpenMsOf(liveThreat(def)),
  ),
);

/** A telegraph the sim announced: when, which threat, and its def. */
export interface TelegraphedThreat {
  t: number;
  threatId: number;
  kind: string;
  def: LiveThreatDef;
}

/** The latest `ThreatTelegraphed` of the running level (needs the test API); fails if there is none. */
export async function lastTelegraph(page: Page): Promise<TelegraphedThreat> {
  const events = await ppEvents(page);
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.type === 'ThreatTelegraphed') {
      return {
        t: event.t,
        threatId: event.threatId,
        kind: event.kind,
        def: liveThreat(event.kind),
      };
    }
  }
  throw new Error('no ThreatTelegraphed yet');
}

/**
 * On a frozen, freshly loaded level: advances in small chunks until the first threat is
 * telegraphed, and returns it. Bounded by the live plan, never by a timeout.
 */
export async function stepToFirstTelegraph(page: Page): Promise<TelegraphedThreat> {
  const chunkSteps = 10;
  const maxChunks = Math.ceil(FIRST_TELEGRAPH_MAX_MS / (STEP_MS * chunkSteps)) + 1;
  for (let i = 0; i < maxChunks; i++) {
    await ppAdvance(page, chunkSteps);
    const events = await ppEvents(page);
    if (events.some((event) => event.type === 'ThreatTelegraphed')) return lastTelegraph(page);
  }
  throw new Error(`no threat was telegraphed within ${FIRST_TELEGRAPH_MAX_MS} ms of sim time`);
}

/** The vibration pattern the live table gives a cue (`cues` -> `haptic` -> `haptics`), or `null`. */
export function hapticPatternOfCue(cueId: string): number[] | null {
  const kind = liveFeedback.cues[cueId]?.haptic;
  return kind === undefined ? null : liveFeedback.haptics[kind].patternMs;
}

/** The query that loads the level with no planned threat (debug builds only). */
export const THREATS_OFF = '?threats=off';

/** Where an anchor of the live room is, in metres, as the debug mirrors write it (two decimals). */
export function anchorMirror(id: string): { x: number; z: number } {
  const anchor = liveGeometry.anchors.find((candidate) => candidate.id === id);
  if (anchor === undefined) throw new Error(`the live room has no ${id} anchor`);
  return { x: Number(anchor.positionM[0].toFixed(2)), z: Number(anchor.positionM[2].toFixed(2)) };
}

/**
 * How long Papa's longest walk may take: across the room diagonal at the live walking speed, plus
 * slack. A bound that only catches a walk that never ends, not a duration to wait for.
 */
export const WALK_BOUND_MS =
  (Math.hypot(
    liveGeometry.nav.cols * liveGeometry.cellM,
    liveGeometry.nav.rowCount * liveGeometry.cellM,
  ) /
    liveFeel.movement.walkSpeedMps) *
    1000 +
  4000;

/** Slack on top of a countdown, for a loaded CI machine: it only catches a countdown that never ends. */
export const OVERRUN_MARGIN_MS = 2000;

/**
 * How much longer than `durationMs / speed` a whole level may take in real time, as a bound. The
 * slow-motion and the hitstops of the parries slow the sim: measured on 2026-10-28 (story 1.24), a
 * bot-played level runs at about 0.6 sim-seconds per real second at speed 1, about 1.7 times its
 * duration. 2.5 leaves headroom; it only catches a level that never ends, never a time to wait for.
 */
export const LEVEL_REAL_TIME_FACTOR_MAX = 2.5;

export function html(page: Page): Locator {
  return page.locator('html');
}

/**
 * Opens the app and waits until it shows the start screen. `data-pp-app` and `data-pp-state` are
 * written by the composition root in dev and playtest builds only, once everything is up.
 */
export async function openGame(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await expect(html(page)).toHaveAttribute('data-pp-app', 'start');
}

/** Opens the app, presses the start screen and waits for the level to be running (countdown included). */
export async function startLevel(page: Page, query = ''): Promise<void> {
  await openGame(page, query);
  await page.locator('.pp-start-screen').click();
  await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
  await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
    timeout: RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS,
  });
}

/**
 * Waits for the threat to reach `state` (`telegraph`, `windowOpen`, `resolved`, `gag` or `idle`) as
 * the app mirrors it, polling on every display frame: a press has to land inside a window of a few
 * hundred ms, which a slower poll could eat.
 */
export function waitForThreat(page: Page, state: string, timeoutMs: number): Promise<unknown> {
  return page.waitForFunction(
    (wanted) => document.documentElement.dataset.ppThreat?.endsWith(`:${wanted}`) === true,
    state,
    { polling: 'raf', timeout: timeoutMs },
  );
}

/** The centre of the threat icon in page coordinates, as the app mirrors it on a telegraph. */
export async function threatIconPoint(page: Page): Promise<{ x: number; y: number }> {
  const value = await html(page).getAttribute('data-pp-threat-px');
  const match = /^(-?\d+\.\d),(-?\d+\.\d)$/.exec(value ?? '');
  if (match === null) throw new Error(`data-pp-threat-px is "${String(value)}", not "x,y"`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

/**
 * The centre of an object's icon in page coordinates, as the app mirrors it once per level
 * (`data-pp-object-px`: `coffee_machine:x,y;phone:x,y`).
 */
export async function objectIconPoint(
  page: Page,
  objectId: string,
): Promise<{ x: number; y: number }> {
  const value = await html(page).getAttribute('data-pp-object-px');
  for (const entry of (value ?? '').split(';')) {
    const match = /^([a-z0-9_]+):(-?\d+\.\d),(-?\d+\.\d)$/.exec(entry);
    if (match?.[1] === objectId) return { x: Number(match[2]), y: Number(match[3]) };
  }
  throw new Error(`data-pp-object-px is "${String(value)}": no point for "${objectId}"`);
}

/**
 * Where a point of the live room (metres) is on the page, in px: the game's own iso camera, fitted
 * to the live room and to the canvas box. For checking where something is drawn.
 */
export async function pagePointOf(
  page: Page,
  xM: number,
  yM: number,
  zM: number,
): Promise<{ x: number; y: number }> {
  const box = await page.locator('#pp-canvas').boundingBox();
  if (box === null) throw new Error('the canvas has no box');
  const geometry = JSON.parse(
    readFileSync('content/levels/salon_crawler.geometry.json', 'utf8'),
  ) as LevelGeometry;
  const camera = createIsoCamera();
  fitIsoCamera(camera, roomOf(geometry), box.width / box.height);
  const projected = new Vector3(xM, yM, zM).project(camera);
  return {
    x: box.x + ((projected.x + 1) / 2) * box.width,
    y: box.y + ((1 - projected.y) / 2) * box.height,
  };
}

/** The audio context state the app mirrors: `none` before the first gesture, then the context's own. */
export const audioState = (page: Page): Promise<string | null> =>
  html(page).getAttribute('data-pp-audio');

/** How many cues the director has played since boot, as mirrored. */
export async function cueCount(page: Page): Promise<number> {
  return Number(await html(page).getAttribute('data-pp-cue-count'));
}

/**
 * Before the page loads: wraps `navigator.vibrate` (when the browser has one) so that every
 * pattern it is called with is recorded; `vibrations` reads them back. WebKit has no `vibrate`:
 * nothing is wrapped and nothing is recorded.
 */
export async function recordVibrations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: number[][] = [];
    Object.assign(window, { ppVibrations: seen });
    const original = navigator.vibrate?.bind(navigator);
    if (original === undefined) return;
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: (pattern: number[]) => {
        seen.push([...pattern]);
        return original(pattern);
      },
    });
  });
}

export function vibrations(page: Page): Promise<number[][]> {
  return page.evaluate(() => [...(window as unknown as { ppVibrations: number[][] }).ppVibrations]);
}

/** Waits for `count` display frames inside the page: a bounded count, never a timeout. */
export function waitFrames(page: Page, count: number): Promise<void> {
  return page.evaluate(
    (frames) =>
      new Promise<void>((resolve) => {
        let remaining = frames;
        const onFrame = (): void => {
          remaining--;
          if (remaining <= 0) resolve();
          else requestAnimationFrame(onFrame);
        };
        requestAnimationFrame(onFrame);
      }),
    count,
  );
}

/** Headless browsers do not hide pages on demand: override the property and fire the event. */
export function setVisibility(page: Page, visibilityState: 'hidden' | 'visible'): Promise<void> {
  return page.evaluate((next) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => next });
    document.dispatchEvent(new Event('visibilitychange'));
  }, visibilityState);
}

/**
 * A screenshot of the canvas alone: the DOM layers (tap marker, HUD, panels, countdown) are hidden
 * while it is taken, so "nothing moved" means the scene, not an animation of the interface.
 */
export function sceneShot(page: Page): Promise<Buffer> {
  return page.locator('#pp-canvas').screenshot({
    style: '#pp-world, #pp-hud, #pp-ui { visibility: hidden !important }',
    animations: 'disabled',
  });
}

export const pauseButton = (page: Page, label: string): Locator =>
  page.getByRole('button', { name: label, exact: true });

/** Waits for every finite animation (a panel pop-in) to end, so boxes are measured at rest. */
export function settleAnimations(page: Page): Promise<unknown> {
  return page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY,
        )
        // A cancelled animation (a hidden digit) rejects `finished`: that is not a failure here.
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

/**
 * The warnings the app raises about its own bugs; the dev server's other warnings are not ours.
 * Every warning of the audio engine (`[audio]`: unlock, resume, a clip, a loop, a one-shot, a
 * preload that gave up...) and of the feedback director (`[feedback]`) is here: the console sink
 * prints the channel in brackets, and a sound that silently fails to play fails every spec.
 */
export const OWN_WARNINGS =
  /missing string key|no "[a-z]+" screen to show|cannot load \d+ font|setPointerCapture failed|\[(?:audio|feedback)\] /;

/**
 * Collects what must fail a session: console errors, page errors, and the app's own warnings about
 * a missing string, a screen it could not build, a font that failed, a lost pointer capture.
 */
export function collectProblems(page: Page, options: { allowedErrors?: RegExp } = {}): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      // A test that breaks the network on purpose expects the browser's own "Failed to load" line.
      if (!options.allowedErrors?.test(message.text())) problems.push(`console: ${message.text()}`);
    }
    if (message.type() === 'warning' && OWN_WARNINGS.test(message.text())) {
      problems.push(`warning: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

/** The texts of the console errors so far: the page's own `log.error` lines reach the console in dev. */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

/** The browser's own line for a request that failed or answered with an error status. */
export const FAILED_REQUEST = /Failed to load resource/;

/** Requests for the level's `.glb` (served from `public/` by the dev server). */
export const GLB_URL = '**/assets/levels/*.glb';

/** Requests for the level's geometry (a Vite module in dev: `…/salon_crawler.geometry.json?…`). */
export const GEOMETRY_URL = /salon_crawler\.geometry\.json/;

export interface RequestGate {
  /** Lets every request held so far, and later ones, through. */
  release(): void;
}

/**
 * Holds the responses to requests matching `pattern` until `release()`, with a promise rather than a
 * timeout: a test decides when the network "arrives".
 */
export async function holdRequests(page: Page, pattern: string | RegExp): Promise<RequestGate> {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(pattern, async (route: Route) => {
    await gate;
    await route.continue();
  });
  return { release };
}

/** How many distinct colours a PNG holds: 1 for a flat image, a handful for a lit room. */
export function distinctColours(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('no 2d context');
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const colours = new Set<number>();
    for (let i = 0; i < data.length; i += 4) {
      colours.add(
        ((data[i] as number) << 16) | ((data[i + 1] as number) << 8) | (data[i + 2] as number),
      );
    }
    return colours.size;
  }, png.toString('base64'));
}

/** The level-load warnings the app logged (`level load failed`, with the level id in its data). */
export function collectLoadWarnings(page: Page): { ids: string[]; messages: string[] } {
  const found = { ids: [] as string[], messages: [] as string[] };
  page.on('console', (message) => {
    if (message.type() !== 'warning' || !message.text().includes('level load failed')) return;
    const data = message.args()[1];
    void data
      ?.evaluate((value: { id: string; error: { message: string } }) => ({
        id: value.id,
        message: value.error.message,
      }))
      .then(({ id, message: text }) => {
        found.ids.push(id);
        found.messages.push(text);
      });
  });
  return found;
}

/** `data-pp-app` values in the order they were written, from now on. Read them with `appHistory`. */
export function recordAppStates(page: Page): Promise<void> {
  return page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __ppAppHistory: string[] }).__ppAppHistory = seen;
    new MutationObserver(() => {
      seen.push(document.documentElement.dataset.ppApp ?? '');
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-pp-app'] });
  });
}

export function appHistory(page: Page): Promise<string[]> {
  return page.evaluate(() => [
    ...(window as unknown as { __ppAppHistory: string[] }).__ppAppHistory,
  ]);
}

/** A point of the canvas, as shares of its width and height (0 to 1), in page coordinates. */
export async function canvasPoint(
  page: Page,
  shareX: number,
  shareY: number,
): Promise<{ x: number; y: number }> {
  const box = await page.locator('#pp-canvas').boundingBox();
  if (box === null) throw new Error('the canvas has no box');
  return { x: box.x + box.width * shareX, y: box.y + box.height * shareY };
}

/**
 * Taps the canvas at 50 % of its width and 25 % of its height, a point of the floor far enough from
 * the spawn for a walk of a few seconds, and waits for Papa to follow the path. Tests that need the
 * scene to change over time (a pause, a countdown) use it instead of a provisional moving cube.
 */
export async function startWalking(page: Page): Promise<void> {
  const { x, y } = await canvasPoint(page, 0.5, 0.25);
  await page.touchscreen.tap(x, y);
  await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'walkPath');
}

/** Papa's position as last mirrored (on a change of state, an arrival or a block), in metres. */
export async function papaAt(page: Page): Promise<{ x: number; z: number }> {
  const value = await html(page).getAttribute('data-pp-papa-at');
  const match = /^(-?\d+\.\d+),(-?\d+\.\d+)$/.exec(value ?? '');
  if (match === null) throw new Error(`data-pp-papa-at is "${String(value)}", not "x,z"`);
  return { x: Number(match[1]), z: Number(match[2]) };
}

/** The baby's position as last mirrored (on a change of state), in metres. */
export async function babyAt(page: Page): Promise<{ x: number; z: number }> {
  const value = await html(page).getAttribute('data-pp-baby-at');
  const match = /^(-?\d+\.\d+),(-?\d+\.\d+)$/.exec(value ?? '');
  if (match === null) throw new Error(`data-pp-baby-at is "${String(value)}", not "x,z"`);
  return { x: Number(match[1]), z: Number(match[2]) };
}

/** The pad the test drives; see {@link stubGamepad}. */
export interface GamepadStub {
  setStick(x: number, y: number): Promise<void>;
  /** Plugs the pad in or pulls it out; both also dispatch the window event, as a browser does. */
  setPadPresent(isPresent: boolean): Promise<void>;
  /** Holds the button down (a standard-layout index: 0 = A, 1 = B, 9 = Start, 12 to 15 = D-pad). */
  pressButton(index: number): Promise<void>;
  releaseButton(index: number): Promise<void>;
  /** A press and a release the game polls: a button seen for at least `frames` frames each way. */
  tapButton(index: number, frames?: number): Promise<void>;
  /** Sets `Gamepad.id` (the family of the glyphs is read from it). */
  setId(id: string): Promise<void>;
}

/** An Xbox pad's id as Chrome writes it. */
export const XBOX_PAD_ID = 'Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)';
/** A DualSense's id as Chrome writes it (Sony's vendor id is 054c). */
export const DUALSENSE_PAD_ID =
  'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';

/**
 * Replaces `navigator.getGamepads` before the page loads, with one standard-mapping pad that the
 * test drives through `setStick`, the buttons and `setPadPresent` (it starts unplugged). Call it
 * before `startLevel`. `setStick` also plugs the pad in, as it always did.
 */
export async function stubGamepad(page: Page): Promise<GamepadStub> {
  await page.addInitScript(
    ({ id }) => {
      const state = {
        isPresent: false,
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => false),
        id,
      };
      Object.assign(window, { ppPad: state });
      Object.defineProperty(navigator, 'getGamepads', {
        configurable: true,
        value: () =>
          state.isPresent
            ? [
                {
                  connected: true,
                  index: 0,
                  id: state.id,
                  mapping: 'standard',
                  timestamp: performance.now(),
                  axes: state.axes,
                  buttons: state.buttons.map((pressed) => ({ pressed })),
                },
              ]
            : [null],
      });
    },
    { id: XBOX_PAD_ID },
  );
  type PadState = { isPresent: boolean; axes: number[]; buttons: boolean[]; id: string };
  const stub: GamepadStub = {
    setStick: (x, y) =>
      page.evaluate(
        ([axisX, axisY]) => {
          const state = (window as unknown as { ppPad: PadState }).ppPad;
          state.isPresent = true;
          state.axes = [axisX as number, axisY as number, 0, 0];
        },
        [x, y],
      ),
    setPadPresent: (isPresent) =>
      page.evaluate((next) => {
        (window as unknown as { ppPad: PadState }).ppPad.isPresent = next;
        // `GamepadEvent` needs a real pad: a plain `Event` is what the game must cope with.
        window.dispatchEvent(new Event(next ? 'gamepadconnected' : 'gamepaddisconnected'));
      }, isPresent),
    pressButton: (index) =>
      page.evaluate((button) => {
        (window as unknown as { ppPad: PadState }).ppPad.buttons[button] = true;
      }, index),
    releaseButton: (index) =>
      page.evaluate((button) => {
        (window as unknown as { ppPad: PadState }).ppPad.buttons[button] = false;
      }, index),
    async tapButton(index, frames = 2) {
      await stub.pressButton(index);
      await waitFrames(page, frames);
      await stub.releaseButton(index);
      await waitFrames(page, frames);
    },
    setId: (id) =>
      page.evaluate((next) => {
        (window as unknown as { ppPad: PadState }).ppPad.id = next;
      }, id),
  };
  return stub;
}

/** Dispatches a key event with a given `key` and `code`, as an AZERTY or QWERTY keyboard would. */
export function pressCode(
  page: Page,
  type: 'keydown' | 'keyup',
  key: string,
  code: string,
): Promise<void> {
  return page.evaluate(
    ([eventType, eventKey, eventCode]) => {
      window.dispatchEvent(
        new KeyboardEvent(eventType as string, { key: eventKey, code: eventCode }),
      );
    },
    [type, key, code],
  );
}

/**
 * Before the page loads: wraps `AudioContext` so that each construction records whether it ran in
 * the task of a user gesture: a capture listener on `window` marks the task of every
 * `pointerdown`, `pointerup`, `click` and `keydown` and clears the mark in the next macrotask. A
 * context made from a timer, a `fetch` or the countdown's end (`GameResumed`) is outside any
 * gesture, and iOS honours the unlock nowhere else. (`navigator.userActivation.isActive` would not
 * do: it stays true for seconds after the gesture, longer than the loading screen.)
 * `audioContextActivations` reads them back.
 */
export async function recordAudioContexts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const Original = window.AudioContext;
    const seen: boolean[] = [];
    Object.assign(window, { ppAudioContextActivations: seen });
    let isGestureTask = false;
    for (const type of ['pointerdown', 'pointerup', 'click', 'keydown']) {
      window.addEventListener(
        type,
        () => {
          isGestureTask = true;
          setTimeout(() => {
            isGestureTask = false;
          }, 0);
        },
        { capture: true },
      );
    }
    if (typeof Original !== 'function') return;
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) {
        seen.push(isGestureTask);
        super(options);
      }
    };
  });
}

/** One entry per `AudioContext` made: `true` when it was made in the task of a gesture. */
export function audioContextActivations(page: Page): Promise<boolean[]> {
  return page.evaluate(() => [
    ...(window as unknown as { ppAudioContextActivations: boolean[] }).ppAudioContextActivations,
  ]);
}

/** A value an attribute of `<html>` took, in the order the page wrote them. */
export interface MirrorWrite {
  name: string;
  value: string;
}

/**
 * Before the page loads: records every write of the given `data-pp-*` attributes of `<html>`, in
 * order and across attributes, from the first one (a `MutationObserver` on `document`, which exists
 * before `<html>` does). `mirrorWrites` reads them back.
 */
export async function recordMirrorWrites(page: Page, names: string[]): Promise<void> {
  await page.addInitScript((watched) => {
    const writes: { name: string; value: string }[] = [];
    Object.assign(window, { ppMirrorWrites: writes });
    new MutationObserver((records) => {
      for (const record of records) {
        const name = record.attributeName as string;
        const value = (record.target as Element).getAttribute(name) ?? '';
        writes.push({ name, value });
      }
    }).observe(document, { attributes: true, subtree: true, attributeFilter: watched });
  }, names);
}

export function mirrorWrites(page: Page): Promise<MirrorWrite[]> {
  return page.evaluate(() => [
    ...(window as unknown as { ppMirrorWrites: { name: string; value: string }[] }).ppMirrorWrites,
  ]);
}

/**
 * The `data-pp-audio` values written during each countdown (while `data-pp-state` is `resuming`),
 * one list per countdown. A countdown is silent when its context ends suspended and stays so: a
 * list is empty (nothing changed) or, from its first `suspended` on, only `suspended`. WebKit may
 * report `running` once at the very start of the level's countdown, when the unlock's `resume()`
 * lands after `PauseRequested` queued the suspend: nothing plays then (the loops start with the
 * level), and it settles to `suspended` for the rest of the countdown.
 */
export function audioDuringCountdowns(writes: MirrorWrite[]): string[][] {
  const countdowns: string[][] = [];
  let state = '';
  for (const { name, value } of writes) {
    if (name === 'data-pp-state') {
      if (value === 'resuming' && state !== 'resuming') countdowns.push([]);
      state = value;
    } else if (name === 'data-pp-audio' && state === 'resuming') {
      countdowns.at(-1)?.push(value);
    }
  }
  return countdowns;
}

/** Whether every countdown of `audioDuringCountdowns` was silent: settled on `suspended`, and kept there. */
export function areCountdownsSilent(countdowns: string[][]): boolean {
  return countdowns.every((values) => {
    const firstSuspended = values.indexOf('suspended');
    if (firstSuspended < 0) return values.length === 0;
    return values.slice(firstSuspended).every((value) => value === 'suspended');
  });
}

/** The longest the Result sequence takes on a loaded machine; a spec never waits this long on success. */
const RESULT_SEQUENCE_TIMEOUT_MS = 15_000;
/** Real ms past the input grace of the live content, for a press that must count. */
const RESULT_GRACE_MARGIN_MS = 60;

/**
 * Waits until the Result screen's buttons are up and their input grace is over, so that the next
 * press counts. The grace is real time: it waits for the page's own clock, never a fixed delay.
 */
export async function waitForResultActions(page: Page): Promise<void> {
  await expect(html(page)).toHaveAttribute('data-pp-result', 'actions', {
    timeout: RESULT_SEQUENCE_TIMEOUT_MS,
  });
  const untilMs = await page.evaluate(
    (graceMs) => performance.now() + graceMs,
    liveFeedback.resultScreen.inputGraceMs + RESULT_GRACE_MARGIN_MS,
  );
  await page.waitForFunction((target) => performance.now() >= target, untilMs);
}

/** One `advance` call at most this long: a whole level in one call would block the page for long. */
export const CHUNK_STEPS = 3000;

/**
 * Steps a frozen level, in chunks, to its last step: the one that ends it (`LevelEnded`, then Mama's
 * `LevelScored`, story 1.22). The app then enters `result` and its loop stops, so no step is asked
 * for after that one (an `advance` would throw: no level is running).
 */
export async function advanceToEnd(page: Page): Promise<void> {
  let remaining = Math.ceil((LEVEL_DURATION_MS - (await ppWorld(page)).time.sim) / STEP_MS);
  while (remaining > 0) {
    const chunk = Math.min(CHUNK_STEPS, remaining);
    await ppAdvance(page, chunk);
    remaining -= chunk;
  }
}
