import type { Page } from '@playwright/test';
import type { PPTestApi } from '../../../src/debug/testApi.ts';
import type { World } from '../../../src/sim/index.ts';

// Thin typed wrappers over `window.__PP__` (story 1.13). A method that throws in the page rejects
// the `page.evaluate`, with the message of the page's Error.

type Command = Parameters<PPTestApi['send']>[0];
type Patch = Parameters<PPTestApi['setFeel']>[0];
type SimEventOf = ReturnType<PPTestApi['events']>[number];

/** Waits until the app is up and has installed the test API. */
export function waitForTestApi(page: Page): Promise<unknown> {
  return page.waitForFunction(() => window.__PP__ !== undefined);
}

export const ppState = (page: Page): Promise<World | null> =>
  page.evaluate(() => window.__PP__?.state() ?? null);

/** The world of the running level; fails the test if there is none. */
export async function ppWorld(page: Page): Promise<World> {
  const world = await ppState(page);
  if (world === null) throw new Error('__PP__.state() is null: no level is running');
  return world;
}

export const ppEvents = (page: Page, since?: number): Promise<SimEventOf[]> =>
  page.evaluate((from) => window.__PP__?.events(from) ?? [], since);

export const ppSend = (page: Page, cmd: Command): Promise<void> =>
  page.evaluate((command) => window.__PP__?.send(command), cmd);

export const ppAdvance = (page: Page, steps: number): Promise<void> =>
  page.evaluate((count) => window.__PP__?.advance(count), steps);

export const ppFreeze = (page: Page, on: boolean): Promise<void> =>
  page.evaluate((isOn) => window.__PP__?.freeze(isOn), on);

export const ppSetFeel = (page: Page, patch: Patch): Promise<void> =>
  page.evaluate((feelPatch) => window.__PP__?.setFeel(feelPatch), patch);

/**
 * Story 3.16 D14: every rise of the catastrophe gauge at 0 (a `SetFeel`, applied at the next step). A
 * spec that lets threats fail on purpose and is not about the catastrophe sends it after the level
 * is loaded, so that the gags do not bring Mama home and end the level under it. Never lower the
 * live values in `content/feel.json` to keep a spec green.
 */
export const ppSilenceCatastrophe = (page: Page): Promise<void> =>
  ppSetFeel(page, {
    catastrophe: { risePct: { nearMiss: 0, mess: 0, microSleep: 0, choreBeat: 0 } },
  });

export const ppLoadLevel = (page: Page, id: string, seed: number): Promise<void> =>
  page.evaluate(([levelId, levelSeed]) => window.__PP__?.loadLevel(levelId, levelSeed), [
    id,
    seed,
  ] as const);

/** What the level's frames measured so far (`__PP__.perf()`); fails the test if the API is not there. */
export async function ppPerf(page: Page): Promise<ReturnType<PPTestApi['perf']>> {
  const report = await page.evaluate(() => window.__PP__?.perf() ?? null);
  if (report === null) throw new Error('window.__PP__ is not installed');
  return report;
}

/** What the screen effects are doing right now (`__PP__.fx()`, story 2.5). */
export const ppFx = (page: Page): Promise<ReturnType<PPTestApi['fx']>> =>
  page.evaluate(
    () =>
      window.__PP__?.fx() ?? {
        cameraZoom: 1,
        cameraYawDeg: 0,
        cameraMode: 'fixed' as const,
        cameraCentreXM: 0,
        cameraCentreZM: 0,
        shakeOffsetM: 0,
        particlesAlive: 0,
        stampCount: 0,
        babyLayDownPct: 0,
        papaClip: null,
        babyClip: null,
        papaMixerMs: 0,
        papaBodyYawRad: 0,
        papaSteamSwayDeg: 0,
        papaBlablaTiltDeg: 0,
        doorOpenDeg: 0,
        dangerTintsShown: 0,
        lightsFactor: 1,
        mischiefDecals: 0,
        choreShards: 0,
        papaLook: { hasMashOnCheek: false, hasHairOnEnd: false, isShirtInsideOut: false },
      },
  );

/**
 * Where a world point is on the page now, in px (`__PP__.pagePoint`, story 9.2): the live game camera,
 * so it holds on a camera that follows Papa (`pagePointOf` in `game.ts` is the fixed camera's).
 */
export async function ppPagePoint(
  page: Page,
  xM: number,
  yM: number,
  zM: number,
): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(([x, y, z]) => window.__PP__?.pagePoint(x, y, z) ?? null, [
    xM,
    yM,
    zM,
  ] as const);
  if (point === null) throw new Error('window.__PP__ is not installed');
  return { x: point.xPx, y: point.yPx };
}

/** The cues the director played, oldest first, with the visuals each drew (`__PP__.cueLog()`, story 2.4). */
export const ppCueLog = (page: Page): Promise<ReturnType<PPTestApi['cueLog']>> =>
  page.evaluate(() => window.__PP__?.cueLog() ?? []);

/**
 * One house chore of the level as `data-pp-chore` mirrors it (story 9.4): `<index>:<state>:<beatsDone>/<beatCount>:<beatState>`,
 * the entry of chore `index` (the first by default; the mirror joins every chore of the level with `;`, and the
 * kitchen has two since story 9.6). `''` when the level has no such chore; null when the page is not a mirrored
 * build (or not in a level).
 */
export const ppChore = async (page: Page, index = 0): Promise<string | null> => {
  const mirror = await page.evaluate(() => document.documentElement.getAttribute('data-pp-chore'));
  return mirror === null ? null : (mirror.split(';')[index] ?? '');
};

/** One off-screen bubble as `data-pp-offscreen` mirrors it (story 9.3): its threat, edge, centre (page px) and chevron angle. */
export interface OffscreenBubbleMirror {
  threatId: number;
  edge: 'left' | 'top' | 'right';
  xPx: number;
  yPx: number;
  angleDeg: number;
}

/** The off-screen bubbles shown (`data-pp-offscreen`, sorted by threat id); empty when none. */
export async function ppOffscreen(page: Page): Promise<OffscreenBubbleMirror[]> {
  const value = await page.evaluate(() => document.documentElement.dataset.ppOffscreen ?? '');
  if (value === '') return [];
  return value.split(';').map((item) => {
    const [threatId, edge, xPx, yPx, angleDeg] = item.split(':');
    if (edge !== 'left' && edge !== 'top' && edge !== 'right') {
      throw new Error(`data-pp-offscreen has "${item}", not "<id>:<edge>:<x>:<y>:<angle>"`);
    }
    return {
      threatId: Number(threatId),
      edge,
      xPx: Number(xPx),
      yPx: Number(yPx),
      angleDeg: Number(angleDeg),
    };
  });
}
