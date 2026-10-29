import type { TestHost } from '@client/app/testHost';
import { buildJournalFile } from '@client/telemetry/buildJournalFile';
import type { DeviceProbe } from '@client/telemetry/describeDevice';
import { describeDevice } from '@client/telemetry/describeDevice';
import {
  createGameSummary,
  type GameSummaryRecorder,
  type JournalDevice,
} from '@client/telemetry/gameSummary';
import type { CopyLogOutcome } from '@client/ui/screens/resultScreen';
import { JournalSchema } from '@content/schemas/journal';
import type { PlatformTarget } from '@platform/platform';
import { defaultStrictInvariants } from '@shared/invariant';
import { type LogEntry, log } from '@shared/log';

/** The slice of `navigator.clipboard` the journal uses. */
export interface ClipboardLike {
  writeText(text: string): Promise<void>;
}

/** Where `pointerdown` is heard: the window in the app, a double in tests. */
export interface PointerSource {
  addEventListener(
    type: 'pointerdown',
    listener: (event: { pointerType: string }) => void,
    options: { capture: boolean; passive: boolean },
  ): void;
  removeEventListener(
    type: 'pointerdown',
    listener: (event: { pointerType: string }) => void,
    options: { capture: boolean },
  ): void;
}

/**
 * What the journal reads of the browser. Every one but `target` and `autoplay` defaults to the real
 * thing, read at the moment it is needed, so that a unit test never needs a DOM.
 */
export interface PlaytestJournalDeps {
  /** `platform.capabilities.target`. */
  target: PlatformTarget;
  /** The bot that plays the page (`?autoplay=<bot>`), else `null`. */
  autoplay: string | null;
  /** `navigator.clipboard`, `undefined` where the page has none (an insecure context). */
  clipboard?: () => ClipboardLike | undefined;
  /** Hands the text to the browser as a file. May throw. */
  download?: (fileName: string, text: string) => void;
  /** `crypto.getRandomValues`, which fills `bytes` in place: the session id is drawn from it, once. */
  randomValues?: (bytes: Uint8Array<ArrayBuffer>) => void;
  probeDevice?: () => DeviceProbe;
  /** `log.buffer`. */
  logs?: () => readonly LogEntry[];
  /** `defaultStrictInvariants`: the mode the live sim ran with. */
  strictInvariants?: () => boolean;
  pointerSource?: PointerSource;
}

export interface PlaytestJournal {
  /**
   * Builds the journal of the level on screen and copies it, or downloads it when the clipboard
   * refuses. Builds it and calls `writeText` before it returns, so the press that called it is
   * still the gesture the clipboard needs. Never rejects.
   */
  copyLog(): Promise<CopyLogOutcome>;
  dispose(): void;
}

type BrowserDeps = Required<Omit<PlaytestJournalDeps, 'target' | 'autoplay'>>;

/** A temporary `<a download>` over an object URL: no network, so the CSP needs nothing new. */
function downloadText(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // On the next task: WebKit reads the URL after the click returns.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function browserDeps(): BrowserDeps {
  return {
    clipboard: () => navigator.clipboard,
    download: downloadText,
    randomValues: (bytes) => {
      crypto.getRandomValues(bytes);
    },
    probeDevice: () => ({
      userAgent: navigator.userAgent,
      uaDataPlatform:
        (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
          ?.platform ?? null,
      maxTouchPoints: navigator.maxTouchPoints,
      isCoarsePointer: window.matchMedia('(pointer: coarse)').matches,
      shortSidePx: Math.min(window.innerWidth, window.innerHeight),
    }),
    logs: () => log.buffer(),
    strictInvariants: defaultStrictInvariants,
    pointerSource: {
      addEventListener: (type, listener, options) =>
        window.addEventListener(type, listener, options),
      removeEventListener: (type, listener, options) =>
        window.removeEventListener(type, listener, options),
    },
  };
}

/** The name of what a failed call threw, for a log: never its message or stack. */
function failureName(cause: unknown): string {
  return cause instanceof Error ? cause.name : typeof cause;
}

/**
 * Installs the playtest journal (story 3.3): follows the games of the page, and gives the Result
 * screen the action behind « Copier le journal ». Playtest builds only: `boot.ts` loads it at boot,
 * by a dynamic `import()` behind the debug flag, so a press never waits for a chunk and a store
 * build holds none of it. A module that cannot be loaded only costs the button.
 *
 * It keeps one summary recorder per started level (`gameIndexInSession` counts them since the page
 * loaded), fed with the sim events the app handled and the device the player was using, and a
 * `sessionId` drawn once per page load that is never stored. Nothing leaves the page by itself:
 * the tester copies or downloads the text (NFR14).
 */
export function installPlaytestJournal(host: TestHost, deps: PlaytestJournalDeps): PlaytestJournal {
  const browser = browserDeps();
  const clipboard = deps.clipboard ?? browser.clipboard;
  const download = deps.download ?? browser.download;
  const probeDevice = deps.probeDevice ?? browser.probeDevice;
  const logs = deps.logs ?? browser.logs;
  const strictInvariants = deps.strictInvariants ?? browser.strictInvariants;
  const pointerSource = deps.pointerSource ?? browser.pointerSource;
  const randomValues = deps.randomValues ?? browser.randomValues;

  const sessionBytes = new Uint8Array(4);
  randomValues(sessionBytes);
  const sessionId = Array.from(sessionBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  let gameIndexInSession = 0;
  let recorder: GameSummaryRecorder | null = null;
  let lastPointerType: string | null = null;
  // After one refusal the clipboard is not tried again for the life of the page (D7).
  let isDownloadOnly = false;

  /** The device a response is credited to: the last input device, the pointer split by its type (D5). */
  const currentDevice = (): JournalDevice => {
    // The player's input is blocked while a bot plays.
    if (deps.autoplay !== null) return 'none';
    switch (host.lastInputDevice()) {
      case 'keyboard':
        return 'keyboard';
      case 'gamepad':
        return 'gamepad';
      case 'pointer':
        if (lastPointerType === 'mouse') return 'mouse';
        return lastPointerType === 'touch' || lastPointerType === 'pen' ? 'touch' : 'none';
      default:
        return 'none';
    }
  };

  const onPointerDown = (event: { pointerType: string }): void => {
    lastPointerType = event.pointerType;
  };
  pointerSource.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
  const unsubscribeLevel = host.onLevelStarted(() => {
    gameIndexInSession++;
    recorder = createGameSummary({ sessionId, gameIndexInSession, autoplay: deps.autoplay });
  });
  const unsubscribeEvents = host.onSimEvent((event) => {
    if (recorder === null) return;
    const device = currentDevice();
    recorder.onInput(device);
    recorder.onEvent(event, device);
  });

  /** The text and the file name of the level on screen, or `null` (and a warn) when there is none to export. */
  function buildExport(): { text: string; fileName: string } | null {
    const active = host.levelSession.active;
    const summary = recorder?.summary() ?? null;
    if (active === null || summary === null) {
      log.warn('debug', 'no journal to export: no level has been played to its end', {
        hasActiveLevel: active !== null,
        hasSummary: summary !== null,
      });
      return null;
    }
    try {
      const file = buildJournalFile({
        sim: active.sim,
        levelId: active.level.level.id,
        baseContent: host.content,
        strictInvariants: strictInvariants(),
        summary,
        device: describeDevice(probeDevice()),
        target: deps.target,
        logs: logs(),
      });
      const checked = JournalSchema.safeParse(file);
      if (!checked.success) {
        // Our bug, not the tester's: the file is exported all the same (D4).
        log.error('debug', 'the exported journal does not match JournalSchema', {
          issues: checked.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        });
      }
      return {
        text: JSON.stringify(file, null, 2),
        fileName: `papa-parade-journal-${file.replay.levelId}-${file.summary.sessionId}-${file.summary.gameIndexInSession}.json`,
      };
    } catch (cause) {
      log.warn('debug', 'cannot build the journal', { error: failureName(cause) });
      return null;
    }
  }

  function downloadExport(exported: { text: string; fileName: string }): CopyLogOutcome {
    try {
      download(exported.fileName, exported.text);
      return 'downloaded';
    } catch (cause) {
      log.warn('debug', 'the journal download failed', { error: failureName(cause) });
      return 'failed';
    }
  }

  function fallBackOnDownload(
    exported: { text: string; fileName: string },
    cause: unknown,
  ): CopyLogOutcome {
    isDownloadOnly = true;
    log.warn('debug', 'the clipboard refused the journal: downloading it instead', {
      error: failureName(cause),
    });
    return downloadExport(exported);
  }

  return {
    copyLog() {
      const exported = buildExport();
      if (exported === null) return Promise.resolve('failed');
      if (isDownloadOnly) return Promise.resolve(downloadExport(exported));
      let written: Promise<void>;
      try {
        const target = clipboard();
        if (target === undefined) throw new Error('navigator.clipboard is not available');
        // No `await` before this call: the press is the gesture the clipboard is granted in.
        written = target.writeText(exported.text);
      } catch (cause) {
        return Promise.resolve(fallBackOnDownload(exported, cause));
      }
      return written.then(
        (): CopyLogOutcome => 'copied',
        (cause: unknown) => fallBackOnDownload(exported, cause),
      );
    },
    dispose() {
      unsubscribeLevel();
      unsubscribeEvents();
      pointerSource.removeEventListener('pointerdown', onPointerDown, { capture: true });
    },
  };
}
