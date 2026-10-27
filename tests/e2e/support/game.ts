import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page, type Route } from '@playwright/test';
import { feedbackClips } from '../../../src/content/feedbackClips.ts';
import type { FeedbackTable } from '../../../src/content/schemas/feedback.ts';
import { RESUME_COUNTDOWN_MS } from '../../../src/shared/constants.ts';

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
  loops: { babble: { clip: string }; music: { clip: string } };
  cues: Record<string, { audio?: { clip: string }; haptic?: 'light' | 'medium' | 'heavy' }>;
  events: Record<string, string>;
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
  movement: { walkSpeedMps: number };
  baby: {
    crawlSpeedMps: number;
    babbleMinMs: number;
    babbleMaxMs: number;
    wanderMaxDistM: number;
  };
};

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

export function html(page: Page): Locator {
  return page.locator('html');
}

/**
 * Opens the app and waits until it shows the start screen. `data-pp-app` and `data-pp-state` are
 * written by the composition root in dev and playtest builds only, once everything is up.
 */
export async function openGame(page: Page): Promise<void> {
  await page.goto('/');
  await expect(html(page)).toHaveAttribute('data-pp-app', 'start');
}

/** Opens the app, presses the start screen and waits for the level to be running (countdown included). */
export async function startLevel(page: Page): Promise<void> {
  await openGame(page);
  await page.locator('.pp-start-screen').click();
  await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
  await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
    timeout: RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS,
  });
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

/**
 * Replaces `navigator.getGamepads` before the page loads, with one standard pad that the test
 * drives through `setStick` and unplugs with `setPadPresent(false)`. Call it before `startLevel`.
 */
export async function stubGamepad(page: Page): Promise<{
  setStick(x: number, y: number): Promise<void>;
  setPadPresent(isPresent: boolean): Promise<void>;
}> {
  await page.addInitScript(() => {
    const state = { isPresent: false, axes: [0, 0, 0, 0] };
    Object.assign(window, { ppPad: state });
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => (state.isPresent ? [{ connected: true, axes: state.axes }] : [null]),
    });
  });
  return {
    setStick: (x, y) =>
      page.evaluate(
        ([axisX, axisY]) => {
          const state = (window as unknown as { ppPad: { isPresent: boolean; axes: number[] } })
            .ppPad;
          state.isPresent = true;
          state.axes = [axisX as number, axisY as number, 0, 0];
        },
        [x, y],
      ),
    setPadPresent: (isPresent) =>
      page.evaluate((next) => {
        (window as unknown as { ppPad: { isPresent: boolean } }).ppPad.isPresent = next;
      }, isPresent),
  };
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
