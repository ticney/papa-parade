import type { ActiveLevel, LevelSession, StartedLevel } from '@client/app/levelSession';
import type { InputDevice } from '@client/input/inputMapper';
import { JournalSchema } from '@content/schemas/journal';
import { hashJson } from '@shared/hash';
import { log } from '@shared/log';
import type { SimEvent } from '@sim';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playBotGame } from '../../tests/support/botSupport.ts';
import { createFakeTestHost, type FakeTestHost } from '../../tests/support/fakeTestHost.ts';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  OUTLET,
  testWave,
} from '../../tests/support/testContent.ts';
import {
  type ClipboardLike,
  installPlaytestJournal,
  type PlaytestJournal,
  type PlaytestJournalDeps,
} from './playtestJournal.ts';

const LEVEL_MS = 20_000;
const level = createTestLevel({
  waves: [testWave([OUTLET], { gapMinMs: 4000, gapMaxMs: 4000 })],
  durationMs: LEVEL_MS,
});
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

/** A finished game: its frozen sim and the events the client would have been told. */
async function playFinishedGame(seed = 7) {
  const game = await playBotGame('perfect', seed, { untilSimMs: LEVEL_MS + 1000, level });
  const active = {
    sim: game.sim,
    level,
    geometry: createTestGeometry(),
    feel: createTestContent().feel,
  } as unknown as ActiveLevel;
  const started = {
    sim: game.sim,
    levelId: 'salon_crawler',
    seed,
    level,
    feel: active.feel,
  } as unknown as StartedLevel;
  return { sim: game.sim, events: game.events, active, started };
}

type PointerListener = (event: { pointerType: string }) => void;

function createPointerSource() {
  const listeners = new Set<PointerListener>();
  return {
    addEventListener: vi.fn((_type: 'pointerdown', listener: PointerListener) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: 'pointerdown', listener: PointerListener) => {
      listeners.delete(listener);
    }),
    press: (pointerType: string) => {
      for (const listener of [...listeners]) listener({ pointerType });
    },
    get count() {
      return listeners.size;
    },
  };
}

interface Setup {
  host: FakeTestHost;
  journal: PlaytestJournal;
  writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
  download: ReturnType<typeof vi.fn<(fileName: string, text: string) => void>>;
  pointer: ReturnType<typeof createPointerSource>;
  randomValues: ReturnType<typeof vi.fn>;
  deps: PlaytestJournalDeps;
  game: Awaited<ReturnType<typeof playFinishedGame>>;
  /** Starts the level and tells the client every event, as the app would. */
  play(options?: { lastInput?: InputDevice | null; stopBeforeEnd?: boolean }): void;
}

const disposables: { dispose(): void }[] = [];
afterEach(() => {
  for (const sim of disposables.splice(0)) sim.dispose();
  vi.restoreAllMocks();
});

async function setup(overrides: Partial<PlaytestJournalDeps> = {}): Promise<Setup> {
  const game = await playFinishedGame();
  disposables.push(game.sim);
  const session = { active: game.active } as unknown as LevelSession;
  const host = createFakeTestHost({ levelSession: session });
  const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
  const download = vi.fn<(fileName: string, text: string) => void>();
  const pointer = createPointerSource();
  const randomValues = vi.fn((bytes: Uint8Array<ArrayBuffer>): void => {
    bytes.set([0x0a, 0x1b, 0x2c, 0x3d]);
  });
  const deps: PlaytestJournalDeps = {
    target: 'web',
    autoplay: null,
    clipboard: () => ({ writeText }) satisfies ClipboardLike,
    download,
    randomValues,
    probeDevice: () => ({
      userAgent: IPHONE_UA,
      uaDataPlatform: null,
      maxTouchPoints: 5,
      isCoarsePointer: true,
      shortSidePx: 390,
    }),
    logs: () => [{ atReal: 5, level: 'info', channel: 'boot', message: 'ready' }],
    strictInvariants: () => false,
    pointerSource: pointer,
    ...overrides,
  };
  const journal = installPlaytestJournal(host, deps);
  const play = (options: { lastInput?: InputDevice | null; stopBeforeEnd?: boolean } = {}) => {
    host.setLastInputDevice(options.lastInput === undefined ? null : options.lastInput);
    host.fireLevelStarted(game.started);
    const events: SimEvent[] = options.stopBeforeEnd
      ? game.events.filter((event) => event.type !== 'LevelEnded' && event.type !== 'LevelScored')
      : game.events;
    for (const event of events) host.fireSimEvent(event);
  };
  return { host, journal, writeText, download, pointer, randomValues, deps, game, play };
}

describe('installPlaytestJournal (story 3.3)', () => {
  beforeEach(() => {
    vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    vi.spyOn(log, 'error').mockImplementation(() => undefined);
  });

  describe('copying to the clipboard', () => {
    it('copies a JSON that passes JournalSchema and answers copied', async () => {
      const { journal, writeText, download, play, game } = await setup();
      play();
      await expect(journal.copyLog()).resolves.toBe('copied');
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(download).not.toHaveBeenCalled();
      const text = writeText.mock.calls[0]?.[0] ?? '';
      const file = JournalSchema.parse(JSON.parse(text));
      expect(file.replay.levelId).toBe('salon_crawler');
      expect(file.replay.worldHash).toBe(hashJson(game.sim.world));
      expect(file.replay.strictInvariants).toBe(false);
      expect(file.summary.sessionId).toBe('0a1b2c3d');
      expect(file.summary.gameIndexInSession).toBe(1);
      expect(file.summary.autoplay).toBeNull();
      expect(file.device).toEqual({ type: 'phone', platform: 'ios', target: 'web' });
      expect(file.diagnostics.logs).toEqual([
        { atReal: 5, level: 'info', channel: 'boot', message: 'ready' },
      ]);
    });

    it('writes the text pretty-printed with two spaces', async () => {
      const { journal, writeText, play } = await setup();
      play();
      await journal.copyLog();
      const text = writeText.mock.calls[0]?.[0] ?? '';
      expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2));
    });

    it('calls writeText inside copyLog(), before any await: the gesture is still live', async () => {
      const { journal, writeText, play } = await setup();
      play();
      const pending = journal.copyLog();
      expect(writeText).toHaveBeenCalledTimes(1);
      await pending;
    });

    it('records the strictness the live sim ran with', async () => {
      const strict = await setup({ strictInvariants: () => true });
      strict.play();
      await strict.journal.copyLog();
      const text = strict.writeText.mock.calls[0]?.[0] ?? '';
      expect(JournalSchema.parse(JSON.parse(text)).replay.strictInvariants).toBe(true);
    });

    it('holds nothing of the user-agent, the screen or a date', async () => {
      const { journal, writeText, play } = await setup();
      play();
      await journal.copyLog();
      const text = writeText.mock.calls[0]?.[0] ?? '';
      for (const part of ['Mozilla', 'iPhone', 'AppleWebKit', '18_5', '15E148', '390']) {
        expect(text).not.toContain(part);
      }
      expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    it('can be pressed again: the second press copies again', async () => {
      const { journal, writeText, play } = await setup();
      play();
      await journal.copyLog();
      await journal.copyLog();
      expect(writeText).toHaveBeenCalledTimes(2);
      expect(writeText.mock.calls[1]?.[0]).toBe(writeText.mock.calls[0]?.[0]);
    });
  });

  describe('falling back on a download', () => {
    it('downloads when the clipboard rejects, with the same text, and answers downloaded', async () => {
      const { journal, writeText, download, play } = await setup();
      writeText.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
      play();
      await expect(journal.copyLog()).resolves.toBe('downloaded');
      expect(download).toHaveBeenCalledTimes(1);
      expect(download.mock.calls[0]?.[0]).toBe('papa-parade-journal-salon_crawler-0a1b2c3d-1.json');
      expect(download.mock.calls[0]?.[1]).toBe(writeText.mock.calls[0]?.[0]);
      expect(JournalSchema.safeParse(JSON.parse(download.mock.calls[0]?.[1] ?? '')).success).toBe(
        true,
      );
    });

    it('logs one warn on the debug channel with the error name, and no more', async () => {
      const { journal, writeText, play } = await setup();
      writeText.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
      play();
      await journal.copyLog();
      expect(log.warn).toHaveBeenCalledTimes(1);
      const [channel, , data] = vi.mocked(log.warn).mock.calls[0] ?? [];
      expect(channel).toBe('debug');
      expect(JSON.stringify(data)).toContain('NotAllowedError');
    });

    it('downloads straight away, never trying the clipboard again, from the second press on', async () => {
      const { journal, writeText, download, play } = await setup();
      writeText.mockRejectedValue(new Error('denied'));
      play();
      await journal.copyLog();
      expect(writeText).toHaveBeenCalledTimes(1);
      const pending = journal.copyLog();
      // Still inside the press: no clipboard call, and the file is already on its way.
      expect(download).toHaveBeenCalledTimes(2);
      await expect(pending).resolves.toBe('downloaded');
      await expect(journal.copyLog()).resolves.toBe('downloaded');
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(download).toHaveBeenCalledTimes(3);
      expect(log.warn).toHaveBeenCalledTimes(1);
    });

    it('downloads at once, inside the press, when there is no clipboard (an insecure page)', async () => {
      const { journal, download, play } = await setup({ clipboard: () => undefined });
      play();
      const pending = journal.copyLog();
      expect(download).toHaveBeenCalledTimes(1);
      await expect(pending).resolves.toBe('downloaded');
    });

    it('downloads when writeText throws at once', async () => {
      const { journal, writeText, download, play } = await setup();
      writeText.mockImplementation(() => {
        throw new TypeError('not a function');
      });
      play();
      await expect(journal.copyLog()).resolves.toBe('downloaded');
      expect(download).toHaveBeenCalledTimes(1);
    });

    it('answers failed, and warns, when the download throws; the clipboard is tried again on the next press', async () => {
      const { journal, writeText, download, play } = await setup();
      writeText.mockRejectedValue(new Error('denied'));
      download.mockImplementationOnce(() => {
        throw new Error('blocked');
      });
      play();
      await expect(journal.copyLog()).resolves.toBe('failed');
      expect(log.warn).toHaveBeenCalledTimes(2);
      writeText.mockRejectedValue(new Error('denied'));
      await expect(journal.copyLog()).resolves.toBe('downloaded');
      expect(writeText).toHaveBeenCalledTimes(2);
      // The download worked: from now on the clipboard is not tried.
      await expect(journal.copyLog()).resolves.toBe('downloaded');
      expect(writeText).toHaveBeenCalledTimes(2);
    });

    it('answers failed when there is no clipboard and the download throws', async () => {
      const { journal, download, play } = await setup({ clipboard: () => undefined });
      download.mockImplementation(() => {
        throw new Error('blocked');
      });
      play();
      await expect(journal.copyLog()).resolves.toBe('failed');
    });
  });

  describe('when there is nothing to export', () => {
    it('answers failed and warns when no level is active', async () => {
      const { journal, writeText, download, play, host } = await setup();
      play();
      (host.levelSession as { active: ActiveLevel | null }).active = null;
      await expect(journal.copyLog()).resolves.toBe('failed');
      expect(writeText).not.toHaveBeenCalled();
      expect(download).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalledTimes(1);
    });

    it('answers failed before any level has started', async () => {
      const { journal, writeText } = await setup();
      await expect(journal.copyLog()).resolves.toBe('failed');
      expect(writeText).not.toHaveBeenCalled();
    });

    it('answers failed when the level has not ended', async () => {
      const { journal, writeText, play } = await setup();
      play({ stopBeforeEnd: true });
      await expect(journal.copyLog()).resolves.toBe('failed');
      expect(writeText).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('a file that fails its own schema (D4)', () => {
    it('logs an error with the issues and exports it all the same', async () => {
      const { journal, writeText, play } = await setup({ target: 'toaster' as never });
      play();
      await expect(journal.copyLog()).resolves.toBe('copied');
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(log.error).toHaveBeenCalledTimes(1);
      const [channel, , data] = vi.mocked(log.error).mock.calls[0] ?? [];
      expect(channel).toBe('debug');
      expect(JSON.stringify(data)).toContain('device.target');
    });
  });

  describe('the session and the game index', () => {
    it('draws the session id once, as 8 lowercase hex chars from 4 random bytes', async () => {
      const { journal, randomValues, play, writeText } = await setup();
      expect(randomValues).toHaveBeenCalledTimes(1);
      expect(randomValues.mock.calls[0]?.[0]).toBeInstanceOf(Uint8Array);
      expect(randomValues.mock.calls[0]?.[0]).toHaveLength(4);
      play();
      await journal.copyLog();
      expect(randomValues).toHaveBeenCalledTimes(1);
      const file = JournalSchema.parse(JSON.parse(writeText.mock.calls[0]?.[0] ?? ''));
      expect(file.summary.sessionId).toBe('0a1b2c3d');
    });

    it('counts each started level, with the same session id, and starts each summary afresh', async () => {
      const { journal, writeText, download, play, host, game } = await setup({
        clipboard: () => undefined,
      });
      play();
      await journal.copyLog();
      // « Rejouer »: a new level on the same page. Its events are told again.
      host.fireLevelStarted(game.started);
      for (const event of game.events) host.fireSimEvent(event);
      await journal.copyLog();
      // A third start that never reaches its end.
      host.fireLevelStarted(game.started);
      await expect(journal.copyLog()).resolves.toBe('failed');
      expect(writeText).not.toHaveBeenCalled();
      const names = download.mock.calls.map((call) => call[0]);
      expect(names).toEqual([
        'papa-parade-journal-salon_crawler-0a1b2c3d-1.json',
        'papa-parade-journal-salon_crawler-0a1b2c3d-2.json',
      ]);
      const second = JournalSchema.parse(JSON.parse(download.mock.calls[1]?.[1] ?? ''));
      const first = JournalSchema.parse(JSON.parse(download.mock.calls[0]?.[1] ?? ''));
      expect(second.summary.gameIndexInSession).toBe(2);
      expect(second.summary.sessionId).toBe(first.summary.sessionId);
      // A fresh recorder, not the sum of two games.
      expect(second.summary.responses.timeline).toEqual(first.summary.responses.timeline);
    });
  });

  describe('autoplay', () => {
    it('names the bot, and credits every response to no device', async () => {
      const { journal, writeText, play } = await setup({ autoplay: 'perfect' });
      play({ lastInput: 'pointer' });
      await journal.copyLog();
      const file = JournalSchema.parse(JSON.parse(writeText.mock.calls[0]?.[0] ?? ''));
      expect(file.summary.autoplay).toBe('perfect');
      expect(file.summary.dominantDevice).toBe('none');
      const devices = new Set(file.summary.responses.timeline.map((entry) => entry.device));
      expect([...devices]).toEqual(['none']);
    });
  });

  describe('the device of a response', () => {
    async function devicesFor(
      lastInput: InputDevice | null,
      pointerType?: string,
    ): Promise<string[]> {
      const { journal, writeText, play, pointer } = await setup();
      if (pointerType !== undefined) pointer.press(pointerType);
      play({ lastInput });
      await journal.copyLog();
      const file = JournalSchema.parse(JSON.parse(writeText.mock.calls[0]?.[0] ?? ''));
      expect(file.summary.responses.timeline.length).toBeGreaterThan(0);
      return [...new Set(file.summary.responses.timeline.map((entry) => entry.device))];
    }

    it('splits the pointer by the pointerType of the last pointerdown', async () => {
      expect(await devicesFor('pointer', 'touch')).toEqual(['touch']);
      expect(await devicesFor('pointer', 'pen')).toEqual(['touch']);
      expect(await devicesFor('pointer', 'mouse')).toEqual(['mouse']);
    });

    it('keeps the keyboard and the gamepad as they are', async () => {
      expect(await devicesFor('keyboard')).toEqual(['keyboard']);
      expect(await devicesFor('gamepad')).toEqual(['gamepad']);
    });

    it('credits no device to a pointer whose type was never seen, and to no input at all', async () => {
      expect(await devicesFor('pointer')).toEqual(['none']);
      expect(await devicesFor(null)).toEqual(['none']);
    });

    it('follows the last pointerdown: touch, then mouse', async () => {
      const { journal, writeText, play, pointer } = await setup();
      pointer.press('touch');
      pointer.press('mouse');
      play({ lastInput: 'pointer' });
      await journal.copyLog();
      const file = JournalSchema.parse(JSON.parse(writeText.mock.calls[0]?.[0] ?? ''));
      expect(file.summary.dominantDevice).toBe('mouse');
    });
  });

  describe('listeners', () => {
    it('listens to pointerdown on the window in capture and passive mode', async () => {
      const { pointer } = await setup();
      expect(pointer.addEventListener).toHaveBeenCalledTimes(1);
      expect(pointer.addEventListener).toHaveBeenCalledWith('pointerdown', expect.any(Function), {
        capture: true,
        passive: true,
      });
    });

    it('dispose() removes every listener and subscription', async () => {
      const { journal, pointer, host, writeText, game } = await setup();
      expect(pointer.count).toBe(1);
      journal.dispose();
      expect(pointer.count).toBe(0);
      expect(pointer.removeEventListener).toHaveBeenCalledWith(
        'pointerdown',
        expect.any(Function),
        { capture: true },
      );
      // The host is told nothing the journal listens to any more.
      host.fireLevelStarted(game.started);
      for (const event of game.events) host.fireSimEvent(event);
      await expect(journal.copyLog()).resolves.toBe('failed');
      expect(writeText).not.toHaveBeenCalled();
    });
  });
});
