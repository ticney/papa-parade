import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { type JournalFile, JournalSchema } from '../../src/content/schemas/journal.ts';
import {
  advanceToEnd,
  collectProblems,
  html,
  shiftedFeelValue,
  waitForResultActions,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';
import {
  ppAdvance,
  ppEvents,
  ppFreeze,
  ppLoadLevel,
  ppSend,
  ppSetFeel,
  waitForTestApi,
} from './support/testApi.ts';

// The exportable game journal (story 3.3): « Copier le journal » on the Result screen of a playtest
// build gives a file that `npm run sim:replay` replays to the same state, from this browser's
// engine (JavaScriptCore on webkit) in Node's. Nothing waits on a fixed delay.

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const LEVEL = 'salon_crawler';
const SEED = 42;
const PANEL = '.pp-result-panel';
const REPLAY = `${PANEL} .pp-result-actions .pp-button-primary`;
const COPY = `${PANEL} .pp-result-actions .pp-button-secondary`;
const REPLAY_TIMEOUT_MS = 120_000;

/** Stubs `navigator.clipboard.writeText`: it keeps every text it is given, and resolves, or rejects. */
async function stubClipboard(page: Page, behaviour: 'resolve' | 'reject'): Promise<void> {
  await page.addInitScript((mode) => {
    const copied: string[] = [];
    Object.assign(window, { __ppCopied: copied });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          copied.push(text);
          return mode === 'resolve'
            ? Promise.resolve()
            : Promise.reject(new DOMException('denied', 'NotAllowedError'));
        },
      },
    });
  }, behaviour);
}

const stubbedTexts = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __ppCopied: string[] }).__ppCopied);

/** Opens the game on a frozen level, steps it to its end, and waits for the Result screen. */
async function openResult(page: Page): Promise<void> {
  await page.goto('/');
  await waitForTestApi(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
  // A journaled live tuning, so that the replay also has a `SetFeel` to carry.
  await ppSetFeel(page, { timing: { windowMs: shiftedFeelValue(['timing', 'windowMs'], 20) } });
  await endLevel(page);
}

async function endLevel(page: Page): Promise<void> {
  await advanceToEnd(page);
  await expect(html(page)).toHaveAttribute('data-pp-app', 'result');
}

function parseJournal(text: string): JournalFile {
  return JournalSchema.parse(JSON.parse(text));
}

test.describe('the exportable game journal', () => {
  test('« Copier le journal » copies a file that sim:replay replays to the same state', async ({
    page,
    context,
    browserName,
  }, testInfo) => {
    const problems = collectProblems(page);
    // Chromium reads the real clipboard back; WebKit does not grant clipboard reads, so the text
    // the page gives to `writeText` is captured instead.
    if (browserName === 'chromium') {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    } else {
      await stubClipboard(page, 'resolve');
    }
    await openResult(page);
    const events = await ppEvents(page);
    await waitForResultActions(page);

    const copy = page.locator(COPY);
    await expect(copy).toHaveText(STRINGS['result.copy_log'] as string);
    await copy.click();
    await expect(copy).toHaveText(STRINGS['result.log_copied'] as string);

    const text =
      browserName === 'chromium'
        ? await page.evaluate(() => navigator.clipboard.readText())
        : ((await stubbedTexts(page))[0] ?? '');
    const file = parseJournal(text);

    const ended = events.find((event) => event.type === 'LevelEnded');
    const scored = events.find((event) => event.type === 'LevelScored');
    if (ended === undefined || scored === undefined) throw new Error('the level did not end');
    const { type: _type, t: _t, ...score } = scored as unknown as Record<string, number | string>;
    expect(file.summary.endReason).toBe((ended as unknown as { reason: string }).reason);
    expect(file.summary.score).toEqual(score);
    expect(file.summary.gameIndexInSession).toBe(1);
    expect(file.summary.autoplay).toBeNull();
    expect(Object.keys(file.device).sort()).toEqual(['platform', 'target', 'type']);
    expect(file.replay.levelId).toBe(LEVEL);
    expect(file.replay.strictInvariants).toBe(true);
    // The tuning travelled with the game.
    expect(file.replay.journal.entries.some((entry) => entry.command.type === 'SetFeel')).toBe(
      true,
    );

    const path = testInfo.outputPath('journal.json');
    writeFileSync(path, text);
    const replayed = spawnSync('npx', ['tsx', 'tools/sim/replaySim.ts', path], {
      cwd: REPO,
      encoding: 'utf8',
      timeout: REPLAY_TIMEOUT_MS,
    });
    expect(replayed.stderr).not.toContain('content of this checkout');
    expect(replayed.stdout).toContain('replay matches');
    expect(replayed.stdout).toContain(file.replay.worldHash);
    expect(replayed.status).toBe(0);
    expect(problems).toEqual([]);
  });

  test('when the clipboard refuses, the press downloads the file, and so does every later one', async ({
    page,
  }) => {
    const problems = collectProblems(page, { allowedErrors: /NotAllowedError|denied/ });
    await stubClipboard(page, 'reject');
    await openResult(page);
    await waitForResultActions(page);

    const copy = page.locator(COPY);
    const [first] = await Promise.all([page.waitForEvent('download'), copy.click()]);
    await expect(copy).toHaveText(STRINGS['result.download_log'] as string);
    const file = parseJournal(readFileSync(await first.path(), 'utf8'));
    expect(first.suggestedFilename()).toBe(
      `papa-parade-journal-${LEVEL}-${file.summary.sessionId}-1.json`,
    );
    expect(await stubbedTexts(page)).toHaveLength(1);

    // From now on the clipboard is not tried again.
    const [second] = await Promise.all([page.waitForEvent('download'), copy.click()]);
    expect(second.suggestedFilename()).toBe(first.suggestedFilename());
    const again = parseJournal(readFileSync(await second.path(), 'utf8'));
    // The same game; only the logs moved on, with the warn of the first refusal.
    expect({ ...again, diagnostics: null }).toEqual({ ...file, diagnostics: null });
    const refusals = again.diagnostics.logs.filter(
      (entry) => entry.level === 'warn' && entry.channel === 'debug',
    );
    expect(refusals).toHaveLength(1);
    expect(JSON.stringify(refusals[0]?.data)).toContain('NotAllowedError');
    expect(await stubbedTexts(page)).toHaveLength(1);
    await expect(copy).toHaveText(STRINGS['result.download_log'] as string);
    expect(problems.filter((problem) => !/NotAllowedError|denied/.test(problem))).toEqual([]);
  });

  for (const viewport of [
    { width: 844, height: 390 },
    { width: 750, height: 340 },
  ]) {
    test(`the button fits ${viewport.width} × ${viewport.height} in one line, as « Copier » and as « Télécharger »`, async ({
      page,
    }) => {
      await stubClipboard(page, 'reject');
      await page.setViewportSize(viewport);
      await page.goto('/');
      await waitForTestApi(page);
      await ppFreeze(page, true);
      await ppLoadLevel(page, LEVEL, SEED);
      // The tightest Result screen: a woken Mama, with her header (story 3.2).
      await ppSend(page, { type: 'SetNoise', pct: 100 });
      await ppAdvance(page, 1);
      await expect(html(page)).toHaveAttribute('data-pp-app', 'result');
      await waitForResultActions(page);

      const copy = page.locator(COPY);
      const measure = async () => ({
        panel: await page
          .locator(PANEL)
          .evaluate((panel) => panel.scrollHeight - panel.clientHeight),
        row: await page.locator(`${PANEL} .pp-result-actions`).evaluate((row) => ({
          height: row.getBoundingClientRect().height,
          overflowPx: row.scrollWidth - row.clientWidth,
        })),
        copy: await copy.boundingBox(),
        replay: await page.locator(REPLAY).boundingBox(),
      });
      for (const label of ['result.copy_log', 'result.download_log']) {
        if (label === 'result.download_log') {
          await Promise.all([page.waitForEvent('download'), copy.click()]);
        }
        await expect(copy).toHaveText(STRINGS[label] as string);
        const measured = await measure();
        // Neither a scroll, nor a second line (a row of buttons is as tall as one button), nor a
        // button pushed out of the row.
        expect(measured.panel).toBeLessThanOrEqual(0);
        expect(measured.row.overflowPx).toBeLessThanOrEqual(0);
        expect(measured.copy?.height).toBe(measured.replay?.height);
        expect(measured.row.height).toBe(measured.replay?.height);
        expect(measured.copy?.height).toBeGreaterThanOrEqual(44);
        expect(measured.replay?.width).toBeGreaterThanOrEqual(44);
      }
    });
  }

  test('« Rejouer » counts the next game in the same session, with no reload', async ({ page }) => {
    await stubClipboard(page, 'resolve');
    await openResult(page);
    await waitForResultActions(page);
    await page.locator(COPY).click();
    await expect(page.locator(COPY)).toHaveText(STRINGS['result.log_copied'] as string);
    const first = parseJournal((await stubbedTexts(page))[0] ?? '');
    expect(first.summary.gameIndexInSession).toBe(1);

    await page.locator(REPLAY).click();
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
    await expect(html(page)).toHaveAttribute('data-pp-flow', 'playing');
    await endLevel(page);
    await waitForResultActions(page);
    // A rebuilt Result screen starts again at « Copier le journal ».
    await expect(page.locator(COPY)).toHaveText(STRINGS['result.copy_log'] as string);
    await page.locator(COPY).click();
    await expect(page.locator(COPY)).toHaveText(STRINGS['result.log_copied'] as string);

    const texts = await stubbedTexts(page);
    expect(texts).toHaveLength(2);
    const second = parseJournal(texts[1] ?? '');
    expect(second.summary.gameIndexInSession).toBe(2);
    expect(second.summary.sessionId).toBe(first.summary.sessionId);
    // A new seed, so a new game.
    expect(second.replay.journal.seed).not.toBe(first.replay.journal.seed);
  });
});
