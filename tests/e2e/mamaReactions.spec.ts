import { expect, type Page, test } from '@playwright/test';
import type { LevelEndReason, MamaReaction } from '../../src/sim/index.ts';
import { mamaReactionsOf } from '../../src/sim/scoring/mamaReactions.ts';
import { calibratedSaveValue, SAVE_STORAGE_KEY } from './support/calibratedSave.ts';
import {
  advanceToEnd,
  collectProblems,
  cueCount,
  html,
  liveFeedback,
  mamaCueOf,
  mirrorWrites,
  passReplayToActions,
  recordMirrorWrites,
  settleAnimations,
  THREATS_OFF,
  waitFrames,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';
import {
  ppAdvance,
  ppCueLog,
  ppEvents,
  ppFreeze,
  ppFx,
  ppLoadLevel,
  ppMamaLines,
  ppSend,
  ppSetFeel,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// Mama's reactions (story 3.7): a laugh, a sigh or a scream between the photo and the rows, each with its line
// in a bubble, its value, her face, a cue on the voice bus and a vibration; and Papa's look, which the gags
// leave on him and which the photo shows. A frozen level is stepped to its end through the test API; the
// reactions expected are computed from the note the sim wrote (`mamaReactionsOf`), never typed here. The
// sequence is followed through `data-pp-result` and a mutation observer on the bubble.

const LEVEL = 'salon_crawler';
const SEED = 42;
const PANEL = '.pp-result-panel';
const MAMA = '.pp-result-mama';
const BUBBLE = '.pp-mum-bubble';
const SHOWN = '.pp-mama--shown';
const REPLAY = `${PANEL} .pp-result-actions .pp-button-primary`;
const SEQUENCE_TIMEOUT_MS = 15_000;
const GRACE_MARGIN_MS = 60;
const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };
const { resultScreen } = liveFeedback;

/** What the page saw each time Mama's bubble changed (a mutation observer, so no polling race). */
interface BubbleShot {
  text: string;
  bubbleClass: string;
  chip: string | null;
  figureClass: string;
  phase: string | null;
}

type End = 'timer' | 'mamaWoke' | 'mamaHome' | 'idleGame';

/** Before the page loads: records every state of the bubble, in order, with the phase it was in. */
async function recordBubble(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const shots: unknown[] = [];
    Object.assign(window, { ppBubbleShots: shots });
    new MutationObserver(() => {
      const text = document.querySelector('.pp-mum-bubble-text')?.textContent ?? '';
      const bubble = document.querySelector('.pp-mum-bubble');
      const chip = document.querySelector('.pp-mum-chip') as HTMLElement | null;
      if (text === '' || bubble === null || chip === null) return;
      const chipText = chip.hidden ? null : chip.textContent;
      const last = shots.at(-1) as { text: string; chip: string | null } | undefined;
      if (last !== undefined && last.text === text && last.chip === chipText) return;
      shots.push({
        text,
        bubbleClass: bubble.className,
        chip: chipText,
        figureClass: document.querySelector('.pp-mama--shown')?.getAttribute('class') ?? '',
        phase: document.documentElement.dataset.ppResult ?? null,
      });
    }).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'hidden'],
    });
  });
}

const bubbleShots = (page: Page): Promise<BubbleShot[]> =>
  page.evaluate(() => [...(window as unknown as { ppBubbleShots: BubbleShot[] }).ppBubbleShots]);

/** Opens a frozen level and steps it to the end asked for. `idleGame` plays the live waves with nobody answering. */
async function openEnd(
  page: Page,
  end: End = 'timer',
  patch?: Parameters<typeof ppSetFeel>[1],
): Promise<void> {
  await page.goto(end === 'idleGame' ? '/' : `/${THREATS_OFF}`);
  await waitForTestApi(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
  if (patch !== undefined) await ppSetFeel(page, patch);
  if (end === 'mamaWoke') {
    await ppSend(page, { type: 'SetNoise', pct: 100 });
    await ppAdvance(page, 1);
  } else if (end === 'mamaHome') {
    await ppSend(page, { type: 'SetCatastrophe', pct: 100 });
    await ppAdvance(page, 1);
  } else {
    await advanceToEnd(page);
  }
  await expect(html(page)).toHaveAttribute('data-pp-app', 'result');
}

/** The note and the end the sim gave, and the reactions the screen must play for them. */
async function expectedReactions(
  page: Page,
): Promise<{ reactions: readonly MamaReaction[]; reason: LevelEndReason }> {
  const world = await ppWorld(page);
  const { final } = world.score;
  const reason = world.flow.endReason;
  if (final === null || reason === null) throw new Error('the level has no note or no end reason');
  return { reactions: mamaReactionsOf(final, reason), reason };
}

/** What a reader gets from a line: its words with no asterisk (the emphasis is an `em` in the bubble, story 3.8). */
const spokenOf = (text: string): string => text.replaceAll('*', '');

/**
 * The lines the page chose for this Result (`__PP__.mamaLines()`, story 3.8): one per reaction, in the same
 * order. The bubble is asserted against them, so this spec does not copy how the product picks a line; the
 * lines a case must give are pinned by id and text in the test that cares.
 */
async function chosenLines(
  page: Page,
  reactions: readonly MamaReaction[],
): Promise<NonNullable<Awaited<ReturnType<typeof ppMamaLines>>>> {
  const lines = await ppMamaLines(page);
  if (lines === null) throw new Error('__PP__.mamaLines() is null: no level was scored');
  expect(lines.map(({ reaction, points }) => ({ reaction, points }))).toEqual(reactions);
  return lines;
}

/** The chip as the player reads it: « +5 », « −3,5 », nothing for a reaction worth 0. */
const chipOf = ({ reaction, points }: MamaReaction): string | null =>
  points > 0 ? `${reaction === 'laugh' ? '+' : '−'}${String(points).replace('.', ',')}` : null;

const mamaCueIds = (): string[] => ['laugh', 'sigh', 'scream'].map((r) => mamaCueOf(r as never));

const waitForInputGrace = (page: Page): Promise<void> =>
  page.waitForTimeout(resultScreen.inputGraceMs + GRACE_MARGIN_MS);

async function waitForActions(page: Page): Promise<void> {
  await passReplayToActions(page, SEQUENCE_TIMEOUT_MS);
  await waitForInputGrace(page);
}

test.describe('Mama’s reactions', () => {
  test('a game with nothing in it still gets her laugh: one reaction, no chip, then the rows', async ({
    page,
  }) => {
    await recordMirrorWrites(page, ['data-pp-result']);
    await recordBubble(page);
    const problems = collectProblems(page);
    // Nothing to sigh at or scream about: no weight to take anything off, and no perfect to laugh at.
    await openEnd(page, 'timer', {
      mama: {
        // The micro-sleep of the fatigue gauge gags even with no threat planned, and shows a part of the look.
        laughPerLookPartPoints: 0,
        sighPerPropOnFloorPoints: 0,
        sighPerBrokenPropPoints: 0,
        sighPerMischiefPoints: 0,
        screamPerNearMissPoints: 0,
      },
    });
    await waitForActions(page);
    const { reactions, reason } = await expectedReactions(page);
    expect(reason).toBe('timer');
    expect(reactions).toEqual([{ reaction: 'laugh', points: 0 }]);
    const lines = await chosenLines(page, reactions);
    // Nothing happened but, at most, the micro-sleep of the fatigue gauge: the generic line or its own (story 3.8).
    const [only] = lines;
    expect(['laugh_any', 'asleep_first']).toContain(only?.lineId);
    expect(only?.text).toBe(
      only?.lineId === 'laugh_any' ? 'Ha ha ! Tous les deux, alors…' : 'Tu dormais debout ?',
    );
    const shots = await bubbleShots(page);
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({ text: spokenOf(only?.text ?? ''), chip: null });
    expect(shots[0]?.bubbleClass).toContain('pp-mum-bubble--laugh');
    expect(shots[0]?.phase).toBe('mama');
    // `timer` is opened with `THREATS_OFF`: no moment to replay, so no `replay` phase (story 3.9).
    expect((await mirrorWrites(page)).map(({ value }) => value)).toEqual([
      'photo',
      'mama',
      'rows',
      'stars',
      'actions',
    ]);
    const cues = (await ppCueLog(page)).map((record) => record.cueId);
    expect(cues.filter((cue) => mamaCueIds().includes(cue))).toEqual([mamaCueOf('laugh')]);
    expect(problems).toEqual([]);
  });

  test('plays the reactions of a live game in order: line, accent, value and cue, each once', async ({
    page,
  }) => {
    await recordBubble(page);
    const problems = collectProblems(page);
    await openEnd(page, 'idleGame');
    await waitForActions(page);
    const { reactions } = await expectedReactions(page);
    expect(reactions.length).toBeGreaterThanOrEqual(1);
    const lines = await chosenLines(page, reactions);
    const shots = await bubbleShots(page);
    expect(shots.map(({ text }) => text)).toEqual(lines.map(({ text }) => spokenOf(text)));
    expect(shots.map(({ chip }) => chip)).toEqual(reactions.map(chipOf));
    for (const [index, shot] of shots.entries()) {
      const { reaction } = reactions[index] as MamaReaction;
      expect(shot.bubbleClass).toContain(`pp-mum-bubble--${reaction}`);
      expect(shot.figureClass).toContain(`pp-mama--${reaction}`);
      expect(shot.phase).toBe('mama');
    }
    const cues = (await ppCueLog(page)).map((record) => record.cueId);
    expect(cues.filter((cue) => mamaCueIds().includes(cue))).toEqual(
      reactions.map(({ reaction }) => mamaCueOf(reaction)),
    );
    // The voice bus, a visual and a vibration each: the cue log says what each drew.
    const played = (await ppCueLog(page)).filter((record) => mamaCueIds().includes(record.cueId));
    for (const record of played) expect(record.visuals).toContain('uiElement');
    expect(problems).toEqual([]);
  });

  test('a woken Mama screams first, with her own line, and the door slams after her', async ({
    page,
  }) => {
    await recordBubble(page);
    await openEnd(page, 'mamaWoke');
    await waitForActions(page);
    const { reactions, reason } = await expectedReactions(page);
    expect(reason).toBe('mamaWoke');
    expect(reactions.map(({ reaction }) => reaction)).toContain('scream');
    // Nothing but the noise happened: her line for a woken Mama, pinned by id and text (story 3.8).
    const lines = await chosenLines(page, reactions);
    expect(lines.at(-1)).toMatchObject({
      lineId: 'scream_woke',
      text: 'Qui fait tout ce bruit ?!',
    });
    const shots = await bubbleShots(page);
    expect(shots.at(-1)?.text).toBe('Qui fait tout ce bruit ?!');
    const cues = (await ppCueLog(page)).map((record) => record.cueId);
    expect(cues.indexOf(mamaCueOf('scream'))).toBeGreaterThan(cues.indexOf('photo_taken'));
    expect(cues.indexOf('mama_woke')).toBeGreaterThan(cues.lastIndexOf(mamaCueOf('scream')));
    // The header is the rows' own, after her.
    await expect(page.locator(`${PANEL} .pp-result-reason`)).toHaveText(
      STRINGS['result.mama_woke'] as string,
    );
  });

  test('a Mama come home early screams before the door slam, with « Mais qu’est-ce qui s’est passé ici ?! »', async ({
    page,
  }) => {
    await recordBubble(page);
    await openEnd(page, 'mamaHome');
    await waitForActions(page);
    const { reactions, reason } = await expectedReactions(page);
    expect(reason).toBe('mamaHome');
    const lines = await chosenLines(page, reactions);
    expect(lines.at(-1)).toMatchObject({
      lineId: 'scream_home',
      text: "Mais qu'est-ce qui s'est passé ici ?!",
    });
    const shots = await bubbleShots(page);
    expect(shots.at(-1)?.text).toBe("Mais qu'est-ce qui s'est passé ici ?!");
    expect(shots.at(-1)?.bubbleClass).toContain('pp-mum-bubble--scream');
    const cues = (await ppCueLog(page)).map((record) => record.cueId);
    expect(cues.indexOf(mamaCueOf('scream'))).toBeGreaterThanOrEqual(0);
    expect(cues.indexOf('mama_home')).toBeGreaterThan(cues.lastIndexOf(mamaCueOf('scream')));
    await expect(page.locator(`${PANEL} .pp-result-reason`)).toHaveText(
      STRINGS['result.mama_home'] as string,
    );
  });

  test('a press during the reactions skips the rest: no new cue, Mama at rest on the last reaction', async ({
    page,
  }) => {
    await recordMirrorWrites(page, ['data-pp-result']);
    await openEnd(page, 'idleGame');
    await expect(html(page)).toHaveAttribute('data-pp-result', 'mama', {
      timeout: SEQUENCE_TIMEOUT_MS,
    });
    const { reactions } = await expectedReactions(page);
    const lines = await chosenLines(page, reactions);
    const cuesBefore = await cueCount(page);
    // No wait for the grace: the photo's hold already outlasted it, and every extra millisecond is taken
    // from the first reaction's hold, which a game with a single reaction has no room for.
    expect(resultScreen.photoHoldMs).toBeGreaterThan(resultScreen.inputGraceMs);
    await page.keyboard.press('Space');
    await expect(html(page)).toHaveAttribute('data-pp-result', 'actions');
    const results = (await mirrorWrites(page)).map(({ value }) => value);
    // The press landed in a reaction (or just after the photo): no rows between it and the buttons.
    expect(results).not.toContain('rows');
    expect(results.at(-1)).toBe('actions');
    expect(await cueCount(page)).toBeLessThanOrEqual(cuesBefore + reactions.length);
    const last = reactions.at(-1) as MamaReaction;
    await expect(page.locator(`${BUBBLE} .pp-mum-bubble-text`)).toHaveText(
      spokenOf(lines.at(-1)?.text ?? ''),
    );
    await expect(page.locator(SHOWN)).toHaveClass(new RegExp(`pp-mama--${last.reaction}`));
    await expect(page.locator(SHOWN)).toHaveClass(/pp-mama--rest/);
    await expect(page.locator(SHOWN)).toHaveCSS('animation-name', 'none');
    const cuesAfterSkip = await cueCount(page);
    await page.waitForTimeout(resultScreen.reactionHoldMs + GRACE_MARGIN_MS);
    expect(await cueCount(page)).toBe(cuesAfterSkip);
  });

  test('a press during the photo skips the reactions altogether: none of her cues play', async ({
    page,
  }) => {
    await openEnd(page);
    await waitForInputGrace(page);
    await page.keyboard.press('Space');
    await expect(html(page)).toHaveAttribute('data-pp-result', 'actions');
    const cues = (await ppCueLog(page)).map((record) => record.cueId);
    expect(cues.filter((cue) => mamaCueIds().includes(cue))).toEqual([]);
    // She is there, at rest, on her last reaction.
    await expect(page.locator(MAMA)).toBeVisible();
    await expect(page.locator(SHOWN)).toHaveClass(/pp-mama--rest/);
  });

  test('a screen rebuilt by the portrait overlay shows the same Mama at rest, with no cue', async ({
    page,
  }) => {
    await recordBubble(page);
    await openEnd(page, 'idleGame');
    await expect(html(page)).toHaveAttribute('data-pp-result', 'rows', {
      timeout: SEQUENCE_TIMEOUT_MS,
    });
    const { reactions } = await expectedReactions(page);
    const lines = await chosenLines(page, reactions);
    const cuesBefore = await cueCount(page);
    await page.setViewportSize(PORTRAIT);
    await expect(page.locator('.pp-portrait-screen')).toBeVisible();
    await page.setViewportSize(LANDSCAPE);
    await expect(page.locator(PANEL)).toBeVisible();
    await expect(html(page)).toHaveAttribute('data-pp-result', 'actions');
    await expect(page.locator(`${BUBBLE} .pp-mum-bubble-text`)).toHaveText(
      spokenOf(lines.at(-1)?.text ?? ''),
    );
    // The same lines, chosen once: the rebuilt screen does not choose again (story 3.8).
    expect(await ppMamaLines(page)).toEqual(lines);
    await expect(page.locator(SHOWN)).toHaveCSS('animation-name', 'none');
    expect(await cueCount(page)).toBe(cuesBefore);
  });

  test('animates the figure of the reaction she plays, briefly and never as a loop', async ({
    page,
  }) => {
    await recordBubble(page);
    await openEnd(page, 'idleGame');
    // While she reacts: the figure of the reaction animates, with an animation of its own.
    await expect(page.locator(SHOWN)).toBeVisible({ timeout: SEQUENCE_TIMEOUT_MS });
    const animation = await page.locator(SHOWN).evaluate((node) => {
      const style = getComputedStyle(node);
      return { name: style.animationName, iterations: style.animationIterationCount };
    });
    expect(animation.name).toMatch(/^pp-mama-(bounce|slump|shake)$/);
    // A finite, short animation: never a loop that could flash.
    expect(animation.iterations).not.toBe('infinite');
  });

  test('under reduced motion she has the expression and no animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await recordBubble(page);
    await openEnd(page, 'idleGame');
    await expect(page.locator(SHOWN)).toBeVisible({ timeout: SEQUENCE_TIMEOUT_MS });
    await expect(page.locator(SHOWN)).toHaveCSS('animation-name', 'none');
    await expect(page.locator(`${BUBBLE} .pp-mum-bubble-text`)).not.toHaveText('');
  });

  test('the bubble is a polite status that shows even with the voice bus at 0', async ({
    page,
  }) => {
    await page.addInitScript(
      ([key, value]) => localStorage.setItem(key as string, value as string),
      [
        SAVE_STORAGE_KEY,
        calibratedSaveValue({}, { volumes: { music: 100, sfx: 100, voice: 0, ui: 100 } }),
      ],
    );
    await recordBubble(page);
    await openEnd(page);
    await expect(page.locator(BUBBLE)).toHaveAttribute('role', 'status');
    await expect(page.locator(BUBBLE)).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator(BUBBLE)).toBeVisible({ timeout: SEQUENCE_TIMEOUT_MS });
    await expect(page.locator(`${BUBBLE} .pp-mum-bubble-text`)).not.toHaveText('');
    // Her drawing is for the eyes only.
    for (const figure of await page.locator('.pp-mama').all()) {
      await expect(figure).toHaveAttribute('aria-hidden', 'true');
    }
  });

  test('the bubble keeps its text at 16 px or more, ink on paper, on the accent bar only', async ({
    page,
  }) => {
    await openEnd(page, 'idleGame');
    await expect(page.locator(BUBBLE)).toBeVisible({ timeout: SEQUENCE_TIMEOUT_MS });
    const look = await page.locator(BUBBLE).evaluate((node) => {
      const style = getComputedStyle(node);
      const text = getComputedStyle(node.querySelector('.pp-mum-bubble-text') as Element);
      const probe = document.createElement('div');
      document.body.append(probe);
      const colorOf = (token: string): string => {
        probe.style.color = `var(${token})`;
        return getComputedStyle(probe).color;
      };
      const result = {
        fontSizePx: Number.parseFloat(text.fontSize),
        textColor: text.color,
        ink: colorOf('--pp-color-ink'),
        sigh: colorOf('--pp-color-mama-sigh'),
        backgroundColor: style.backgroundColor,
        paper: colorOf('--pp-color-paper'),
        borderWidth: style.borderTopWidth,
      };
      probe.remove();
      return result;
    });
    expect(look.fontSizePx).toBeGreaterThanOrEqual(16);
    expect(look.textColor).toBe(look.ink);
    expect(look.textColor).not.toBe(look.sigh);
    expect(look.backgroundColor).toBe(look.paper);
    expect(look.borderWidth).toBe('3px');
  });

  // The woken Mama's header is one line; the home-early header wraps to two on a 360 px panel and the panel
  // then scrolls at 844 × 390 and 750 × 340 by itself (story 3.16, `deferred-work.md`): the panel's fit is
  // measured on the woken end, and Mama's own place on both.
  const FITS: {
    end: 'mamaWoke' | 'mamaHome';
    width: number;
    height: number;
    isPanelHeld: boolean;
  }[] = [
    { end: 'mamaWoke', width: 844, height: 390, isPanelHeld: true },
    { end: 'mamaWoke', width: 667, height: 375, isPanelHeld: true },
    { end: 'mamaWoke', width: 750, height: 340, isPanelHeld: true },
    { end: 'mamaHome', width: 844, height: 390, isPanelHeld: true },
    { end: 'mamaHome', width: 667, height: 375, isPanelHeld: true },
    { end: 'mamaHome', width: 750, height: 340, isPanelHeld: true },
  ];
  for (const { end, isPanelHeld, ...viewport } of FITS) {
    for (const hasPhoto of [true, false]) {
      test(`fits ${viewport.width} × ${viewport.height} ${hasPhoto ? 'with' : 'without'} a photo on a ${end} end, while she reacts and at rest, without scrolling`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        if (!hasPhoto) {
          // The photo canvas has no 2D context; the game's own WebGL canvas is not asked for one.
          await page.addInitScript(() => {
            const original = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function (
              this: HTMLCanvasElement,
              kind: string,
              ...rest: unknown[]
            ) {
              if (kind === '2d') return null;
              return (original as (...args: unknown[]) => unknown).call(this, kind, ...rest);
            } as typeof original;
          });
        }
        await openEnd(page, end);
        const measure = async () =>
          page.evaluate(() => {
            const box = (selector: string) => {
              const rect = (document.querySelector(selector) as Element).getBoundingClientRect();
              return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
            };
            const panel = document.querySelector('.pp-result-panel') as HTMLElement;
            const screen = document.querySelector('.pp-result-screen') as HTMLElement;
            return {
              mama: box('.pp-result-mama'),
              panel: box('.pp-result-panel'),
              panelScrolls: panel.scrollHeight > panel.clientHeight,
              screenScrolls:
                screen.scrollHeight > screen.clientHeight ||
                screen.scrollWidth > screen.clientWidth,
              pageScrolls:
                document.documentElement.scrollWidth > innerWidth ||
                document.documentElement.scrollHeight > innerHeight,
            };
          });
        const check = async (stage: 'mama' | 'actions'): Promise<void> => {
          const layout = await measure();
          expect(layout.mama.left).toBeGreaterThanOrEqual(0);
          expect(layout.mama.top).toBeGreaterThanOrEqual(0);
          expect(layout.mama.bottom).toBeLessThanOrEqual(viewport.height);
          // In the left column, not over the panel.
          expect(layout.mama.right).toBeLessThanOrEqual(layout.panel.left + 1);
          expect(layout.panel.right).toBeLessThanOrEqual(viewport.width);
          // The panel is transparent while she reacts, and its rows have not counted yet: it is measured once the buttons are up.
          if (stage === 'actions' && isPanelHeld) expect(layout.panelScrolls).toBe(false);
          expect(layout.screenScrolls).toBe(false);
          expect(layout.pageScrolls).toBe(false);
        };
        await expect(html(page)).toHaveAttribute('data-pp-result', 'mama', {
          timeout: SEQUENCE_TIMEOUT_MS,
        });
        await expect(page.locator(MAMA)).toBeVisible();
        await check('mama');
        await expect(page.locator('.pp-polaroid')).toHaveCount(hasPhoto ? 1 : 0);
        await waitForActions(page);
        // The header's slam and the stamps are scale animations that widen what scrolls: measure at rest.
        await settleAnimations(page);
        // The heading font loads when the header first shows: with the fallback it wraps to two lines.
        await page.evaluate(() => document.fonts.ready);
        await check('actions');
      });
    }
  }
});

/** The boolean of `world.papa.look` each part a gag shows turns on. */
const LOOK_KEYS = {
  mashOnCheek: 'hasMashOnCheek',
  hairOnEnd: 'hasHairOnEnd',
  shirtInsideOut: 'isShirtInsideOut',
} as const;

test.describe('Papa’s look', () => {
  test('a real gag changes the world’s look, and the view draws it, to the end of the level', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await page.goto('/');
    await waitForTestApi(page);
    await ppFreeze(page, true);
    await ppLoadLevel(page, LEVEL, SEED);
    expect((await ppWorld(page)).papa.look).toEqual({
      hasMashOnCheek: false,
      hasHairOnEnd: false,
      isShirtInsideOut: false,
    });
    // Nobody answers: the live waves gag, and the first gag whose def names a part shows it.
    let part: keyof typeof LOOK_KEYS | null = null;
    for (let chunk = 0; chunk < 120 && part === null; chunk++) {
      if ((await html(page).getAttribute('data-pp-app')) !== 'level') break;
      await ppAdvance(page, 100);
      const change = (await ppEvents(page)).find((event) => event.type === 'PapaLookChanged');
      if (change !== undefined) part = (change as unknown as { part: keyof typeof LOOK_KEYS }).part;
    }
    expect(part, 'no gag of the idle game showed a part of Papa’s look').not.toBeNull();
    const key = LOOK_KEYS[part as keyof typeof LOOK_KEYS];
    expect((await ppWorld(page)).papa.look[key]).toBe(true);
    await waitFrames(page, 3);
    const drawn = (await ppFx(page)).papaLook;
    expect(drawn[key]).toBe(true);
    // What the view draws is the world's look: no part the world does not hold.
    const held = (await ppWorld(page)).papa.look;
    expect(drawn).toEqual(held);
    // It stays: well past the gag's own séquelle (the hair, the daze), the look is still on him.
    if ((await html(page).getAttribute('data-pp-app')) === 'level') {
      await ppAdvance(page, 800);
      if ((await html(page).getAttribute('data-pp-app')) === 'level') {
        await waitFrames(page, 3);
        expect((await ppWorld(page)).papa.look[key]).toBe(true);
        expect((await ppFx(page)).papaLook[key]).toBe(true);
      }
    }
    expect(problems).toEqual([]);
  });

  test('is in the photo: the end frame draws the look the world holds', async ({ page }) => {
    await openEnd(page, 'idleGame');
    const held = (await ppWorld(page)).papa.look;
    await waitFrames(page, 3);
    expect((await ppFx(page)).papaLook).toEqual(held);
    await expect(page.locator('.pp-polaroid canvas')).toHaveCount(1);
  });

  test('keeps the debug overlay: a part the test API asks for shows on top of the world’s', async ({
    page,
  }) => {
    await page.goto(`/${THREATS_OFF}`);
    await waitForTestApi(page);
    await ppFreeze(page, true);
    await ppLoadLevel(page, LEVEL, SEED);
    await page.evaluate(() =>
      window.__PP__?.setPapaLook({
        hasMashOnCheek: true,
        hasHairOnEnd: false,
        isShirtInsideOut: false,
      }),
    );
    await waitFrames(page, 3);
    expect((await ppFx(page)).papaLook.hasMashOnCheek).toBe(true);
    // The world holds nothing: the overlay is the screen's alone.
    expect((await ppWorld(page)).papa.look.hasMashOnCheek).toBe(false);
  });
});

test('« Rejouer » after the reactions starts a fresh level with a clean Papa', async ({ page }) => {
  await openEnd(page, 'idleGame');
  await waitForActions(page);
  await page.locator(REPLAY).click();
  await expect(html(page)).toHaveAttribute('data-pp-app', 'level', {
    timeout: SEQUENCE_TIMEOUT_MS,
  });
  await ppFreeze(page, true);
  expect((await ppWorld(page)).papa.look).toEqual({
    hasMashOnCheek: false,
    hasHairOnEnd: false,
    isShirtInsideOut: false,
  });
});
