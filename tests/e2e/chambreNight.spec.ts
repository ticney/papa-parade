import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { JournalSchema } from '../../src/content/schemas/journal.ts';
import { STEP_MS } from '../../src/shared/constants.ts';
import { advanceTo, cueIds, shot, typesOf } from './support/duel.ts';
import {
  appUrl,
  collectProblems,
  html,
  OWN_WARNINGS,
  objectIconPoint,
  pagePointOf,
  startLevel,
  threatIconPoint,
  waitForResultActions,
  waitFrames,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';
import {
  ppAdvance,
  ppEvents,
  ppFreeze,
  ppLoadLevel,
  ppSetFeel,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// « Chambre de nuit » (story 4.10): the whole bedtime cycle, on the live level. Frozen with the test
// API (steps by hand) and real input, or in real time for the autoplay. Every bound is read from the
// world or the live content, so nothing here is a number of the live tuning.
const LEVEL = 'chambre_night';
const SEED = 42;
const QUERY = `?level=${LEVEL}`;
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const SEQUENCES = ['stay_awake', 'lullaby_walk', 'bedtime_duel', 'bomb_drop', 'stealth_exit'];
const PANEL = '.pp-result-panel';
const AUTOPLAY_TIMEOUT_MS = 180_000;
// The header comes with the rows, after the photo's hold and Mama's reactions (up to ~5 s; story 3.7).
const SEQUENCE_TIMEOUT_MS = 15_000;
/** A response window long enough to outlast any wait of the toilet test: no threat of it gags before the entry starts (story 3.15). */
const WIDE_WINDOW_MS = 60_000;
/** Above the baby's floor point, where a finger aims at him. */
const BABY_TAP_HEIGHT_M = 0.2;
/** Five steps of a walk are 15 cm at 3 m/s; a jump across the room is metres. */
const MAX_STEP_MOVE_M = 0.5;
/** More than any sequence's `outMs`, in steps, and well under the wait of a retry. */
const FRAMING_OUT_STEPS = 100;

const live = JSON.parse(readFileSync(`content/levels/${LEVEL}.json`, 'utf8')) as {
  cycle: { retryInterludeMs: number; entries: { interludeMs: number }[] };
};
const geometry = JSON.parse(readFileSync(`content/levels/${LEVEL}.geometry.json`, 'utf8')) as {
  zones: { id: string; kind: string; centerM: number[] }[];
};
const CRIB = geometry.zones.find((zone) => zone.kind === 'safe')?.centerM ?? [0, 0, 0];

async function openFrozen(page: Page): Promise<void> {
  await page.goto(appUrl(`/${QUERY}`));
  await waitForTestApi(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
}

/** Steps by hand until `until` holds, in chunks of `chunk` steps. */
async function stepUntil(
  page: Page,
  until: (world: Awaited<ReturnType<typeof ppWorld>>) => boolean,
  chunk = 10,
  maxChunks = 3000,
): Promise<void> {
  for (let i = 0; i < maxChunks; i++) {
    if (until(await ppWorld(page))) return;
    await ppAdvance(page, chunk);
  }
  throw new Error('stepUntil: the condition never held');
}

test.describe('Chambre de nuit', () => {
  test('?level= shows the room; a mistyped id plays the first level and says so', async ({
    page,
  }, testInfo) => {
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    // The smallest landscape phone the UX names: the room must read there.
    await page.setViewportSize({ width: 667, height: 375 });
    // The link alone reaches the room: nothing here loads the level by hand.
    await startLevel(page, QUERY);
    await expect(html(page)).toHaveAttribute('data-pp-level', LEVEL);
    await waitForTestApi(page);
    await ppFreeze(page, true);
    await ppLoadLevel(page, LEVEL, SEED);
    await expect(html(page)).toHaveAttribute('data-pp-cycle-index', '0');
    expect((await ppWorld(page)).cycle.nextAt).toBe(live.cycle.entries[0]?.interludeMs);
    await shot(page, testInfo, 'chambre-night-room.png');
    expect(problems).toEqual([]);

    const warnings: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'warning') warnings.push(message.text());
    });
    await startLevel(page, '?level=chambre_nuit');
    await expect.poll(() => warnings.join()).toContain('ignoring ?level=chambre_nuit');
    // The game's first level (story 9.8: the big room), not the old salon: a mistyped link plays it. The id is
    // typed here on purpose: the constant would pass whatever it holds.
    await expect(html(page)).toHaveAttribute('data-pp-level', 'salon_kitchen');
    await expect(html(page)).not.toHaveAttribute('data-pp-app', 'error');
  });

  test('the perfect bot chains the five sequences and the Result says so', async ({ page }) => {
    test.setTimeout(AUTOPLAY_TIMEOUT_MS + 30_000);
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await page.goto(appUrl(`/${QUERY}&autoplay=perfect&seed=${SEED}&speed=4&debug=1`));
    await waitForTestApi(page);
    await expect(html(page)).toHaveAttribute('data-pp-end-reason', 'cycleDone', {
      timeout: AUTOPLAY_TIMEOUT_MS,
    });
    const started = (await typesOf(page, 'SequenceStarted')) as unknown as { id: string }[];
    expect(started.map((event) => event.id)).toEqual(SEQUENCES);
    await expect(html(page)).toHaveAttribute('data-pp-cycle-index', String(SEQUENCES.length));
    await expect(page.locator(`${PANEL} .pp-result-reason`)).toHaveText(
      STRINGS['result.cycle_done'] as string,
      { timeout: SEQUENCE_TIMEOUT_MS },
    );
    await expect(page.locator(PANEL)).not.toHaveClass(/pp-result-panel-woken/);
    // The end photo is taken whatever the end and the level (story 3.6, D1): the bedroom is the one
    // level that ends on `cycleDone`, and its frozen world is the snapshot the picture is drawn from.
    await expect(html(page)).toHaveAttribute('data-pp-photo', 'taken');
    await expect(page.locator('.pp-polaroid canvas')).toHaveCount(1);

    // The smallest landscape phone the Result was laid out for: its buttons stay on screen.
    await page.setViewportSize({ width: 750, height: 340 });
    await waitForResultActions(page);
    const { scrollPx, heightPx } = await page.locator(PANEL).evaluate((panel) => ({
      scrollPx: panel.scrollHeight,
      heightPx: panel.clientHeight,
    }));
    expect(scrollPx).toBeLessThanOrEqual(heightPx);

    // A restart never shows the last game's entry.
    await page.locator(`${PANEL} .pp-result-actions .pp-button-primary`).click();
    await expect(html(page)).toHaveAttribute('data-pp-cycle-index', '0');
    expect(problems).toEqual([]);
  });

  test('the idle bot never gets there, and the Result shows no such line', async ({ page }) => {
    test.setTimeout(AUTOPLAY_TIMEOUT_MS + 30_000);
    await page.goto(appUrl(`/${QUERY}&autoplay=idle&seed=${SEED}&speed=4&debug=1`));
    await waitForTestApi(page);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'result', {
      timeout: AUTOPLAY_TIMEOUT_MS,
    });
    await expect(html(page)).not.toHaveAttribute('data-pp-end-reason', 'cycleDone');
    await expect(page.locator(PANEL)).not.toContainText(STRINGS['result.cycle_done'] as string);
    expect((await ppWorld(page)).cycle.index).toBe(0);
  });

  test('a lost sequence comes back after retryInterludeMs', async ({ page }) => {
    test.setTimeout(120_000);
    await openFrozen(page);
    await stepUntil(page, (world) => world.flow.state === 'sequence');
    await stepUntil(page, (world) => world.flow.state === 'playing', 20);
    const [ended] = (await typesOf(page, 'SequenceEnded')) as unknown as {
      t: number;
      outcome: string;
    }[];
    expect(ended?.outcome).toBe('failed');
    await expect(html(page)).toHaveAttribute('data-pp-cycle-index', '0');
    const dueAt = (ended?.t as number) + live.cycle.retryInterludeMs;
    expect((await ppWorld(page)).cycle.nextAt).toBe(dueAt);
    await advanceTo(page, dueAt - STEP_MS);
    expect(await typesOf(page, 'SequenceStarted')).toHaveLength(1);
    await stepUntil(page, (world) => world.flow.state === 'sequence');
    expect(await typesOf(page, 'SequenceStarted')).toHaveLength(2);
  });

  test('real input in an interlude: the toilet refused, a cash-in at the crib, the toilet, then a walk back to him', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await openFrozen(page);
    // The outlet is drawn the moment the baby is put down, and a gag while Papa is in the toilet would shock
    // him out of it (story 3.15). Its window is made wide, so that the entry's start (which cancels every
    // threat up) comes before any gag: the test is about the entry waiting for a busy Papa.
    await ppSetFeel(page, { timing: { windowMs: WIDE_WINDOW_MS } });
    await waitFrames(page, 3);
    // Taken early, so that the carry's tick climbs the combo before the first entry is due.
    const baby = (await ppWorld(page)).baby;
    const babyAt = await pagePointOf(page, baby.xM, BABY_TAP_HEIGHT_M, baby.zM, LEVEL);
    await page.touchscreen.tap(babyAt.x, babyAt.y);
    await stepUntil(page, (world) => world.baby.state === 'carried', 5);

    // The toilet refuses a baby in the arms.
    await waitFrames(page, 3);
    const door = await objectIconPoint(page, 'toilet');
    await page.touchscreen.tap(door.x, door.y);
    await ppAdvance(page, 2);
    expect(await typesOf(page, 'ToiletRefused')).toHaveLength(1);

    // A real tap in the crib cashes in, once the carry's tick has climbed the combo.
    await stepUntil(page, (world) => world.combo.multiplier > 1, 10);
    await waitFrames(page, 3);
    const crib = await pagePointOf(page, CRIB[0] as number, 0, CRIB[2] as number, LEVEL);
    await page.touchscreen.tap(crib.x, crib.y);
    await stepUntil(page, (world) => world.baby.state !== 'carried', 5);
    expect(await typesOf(page, 'BabyPutDown')).toMatchObject([{ safe: true }]);
    expect(await typesOf(page, 'ComboCashedIn')).toHaveLength(1);
    expect(await cueIds(page)).toContain('combo_cashed_in');
    expect(await typesOf(page, 'SequenceStarted')).toEqual([]);
    await shot(page, testInfo, 'chambre-night-interlude.png');

    // He is down: the door works now. The entry falls due while Papa is in, and waits for him.
    await waitFrames(page, 3);
    await page.touchscreen.tap(door.x, door.y);
    await stepUntil(page, (world) => world.papa.state === 'onToilet', 5);
    const dueAt = (await ppWorld(page)).cycle.nextAt as number;
    const { busyUntil } = (await ppWorld(page)).papa;
    expect(busyUntil).toBeGreaterThan(dueAt);
    await advanceTo(page, busyUntil - STEP_MS);
    expect(await typesOf(page, 'SequenceStarted')).toEqual([]);

    // Out of the toilet, the gather walks to the baby, with no jump, and takes him before the sequence.
    let previous = await ppWorld(page);
    await stepUntil(
      page,
      (world) => {
        const movedM = Math.hypot(
          world.papa.xM - previous.papa.xM,
          world.papa.zM - previous.papa.zM,
        );
        expect(movedM).toBeLessThan(MAX_STEP_MOVE_M);
        previous = world;
        return world.flow.state === 'sequence';
      },
      5,
    );
    const taken = (await typesOf(page, 'BabyPickedUp')) as unknown as { t: number }[];
    const [started] = (await typesOf(page, 'SequenceStarted')) as unknown as { t: number }[];
    expect(taken).toHaveLength(2);
    expect(taken[1]?.t).toBeLessThan(started?.t as number);
    expect(problems).toEqual([]);
  });

  test('a base threat is parried by a real tap in the first interlude', async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    await openFrozen(page);
    await stepUntil(
      page,
      (world) => world.threats.some((threat) => threat.state === 'windowOpen'),
      5,
    );
    const open = (await ppWorld(page)).threats.find((threat) => threat.state === 'windowOpen');
    await waitFrames(page, 3);
    await shot(page, testInfo, 'chambre-night-threat.png');
    const at = await threatIconPoint(page);
    await page.touchscreen.tap(at.x, at.y);
    await ppAdvance(page, 3);
    const resolved = (await typesOf(page, 'ResponseResolved')) as unknown as {
      threatId: number;
      quality: string;
    }[];
    expect(resolved.map((event) => event.threatId)).toContain(open?.id);
    expect(resolved.every((event) => event.quality !== 'fail')).toBe(true);
    expect(await typesOf(page, 'SequenceStarted')).toEqual([]);
  });

  test('a base threat is parried by a real tap between two sequences, the baby put down', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openFrozen(page);
    // The first sequence is lost with no input: it leaves the baby in the arms.
    await stepUntil(page, (world) => world.flow.state === 'sequence');
    await stepUntil(page, (world) => world.flow.state === 'playing', 20);
    expect((await ppWorld(page)).baby.state).toBe('carried');

    // He fell asleep on the miss: a tap waits for him to wake, and for the framing to go out, so that
    // the crib's point on screen is read with the camera at rest.
    await ppAdvance(page, FRAMING_OUT_STEPS);
    await stepUntil(page, (world) => world.papa.state === 'idle', 5);
    await waitFrames(page, 3);
    const crib = await pagePointOf(page, CRIB[0] as number, 0, CRIB[2] as number, LEVEL);
    await page.touchscreen.tap(crib.x, crib.y);
    await stepUntil(page, (world) => world.baby.state !== 'carried', 5);
    expect(await typesOf(page, 'BabyPutDown')).toMatchObject([{ safe: true }]);

    await stepUntil(
      page,
      (world) =>
        world.flow.state === 'sequence' ||
        world.threats.some((threat) => threat.state === 'windowOpen'),
      5,
    );
    expect(await typesOf(page, 'SequenceStarted')).toHaveLength(1);
    const open = (await ppWorld(page)).threats.find((threat) => threat.state === 'windowOpen');
    expect(open).toBeDefined();
    // A base threat, of a wave: not one of the sequence's, and not a micro-sleep.
    const telegraphs = (await typesOf(page, 'ThreatTelegraphed')) as unknown as {
      threatId: number;
      waveIndex: number;
    }[];
    expect(
      telegraphs.findLast((event) => event.threatId === open?.id)?.waveIndex,
    ).toBeGreaterThanOrEqual(0);
    // A threat's id comes back when it is rearmed: only what this tap resolved counts.
    const resolvedOf = async () =>
      (await typesOf(page, 'ResponseResolved')) as unknown as {
        threatId: number;
        quality: string;
      }[];
    const resolvedBefore = (await resolvedOf()).length;
    await waitFrames(page, 3);
    const at = await threatIconPoint(page);
    await page.touchscreen.tap(at.x, at.y);
    await ppAdvance(page, 3);
    const answered = (await resolvedOf()).slice(resolvedBefore);
    expect(answered.map((event) => event.threatId)).toEqual([open?.id]);
    expect(answered[0]?.quality).not.toBe('fail');
  });

  test('the Copy journal button holds the sequences, and sim:replay accepts the file', async ({
    page,
    browserName,
    context,
  }, testInfo) => {
    test.setTimeout(AUTOPLAY_TIMEOUT_MS + 60_000);
    if (browserName === 'chromium') {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    } else {
      await page.addInitScript(() => {
        const copied: string[] = [];
        Object.assign(window, { __ppCopied: copied });
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: (text: string) => {
              copied.push(text);
              return Promise.resolve();
            },
          },
        });
      });
    }
    await page.goto(appUrl(`/${QUERY}&autoplay=idle&seed=${SEED}&speed=4&debug=1`));
    await waitForTestApi(page);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'result', {
      timeout: AUTOPLAY_TIMEOUT_MS,
    });
    await waitForResultActions(page);
    await page.locator(`${PANEL} .pp-result-actions .pp-button-secondary`).click();
    await expect(page.locator(`${PANEL} .pp-result-actions .pp-button-secondary`)).toHaveText(
      STRINGS['result.log_copied'] as string,
    );
    const text =
      browserName === 'chromium'
        ? await page.evaluate(() => navigator.clipboard.readText())
        : await page.evaluate(
            () => (window as unknown as { __ppCopied: string[] }).__ppCopied[0] ?? '',
          );
    const file = JournalSchema.parse(JSON.parse(text));
    expect(file.replay.levelId).toBe(LEVEL);
    const events = await ppEvents(page);
    expect(file.summary.sequences?.length).toBe(
      events.filter((event) => event.type === 'SequenceEnded').length,
    );
    expect(file.summary.sequences?.[0]?.id).toBe('stay_awake');

    const path = testInfo.outputPath('journal.json');
    writeFileSync(path, text);
    const replayed = spawnSync('npx', ['tsx', 'tools/sim/replaySim.ts', path], {
      cwd: REPO,
      encoding: 'utf8',
      timeout: 120_000,
    });
    expect(replayed.stdout).toContain('replay matches');
    expect(replayed.status).toBe(0);
  });
});
