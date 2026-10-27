import type { AudioBus, FeedbackTable } from '@content/schemas/feedback';
import { log } from '@shared/log';
import { type AppError, err, ok, type Result } from '@shared/result';
import { loadAudioClip } from '../assets/audioAssets.ts';
import { fetchBytesWithTimeout } from '../assets/loadLevelAssets.ts';
import { unlockAudioContext } from './audioUnlock.ts';
import { type BusGraph, createBusGraph } from './buses.ts';
import type {
  AudioBufferLike,
  AudioContextLike,
  AudioStateName,
  BufferSourceLike,
  GainNodeLike,
} from './webAudio.ts';

export type LoopName = 'babble' | 'music';

export interface AudioEngineOptions {
  table: FeedbackTable;
  /** Default: `new AudioContext({ latencyHint: 'interactive' })`; throws when there is no Web Audio. */
  createContext?: () => AudioContextLike;
  /** Default: `fetchBytesWithTimeout`. */
  fetchBytes?: (url: string) => Promise<Uint8Array>;
  /** Default: `import.meta.env.BASE_URL`. */
  baseUrl?: string;
  /** The context's state changed (the debug mirror). Not called for the initial `none`. */
  onStateChange?: (state: AudioStateName) => void;
  /** A preload settled: how many clips are decoded now (the debug mirror). */
  onClipsDecoded?: (count: number) => void;
  /** A loop started (`true`) or stopped (`false`) (the debug mirror). */
  onLoopChange?: (loop: LoopName, isOn: boolean) => void;
}

export interface AudioEngine {
  /** `none` until `unlock()` has created the context, then the context's own state. */
  readonly state: AudioStateName;
  /** How many clips are decoded. */
  readonly decodedCount: number;
  /**
   * Creates and unlocks the context. Call it synchronously inside the first gesture. Idempotent.
   * An `err` has been logged (`warn`) and leaves the engine silent: every other method is then a no-op.
   */
  unlock(): Result<void, AppError>;
  suspend(): void;
  resume(): void;
  /** Fetches and decodes the clips not decoded yet. Never rejects: a clip that fails is a `warn` and is skipped. */
  preload(clips: readonly string[]): Promise<void>;
  /** Plays a decoded clip once, through `bus`, at the cue's gain times the bus's. */
  playOneShot(clip: string, bus: AudioBus, gainPct: number): void;
  /** The music loop plays from now until `stopLevelLoops()`. Idempotent. */
  startLevelLoops(): void;
  /** Fades both loops out. Idempotent. */
  stopLevelLoops(): void;
  /** Edge-triggered: the babble starts when `isOn` turns `true` and fades out when it turns `false`. Cheap enough for every frame. */
  setBabbling(isOn: boolean): void;
}

interface LoopHandle {
  readonly source: BufferSourceLike;
  readonly gain: GainNodeLike;
}

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

function defaultCreateContext(): AudioContextLike {
  if (typeof AudioContext !== 'function') throw new Error('no Web Audio');
  return new AudioContext({ latencyHint: 'interactive' });
}

/**
 * The game's whole audio: a context unlocked by the first gesture, four buses, decoded buffers, one
 * shots and two loops. It never throws into its caller (an emitter listener or the frame loop):
 * every Web Audio call that can throw or reject is caught here and logged as a `warn` on the
 * `audio` channel, and the game plays on, silent.
 */
export function createAudioEngine(options: AudioEngineOptions): AudioEngine {
  const { table } = options;
  const createContext = options.createContext ?? defaultCreateContext;
  const fetchBytes = options.fetchBytes ?? ((url: string) => fetchBytesWithTimeout(url));
  const baseUrl = options.baseUrl ?? import.meta.env.BASE_URL;

  let context: AudioContextLike | null = null;
  let graph: BusGraph | null = null;
  let unlockError: AppError | null = null;
  const buffers = new Map<string, AudioBufferLike>();
  const inFlight = new Map<string, Promise<void>>();
  let hasWarnedNoContext = false;

  let areLoopsActive = false;
  const loops: Record<LoopName, LoopHandle | null> = { babble: null, music: null };
  // A loop whose clip is not decoded is skipped once, not retried every frame; a preload clears it.
  const skippedLoops = new Set<LoopName>();

  const warn = (message: string, cause?: unknown): void => {
    log.warn('audio', message, cause === undefined ? undefined : { cause: reasonOf(cause) });
  };

  const setLoop = (name: LoopName, handle: LoopHandle | null): void => {
    loops[name] = handle;
    options.onLoopChange?.(name, handle !== null);
  };

  const startLoop = (name: LoopName): void => {
    if (context === null || graph === null || loops[name] !== null || skippedLoops.has(name)) {
      return;
    }
    const def = table.loops[name];
    const buffer = buffers.get(def.clip);
    if (buffer === undefined) {
      // The preload has already warned about this clip: not a new failure.
      skippedLoops.add(name);
      if (log.enabled('debug')) log.debug('audio', `loop ${name} skipped: ${def.clip} not decoded`);
      return;
    }
    try {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = context.createGain();
      const targetGain = def.gainPct / 100;
      const now = context.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(targetGain, now + def.fadeMs / 1000);
      source.connect(gain);
      gain.connect(graph.gains[def.bus]);
      source.start(0);
      setLoop(name, { source, gain });
    } catch (cause) {
      warn(`audio loop ${name} failed to start: ${reasonOf(cause)}`, cause);
    }
  };

  const stopLoop = (name: LoopName): void => {
    const handle = loops[name];
    if (handle === null || context === null) return;
    setLoop(name, null);
    try {
      const { source, gain } = handle;
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
      };
      if (context.state === 'running') {
        // Fade out, then stop: no click, whatever the loop was playing.
        const now = context.currentTime;
        const fadeS = table.loops[name].fadeMs / 1000;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + fadeS);
        source.stop(now + fadeS);
      } else {
        // A frozen clock never reaches the end of a fade: the loop is silent when the context resumes.
        source.stop(0);
      }
    } catch (cause) {
      warn(`audio loop ${name} failed to stop: ${reasonOf(cause)}`, cause);
    }
  };

  const decodeClip = (clip: string, ctx: AudioContextLike): Promise<void> => {
    const pending = inFlight.get(clip);
    if (pending !== undefined) return pending;
    const work = loadAudioClip(clip, {
      fetchBytes,
      decode: (data) => ctx.decodeAudioData(data),
      baseUrl,
    })
      .then((result) => {
        if (result.ok) buffers.set(clip, result.value);
        else warn(`audio clip ${clip} unavailable: ${result.error.message}`, result.error.cause);
      })
      .finally(() => {
        inFlight.delete(clip);
      });
    inFlight.set(clip, work);
    return work;
  };

  return {
    get state(): AudioStateName {
      return context === null ? 'none' : context.state;
    },
    get decodedCount(): number {
      return buffers.size;
    },
    unlock() {
      if (context !== null) return ok(undefined);
      if (unlockError !== null) return err(unlockError);
      const unlocked = unlockAudioContext(createContext);
      if (!unlocked.ok) {
        unlockError = unlocked.error;
        warn(unlocked.error.message, unlocked.error.cause);
        return err(unlocked.error);
      }
      const ctx = unlocked.value;
      try {
        graph = createBusGraph(ctx, table.buses);
        ctx.addEventListener('statechange', () => {
          log.info('audio', `audio state ${ctx.state}`);
          options.onStateChange?.(ctx.state);
        });
      } catch (cause) {
        unlockError = {
          kind: 'audio',
          message: `audio unlock failed: ${reasonOf(cause)}`,
          cause,
        };
        warn(unlockError.message, cause);
        return err(unlockError);
      }
      context = ctx;
      log.info('audio', `audio state ${ctx.state}`, { baseLatencyS: ctx.baseLatency });
      options.onStateChange?.(ctx.state);
      return ok(undefined);
    },
    suspend() {
      if (context === null || context.state === 'closed') return;
      try {
        void context.suspend().catch((cause: unknown) => {
          warn(`audio suspend failed: ${reasonOf(cause)}`, cause);
        });
      } catch (cause) {
        warn(`audio suspend failed: ${reasonOf(cause)}`, cause);
      }
    },
    resume() {
      if (context === null || context.state === 'closed') return;
      try {
        void context.resume().catch((cause: unknown) => {
          warn(`audio resume failed: ${reasonOf(cause)}`, cause);
        });
      } catch (cause) {
        warn(`audio resume failed: ${reasonOf(cause)}`, cause);
      }
    },
    async preload(clips) {
      const ctx = context;
      if (ctx === null) {
        if (!hasWarnedNoContext) {
          hasWarnedNoContext = true;
          warn('audio preload skipped: no audio context, the game is silent');
        }
        return;
      }
      try {
        await Promise.all(
          clips.filter((clip) => !buffers.has(clip)).map((clip) => decodeClip(clip, ctx)),
        );
      } catch (cause) {
        // `decodeClip` handles each clip's failure; this is a bug in the engine, still not the level's.
        warn(`audio preload failed: ${reasonOf(cause)}`, cause);
      }
      skippedLoops.clear();
      options.onClipsDecoded?.(buffers.size);
    },
    playOneShot(clip, bus, gainPct) {
      if (context === null || graph === null) return;
      const buffer = buffers.get(clip);
      if (buffer === undefined) {
        if (log.enabled('debug')) log.debug('audio', `one-shot skipped: ${clip} not decoded`);
        return;
      }
      try {
        const source = context.createBufferSource();
        source.buffer = buffer;
        const gain = context.createGain();
        gain.gain.value = gainPct / 100;
        source.connect(gain);
        gain.connect(graph.gains[bus]);
        source.onended = () => {
          source.disconnect();
          gain.disconnect();
        };
        source.start(0);
      } catch (cause) {
        warn(`audio one-shot ${clip} failed: ${reasonOf(cause)}`, cause);
      }
    },
    startLevelLoops() {
      if (areLoopsActive) return;
      areLoopsActive = true;
      startLoop('music');
    },
    stopLevelLoops() {
      areLoopsActive = false;
      stopLoop('music');
      stopLoop('babble');
    },
    setBabbling(isOn) {
      // Called every frame: the common case is a boolean compare and nothing else.
      if (isOn === (loops.babble !== null)) return;
      if (isOn) {
        if (areLoopsActive) startLoop('babble');
      } else {
        stopLoop('babble');
      }
    },
  };
}
