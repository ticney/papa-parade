import type { FeedbackTable } from '@content/schemas/feedback';
import type { Feel } from '@content/schemas/feel';
import {
  MUSIC_FILTER_OPEN_HZ,
  MUSIC_START_LEAD_MS,
  MUSIC_STEM_LENGTH_TOLERANCE_MS,
} from '@shared/constants';
import { log } from '@shared/log';
import type { ThreatState } from '@sim';
import type { BusGraph } from './buses.ts';
import type {
  AudioBufferLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  BufferSourceLike,
  GainNodeLike,
} from './webAudio.ts';

// The level music (story 2.6): two stems that start together and stay together, mixed by the
// game's state. The state is computed from the world every frame by the two pure functions below
// (state, not events, like the silence of story 1.21: a pause or a restart cannot leave the music
// tense or slowed) and applied on its edges by `createAdaptiveMusic`.

const TENSE_THREAT_STATES: ReadonlySet<ThreatState> = new Set<ThreatState>([
  'telegraph',
  'windowOpen',
]);

/**
 * True when any threat is in `telegraph` or `windowOpen`: the music gets nervous. `hidden` (the
 * silence's threat), `resolved`, `gag` and `idle` are calm. Allocation-free: it runs every frame.
 */
export function isTensionActive(threats: readonly { readonly state: ThreatState }[]): boolean {
  for (let i = 0; i < threats.length; i++) {
    if (TENSE_THREAT_STATES.has((threats[i] as { state: ThreatState }).state)) return true;
  }
  return false;
}

/** True while the world's effective time scale is under `belowScale` (every slow-mo, not the hitstop). */
export function isSlowMoActive(
  world: { readonly time: { readonly scale: number } },
  belowScale: number,
): boolean {
  return world.time.scale < belowScale;
}

export type MusicFeel = Feel['music'];
export type MusicDef = FeedbackTable['loops']['music'];

export interface AdaptiveMusicDeps {
  readonly context: AudioContextLike;
  readonly graph: BusGraph;
  readonly def: MusicDef;
  /** The decoded buffers, by clip name (the engine's live map). */
  readonly buffers: ReadonlyMap<string, AudioBufferLike>;
  /** Read at each transition, so that a live retuning applies to the next one. */
  readonly getFeel: () => MusicFeel;
  /** The pair started (`true`) or stopped (`false`): once per pair, not per stem. */
  readonly onPlayingChange?: (isPlaying: boolean) => void;
}

export interface AdaptiveMusic {
  readonly isPlaying: boolean;
  /**
   * Starts both stems together, from their beginning, with the gains, filter and rate already at
   * `isTense` / `isSlowed` (no ramp for them: only the music's fade in). Idempotent; never throws.
   */
  start(isTense: boolean, isSlowed: boolean): void;
  /** Fades the music out and stops both stems at the same time. Idempotent; never throws. */
  stop(): void;
  /** The mood changed while the music plays: ramps what changed from where it is. Never throws. */
  applyMood(isTense: boolean, isSlowed: boolean): void;
  /** Forgets that a start failed or a stem was missing (a preload may have decoded it since). */
  clearSkipped(): void;
}

interface Playing {
  readonly sources: readonly BufferSourceLike[];
  readonly calmGain: GainNodeLike;
  readonly tenseGain: GainNodeLike | null;
  readonly filter: BiquadFilterNodeLike;
  readonly fade: GainNodeLike;
  isTense: boolean;
  isSlowed: boolean;
}

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Ramps `param` from where it is to `target` over `durationMs` of audio clock (0 sets it at once).
 * The same pattern as a loop's fade out: cancel, pin the current value, ramp.
 */
function rampTo(param: AudioParamLike, target: number, durationMs: number, nowS: number): void {
  param.cancelScheduledValues(nowS);
  if (durationMs <= 0) {
    param.setValueAtTime(target, nowS);
    return;
  }
  param.setValueAtTime(param.value, nowS);
  param.linearRampToValueAtTime(target, nowS + durationMs / 1000);
}

/**
 * Graph while the music plays: `calmSource → calmGain` and `tenseSource → tenseGain`, both into one
 * low-pass, then one fade gain, then the music bus. One filter and one `playbackRate` for both
 * stems: setting a rate on one stem alone would desynchronise the loop.
 */
export function createAdaptiveMusic(deps: AdaptiveMusicDeps): AdaptiveMusic {
  const { context, graph, def, buffers } = deps;
  let playing: Playing | null = null;
  // A music that cannot play is skipped once, not retried (and warned about) every frame.
  let isSkipped = false;
  let hasWarnedLengths = false;

  const warn = (message: string, cause?: unknown): void => {
    log.warn('audio', message, cause === undefined ? undefined : { cause: reasonOf(cause) });
  };

  const disconnectAll = (nodes: readonly (AudioNodeLike | null)[]): void => {
    for (const node of nodes) {
      try {
        node?.disconnect();
      } catch (cause) {
        warn(`audio node disconnect failed: ${reasonOf(cause)}`, cause);
      }
    }
  };

  const setPlaying = (next: Playing | null): void => {
    const wasPlaying = playing !== null;
    playing = next;
    if (wasPlaying !== (next !== null)) deps.onPlayingChange?.(next !== null);
  };

  return {
    get isPlaying(): boolean {
      return playing !== null;
    },
    clearSkipped() {
      isSkipped = false;
    },
    start(isTense, isSlowed) {
      if (playing !== null || isSkipped) return;
      const calmBuffer = buffers.get(def.stems.calm);
      if (calmBuffer === undefined) {
        // The preload has already warned about this clip: not a new failure.
        isSkipped = true;
        if (log.enabled('debug')) {
          log.debug('audio', `music skipped: ${def.stems.calm} not decoded`);
        }
        return;
      }
      const tenseBuffer = buffers.get(def.stems.tense);
      if (
        tenseBuffer !== undefined &&
        !hasWarnedLengths &&
        Math.abs(tenseBuffer.duration - calmBuffer.duration) * 1000 > MUSIC_STEM_LENGTH_TOLERANCE_MS
      ) {
        hasWarnedLengths = true;
        log.warn('audio', 'music stems differ in length: they will drift', {
          calmS: calmBuffer.duration,
          tenseS: tenseBuffer.duration,
        });
      }
      const feel = deps.getFeel();
      const created: AudioNodeLike[] = [];
      const started: BufferSourceLike[] = [];
      try {
        const track = <T extends AudioNodeLike>(node: T): T => {
          created.push(node);
          return node;
        };
        const fade = track(context.createGain());
        const filter = track(context.createBiquadFilter());
        filter.type = 'lowpass';
        filter.frequency.value = isSlowed ? feel.slowMo.lowpassHz : MUSIC_FILTER_OPEN_HZ;
        const rate = isSlowed ? feel.slowMo.playbackRatePct / 100 : 1;
        const sources: BufferSourceLike[] = [];
        const addStem = (buffer: AudioBufferLike, level: number) => {
          const source = track(context.createBufferSource());
          source.buffer = buffer;
          source.loop = true;
          source.playbackRate.value = rate;
          const gain = track(context.createGain());
          gain.gain.value = level;
          source.connect(gain);
          gain.connect(filter);
          sources.push(source);
          return { source, gain };
        };
        const calm = addStem(
          calmBuffer,
          isTense && tenseBuffer !== undefined ? feel.tense.calmGainPct / 100 : 1,
        );
        const tense = tenseBuffer === undefined ? null : addStem(tenseBuffer, isTense ? 1 : 0);
        filter.connect(fade);
        fade.connect(graph.gains[def.bus]);
        const now = context.currentTime;
        fade.gain.setValueAtTime(0, now);
        // The same `startAtS` for both stems: two `start(0)` calls could land in two render quanta.
        const startAtS = now + MUSIC_START_LEAD_MS / 1000;
        fade.gain.linearRampToValueAtTime(def.gainPct / 100, startAtS + def.fadeMs / 1000);
        for (const source of sources) {
          source.start(startAtS);
          started.push(source);
        }
        setPlaying({
          sources,
          calmGain: calm.gain,
          tenseGain: tense?.gain ?? null,
          filter,
          fade,
          isTense: isTense && tense !== null,
          isSlowed,
        });
      } catch (cause) {
        // Skipped for the level, like a clip that is not decoded: the engine calls `start` every
        // frame it can and must not retry (and warn) 60 times a second.
        isSkipped = true;
        warn(`audio music failed to start: ${reasonOf(cause)}`, cause);
        // A stem already started must not play on alone, and nothing is left orphaned.
        for (const source of started) {
          try {
            source.stop(0);
          } catch (stopCause) {
            warn(`audio music failed to stop: ${reasonOf(stopCause)}`, stopCause);
          }
        }
        disconnectAll(created);
      }
    },
    stop() {
      const current = playing;
      if (current === null) return;
      const { sources, fade } = current;
      try {
        sources.forEach((source, index) => {
          source.onended = () => {
            source.disconnect();
            if (index === 0) {
              fade.disconnect();
              current.filter.disconnect();
              current.calmGain.disconnect();
              current.tenseGain?.disconnect();
            }
          };
        });
        if (context.state === 'running') {
          // Fade out, then stop both at the same time: no click, whatever the music was doing.
          const now = context.currentTime;
          const fadeS = def.fadeMs / 1000;
          fade.gain.cancelScheduledValues(now);
          fade.gain.setValueAtTime(fade.gain.value, now);
          fade.gain.linearRampToValueAtTime(0, now + fadeS);
          for (const source of sources) source.stop(now + fadeS);
        } else {
          // A frozen clock never reaches the end of a fade: the music is silent when the context resumes.
          for (const source of sources) source.stop(0);
        }
      } catch (cause) {
        warn(`audio music failed to stop: ${reasonOf(cause)}`, cause);
        // A source that could not be told to stop must at least not be heard, and not be orphaned.
        disconnectAll([...sources, fade, current.filter, current.calmGain, current.tenseGain]);
      }
      // Forgotten only now, whatever happened: `stop` may run every frame and must not retry.
      setPlaying(null);
    },
    applyMood(isTense, isSlowed) {
      const current = playing;
      if (current === null) return;
      try {
        const feel = deps.getFeel();
        const nowS = context.currentTime;
        if (current.tenseGain !== null && isTense !== current.isTense) {
          current.isTense = isTense;
          const durationMs = isTense ? feel.tense.fadeInMs : feel.tense.fadeOutMs;
          rampTo(current.tenseGain.gain, isTense ? 1 : 0, durationMs, nowS);
          rampTo(
            current.calmGain.gain,
            isTense ? feel.tense.calmGainPct / 100 : 1,
            durationMs,
            nowS,
          );
        }
        if (isSlowed !== current.isSlowed) {
          current.isSlowed = isSlowed;
          const durationMs = isSlowed ? feel.slowMo.inMs : feel.slowMo.outMs;
          rampTo(
            current.filter.frequency,
            isSlowed ? feel.slowMo.lowpassHz : MUSIC_FILTER_OPEN_HZ,
            durationMs,
            nowS,
          );
          // Both stems get the same rate at the same instant, or the loop would drift.
          const rate = isSlowed ? feel.slowMo.playbackRatePct / 100 : 1;
          for (const source of current.sources) {
            rampTo(source.playbackRate, rate, durationMs, nowS);
          }
        }
      } catch (cause) {
        warn(`audio music mood failed: ${reasonOf(cause)}`, cause);
      }
    },
  };
}
