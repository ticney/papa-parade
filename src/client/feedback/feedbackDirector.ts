import type { AudioBus, FeedbackCue, FeedbackTable } from '@content/schemas/feedback';
import type { Haptics } from '@platform/platform';
import { log } from '@shared/log';
import { asSimMs } from '@shared/time';
import type { SimObjectSpec, World } from '@sim';
import type { LevelFx } from '../render/levelScene.ts';
import type { FeedbackEventName } from './feedbackEvents.ts';

export interface FeedbackDirectorDeps {
  table: FeedbackTable;
  audio: { playOneShot(clip: string, bus: AudioBus, gainPct: number): void };
  haptics: Haptics;
  /** The level's interactive objects (constant): where an `object`-anchored ring starts from (story 1.20). */
  getObjects?(): readonly SimObjectSpec[];
  /** The current level's effects, `null` outside a level (a scene behind the loading screen is not played on). */
  getScene(): LevelFx | null;
  /** `matchMedia('(prefers-reduced-motion: reduce)').matches` in boot. */
  prefersReducedMotion(): boolean;
  /**
   * Draws the cue's screen flash (`pp-screen-flash`, real time) and says whether it did: false when
   * the 3 Hz rule skipped it. `isMotionReduced` asks for the border glow instead.
   */
  flash?(peakOpacityPct: number, durationMs: number, isMotionReduced: boolean): boolean;
  /**
   * Told each visual part that actually ran, once per part: `soundWave` after the ring (once for
   * all the pulses of a wave), `flash` after a flash that was drawn, `uiElement` for the screen
   * element that stands in for the sound. A skipped ring or flash is not reported. Called before `onCue`.
   */
  onVisual?(cueId: string, kind: 'soundWave' | 'flash' | 'uiElement'): void;
  /** Told the id of each cue played, after all its parts (the debug mirror). */
  onCue?(cueId: string): void;
}

export interface FeedbackDirector {
  /**
   * Plays what the table says for `name`: the sound, its layers, the vibration, the ring (its
   * pulses start from the same call), the screen flash and the camera effect of its cue, in that order, in this very call (response sound and haptic fire at
   * judgement, never deferred). An event the table does not list does nothing. A part that cannot
   * play is skipped and the others still play. `world` is read, never written.
   */
  handle(name: FeedbackEventName, world: Readonly<World> | null): void;
  /**
   * Plays a cue by its id, the way `handle` plays an event's: a threat's def names its cues
   * (`feedback.telegraph`...), not the `events` table (D3 of story 1.11), and so does a
   * disruption's (`feedback.ring`, story 1.20 D10). `threatId` is the threat the cue is about, where
   * a `threat`-anchored ring starts from; `objectId` is the object, for an `object`-anchored one.
   * With none (or one the world does not know) the ring is skipped with a `warn` and the rest still
   * plays. An unknown id is a `warn` and plays nothing.
   */
  playCue(
    cueId: string,
    world: Readonly<World> | null,
    threatId: number | null,
    objectId?: string | null,
  ): void;
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
  // by id; an `object` anchor is the object it names, read from the level's objects by id; with
  // none the ring is skipped (the sound and the vibration still play).
  const anchorOf = (
    anchor: 'papa' | 'baby' | 'threat' | 'object',
    world: Readonly<World>,
    threatId: number | null,
    objectId: string | null,
    name: string,
  ): { xM: number; zM: number } | null => {
    if (anchor === 'papa') return world.papa;
    if (anchor === 'baby') return world.baby;
    if (anchor === 'object') {
      if (objectId !== null) {
        const objects = deps.getObjects?.() ?? [];
        for (const object of objects) if (object.id === objectId) return object;
      }
      log.warn('feedback', `feedback ring for ${name} skipped: no object to anchor it on`, {
        objectId,
      });
      return null;
    }
    if (threatId !== null) {
      for (const threat of world.threats) if (threat.id === threatId) return threat;
    }
    log.warn('feedback', `feedback ring for ${name} skipped: no threat to anchor it on`, {
      threatId,
    });
    return null;
  };

  // Plays the parts of one cue: the sound, its layers, the vibration, the ring, the flash, the
  // camera effect, in that order. `name` is only what a warning calls it by (an event name, or `cue <id>`).
  const play = (
    name: string,
    id: string,
    cue: FeedbackCue,
    world: Readonly<World> | null,
    threatId: number | null,
    objectId: string | null,
  ): void => {
    if (cue.audio !== undefined) {
      const { clip, bus, gainPct } = cue.audio;
      attempt(name, 'sound', undefined, () => audio.playOneShot(clip, bus, gainPct));
    }
    // Layers are part of the cue's sound (the baby's laugh on a perfect): same call, array order,
    // each guarded alone. Not cues of their own: no ring, vibration or report.
    for (const layer of cue.layers ?? []) {
      attempt(name, 'sound layer', undefined, () =>
        audio.playOneShot(layer.clip, layer.bus, layer.gainPct),
      );
    }
    if (cue.haptic !== undefined) {
      const kind = cue.haptic;
      attempt(name, 'vibration', undefined, () => haptics.pulse(kind));
    }
    const reportVisual = (kind: 'soundWave' | 'flash' | 'uiElement'): void => {
      const { onVisual } = deps;
      if (onVisual !== undefined)
        attempt(name, 'visual report', undefined, () => onVisual(id, kind));
    };
    // A `uiElement` visual is the screen element that fired the event (a stamped star, story 1.22
    // D6): it is already on screen, so there is nothing to draw here, and nothing to warn about.
    if (cue.visual?.kind === 'uiElement') reportVisual('uiElement');
    const worldVisual = cue.visual?.kind === 'soundWave' ? cue.visual : undefined;
    // The world visuals need a world to read and a scene to draw on (neither exists for a client
    // event like the countdown tick: `content:check` refuses a world visual on such a cue).
    const scene =
      world !== null && (worldVisual !== undefined || cue.camera !== undefined)
        ? attempt(name, 'scene lookup', null, deps.getScene)
        : null;
    if (world !== null && scene !== null && worldVisual !== undefined) {
      const { anchor, maxRadiusM, durationMs, pulses = 1, pulseIntervalMs = 0 } = worldVisual;
      const at = anchorOf(anchor, world, threatId, objectId, name);
      if (at !== null) {
        // The pulses are rings queued on the sim clock: a pause freezes them, a slow-mo slows them.
        const isDrawn = attempt(name, 'ring', false, () => {
          for (let pulse = 0; pulse < pulses; pulse++) {
            const startAt = asSimMs(world.time.sim + pulse * pulseIntervalMs);
            scene.soundWave(at.xM, at.zM, maxRadiusM, durationMs, startAt);
          }
          return true;
        });
        if (isDrawn) reportVisual('soundWave');
      }
    }
    // The flash is a screen effect on real time: no world, no scene. The cue's author decides where
    // it belongs. A failing motion query counts as reduced motion (the glow): the safe side.
    const { flash: drawFlash } = deps;
    if (cue.flash !== undefined && drawFlash !== undefined) {
      const { peakOpacityPct, durationMs } = cue.flash;
      const isMotionReduced = attempt(name, 'motion query', true, deps.prefersReducedMotion);
      const isDrawn = attempt(name, 'flash', false, () =>
        drawFlash(peakOpacityPct, durationMs, isMotionReduced),
      );
      if (isDrawn) reportVisual('flash');
    }
    if (world !== null && scene !== null && cue.camera !== undefined) {
      // A failing motion query counts as reduced motion: the safe side.
      if (!attempt(name, 'motion query', true, deps.prefersReducedMotion)) {
        const { amplitudeM, durationMs } = cue.camera;
        attempt(name, 'camera effect', undefined, () =>
          scene.shake(amplitudeM, durationMs, world.time.sim),
        );
      }
    }
    const { onCue } = deps;
    if (onCue !== undefined) attempt(name, 'cue report', undefined, () => onCue(id));
  };

  return {
    handle(name, world) {
      const resolved = byEvent.get(name);
      if (resolved === undefined) return;
      play(name, resolved.id, resolved.cue, world, null, null);
    },
    playCue(cueId, world, threatId, objectId = null) {
      const cue = Object.hasOwn(table.cues, cueId) ? table.cues[cueId] : undefined;
      if (cue === undefined) {
        log.warn('feedback', `cue ${cueId} is not in the feedback table: it plays nothing`);
        return;
      }
      play(`cue ${cueId}`, cueId, cue, world, threatId, objectId);
    },
  };
}
