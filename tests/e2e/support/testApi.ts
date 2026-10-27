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

export const ppLoadLevel = (page: Page, id: string, seed: number): Promise<void> =>
  page.evaluate(([levelId, levelSeed]) => window.__PP__?.loadLevel(levelId, levelSeed), [
    id,
    seed,
  ] as const);
