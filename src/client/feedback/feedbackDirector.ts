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
  // Built once: `handle` looks an event up and allocates nothing but what Web Audio makes.
  const byEvent = new Map<string, ResolvedCue>();
  for (const [name, id] of Object.entries(table.events)) {
    const cue = table.cues[id];
    if (cue !== undefined) byEvent.set(name, { id, cue });
  }

  const part = (name: string, what: string, play: () => void): void => {
    try {
      play();
    } catch (cause) {
      log.warn('feedback', `feedback ${what} for ${name} failed: ${reasonOf(cause)}`);
    }
  };

  return {
    handle(name, world) {
      const resolved = byEvent.get(name);
      if (resolved === undefined) return;
      const { id, cue } = resolved;

      if (cue.audio !== undefined) {
        const { clip, bus, gainPct } = cue.audio;
        part(name, 'sound', () => audio.playOneShot(clip, bus, gainPct));
      }
      if (cue.haptic !== undefined) {
        const kind = cue.haptic;
        part(name, 'vibration', () => haptics.pulse(kind));
      }
      if (cue.visual !== undefined) {
        const { anchor, maxRadiusM, durationMs } = cue.visual;
        const scene = deps.getScene();
        if (world !== null && scene !== null) {
          const at = anchor === 'papa' ? world.papa : world.baby;
          part(name, 'ring', () =>
            scene.soundWave(at.xM, at.zM, maxRadiusM, durationMs, world.time.sim),
          );
        }
      }
      if (cue.camera !== undefined && !deps.prefersReducedMotion()) {
        const { amplitudeM, durationMs } = cue.camera;
        const scene = deps.getScene();
        if (world !== null && scene !== null) {
          part(name, 'camera effect', () => scene.shake(amplitudeM, durationMs, world.time.sim));
        }
      }
      deps.onCue?.(id);
    },
  };
}
