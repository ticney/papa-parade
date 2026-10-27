import type { AudioBus, FeedbackCue, FeedbackTable } from '@content/schemas/feedback';
import type { Haptics } from '@platform/platform';
import { log } from '@shared/log';
import type { World } from '@sim';
import type { LevelFx } from '../render/levelScene.ts';
import type { FeedbackEventName } from './feedbackEvents.ts';

export interface FeedbackDirectorDeps {
  table: FeedbackTable;
  audio: { playOneShot(clip: string, bus: AudioBus, gainPct: number): void };
  haptics: Haptics;
  /** The current level's effects, `null` outside a level (a scene behind the loading screen is not played on). */
  getScene(): LevelFx | null;
  /** `matchMedia('(prefers-reduced-motion: reduce)').matches` in boot. */
  prefersReducedMotion(): boolean;
  /** Told the id of each cue played (the debug mirror). */
  onCue?(cueId: string): void;
}

export interface FeedbackDirector {
  /**
   * Plays what the table says for `name`: the sound, the vibration, the ring and the camera
   * effect of its cue, in that order, in this very call (response sound and haptic fire at
   * judgement, never deferred). An event the table does not list does nothing. A part that cannot
   * play is skipped and the others still play. `world` is read, never written.
   */
  handle(name: FeedbackEventName, world: Readonly<World> | null): void;
  /**
   * Plays a cue by its id, the way `handle` plays an event's: a threat's def names its cues
   * (`feedback.telegraph`...), not the `events` table (D3 of story 1.11). `threatId` is the threat
   * the cue is about, where a `threat`-anchored ring starts from; with none (or one the world does
   * not know) the ring is skipped with a `warn` and the rest still plays. An unknown id is a
   * `warn` and plays nothing.
   */
  playCue(cueId: string, world: Readonly<World> | null, threatId: number | null): void;
}

interface ResolvedCue {
  readonly id: string;
  readonly cue: FeedbackCue;
}

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Turns events into feedback through `content/feedback.json` (ADR-006): the one place where an
 * event meets its sound, vibration and visuals. It decides nothing about the game: hitstop and
 * slow-mo are sim decisions, never feedback.
 */
export function createFeedbackDirector(deps: FeedbackDirectorDeps): FeedbackDirector {
  const { table, audio, haptics } = deps;
  // Built once: `handle` looks an event up in a Map. An event is not a frame, so what it allocates
  // (the closures of the parts it plays, and what Web Audio makes) is not a hot path.
  const byEvent = new Map<string, ResolvedCue>();
  for (const [name, id] of Object.entries(table.events)) {
    // `hasOwn`: a cue id like `constructor` must not resolve to a member of `Object.prototype`.
    const cue = Object.hasOwn(table.cues, id) ? table.cues[id] : undefined;
    if (cue === undefined) {
      log.warn('feedback', `event ${name} points at the unknown cue ${id}: it plays nothing`);
      continue;
    }
    byEvent.set(name, { id, cue });
  }

  // Anything a cue calls can throw (Web Audio, `navigator.vibrate`, `matchMedia`, a DOM mirror):
  // `handle` runs inside the frame loop, which stops on an exception, so each call is guarded and
  // a part that fails is a `warn` that leaves the others playing.
  const attempt = <T>(name: string, what: string, fallback: T, run: () => T): T => {
    try {
      return run();
    } catch (cause) {
      log.warn('feedback', `feedback ${what} for ${name} failed: ${reasonOf(cause)}`);
      return fallback;
    }
  };

  // Where a ring starts from. A `threat` anchor is the threat the event names, read from the world
  // by id; with none the ring is skipped (the sound and the vibration still play).
  const anchorOf = (
    anchor: 'papa' | 'baby' | 'threat',
    world: Readonly<World>,
    threatId: number | null,
    name: string,
  ): { xM: number; zM: number } | null => {
    if (anchor === 'papa') return world.papa;
    if (anchor === 'baby') return world.baby;
    if (threatId !== null) {
      for (const threat of world.threats) if (threat.id === threatId) return threat;
    }
    log.warn('feedback', `feedback ring for ${name} skipped: no threat to anchor it on`, {
      threatId,
    });
    return null;
  };

  // Plays the parts of one cue: the sound, the vibration, the ring, the camera effect, in that
  // order. `name` is only what a warning calls it by (an event name, or `cue <id>`).
  const play = (
    name: string,
    id: string,
    cue: FeedbackCue,
    world: Readonly<World> | null,
    threatId: number | null,
  ): void => {
    if (cue.audio !== undefined) {
      const { clip, bus, gainPct } = cue.audio;
      attempt(name, 'sound', undefined, () => audio.playOneShot(clip, bus, gainPct));
    }
    if (cue.haptic !== undefined) {
      const kind = cue.haptic;
      attempt(name, 'vibration', undefined, () => haptics.pulse(kind));
    }
    // The visuals need a world to read and a scene to draw on (neither exists for a client event
    // like the countdown tick: `content:check` refuses a visual on such a cue).
    if (world !== null && (cue.visual !== undefined || cue.camera !== undefined)) {
      const scene = attempt(name, 'scene lookup', null, deps.getScene);
      if (scene !== null) {
        if (cue.visual !== undefined) {
          const { anchor, maxRadiusM, durationMs } = cue.visual;
          const at = anchorOf(anchor, world, threatId, name);
          if (at !== null) {
            attempt(name, 'ring', undefined, () =>
              scene.soundWave(at.xM, at.zM, maxRadiusM, durationMs, world.time.sim),
            );
          }
        }
        // A failing motion query counts as reduced motion: the safe side.
        if (
          cue.camera !== undefined &&
          !attempt(name, 'motion query', true, deps.prefersReducedMotion)
        ) {
          const { amplitudeM, durationMs } = cue.camera;
          attempt(name, 'camera effect', undefined, () =>
            scene.shake(amplitudeM, durationMs, world.time.sim),
          );
        }
      }
    }
    const { onCue } = deps;
    if (onCue !== undefined) attempt(name, 'cue report', undefined, () => onCue(id));
  };

  return {
    handle(name, world) {
      const resolved = byEvent.get(name);
      if (resolved === undefined) return;
      play(name, resolved.id, resolved.cue, world, null);
    },
    playCue(cueId, world, threatId) {
      const cue = Object.hasOwn(table.cues, cueId) ? table.cues[cueId] : undefined;
      if (cue === undefined) {
        log.warn('feedback', `cue ${cueId} is not in the feedback table: it plays nothing`);
        return;
      }
      play(`cue ${cueId}`, cueId, cue, world, threatId);
    },
  };
}
