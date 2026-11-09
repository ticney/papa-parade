import { PAPA_TARGET_ANCHOR_ID } from '@shared/constants';
import type { SimEvent, World } from '@sim';
import type { LevelFx } from '../render/levelScene.ts';
import { isSignalOnly } from '../render/views/faceInputs.ts';
import { isReliefSuccess } from './reliefSigh.ts';

/**
 * What Papa's response pose is told when it plays (story 7.12, D6): the response and its quality, and the
 * world of the judgement's step, read then (the arrival's world is another): the successes so far (the Parry's
 * variant, D4), whether it scraped through late (the sigh, D5), whether only the signals counted (the guard),
 * and the sim instant the pose plays at (the judgement's step, or the arrival's).
 */
export interface ResponseCue {
  response: string;
  quality: string;
  /** `world.score.successes` in the step of the `ResponseResolved`. */
  successes: number;
  /** A success late in its window, its hidden tolerance included (`isReliefSuccess`). */
  isRelief: boolean;
  /** A duel or stealth step ran at the judgement (`isSignalOnly`). */
  isSignalOnly: boolean;
  /** When the pose plays, a sim time: the judgement's step, or the arrival's `t`. */
  cueAt: number;
}

/**
 * The final pose of a response, played after its sound and haptic (P3 of the architecture: the
 * judgement is at the press, the pose at the arrival). Pure state, one queued threat id: E1 has one
 * active threat at a time, and the structure takes a list if story 1.18 (the waves) needs more.
 */
export interface ResponseChoreography {
  /**
   * Reads one sim event (in order, after the step that emitted it) and starts Papa's response clip
   * and the « lift the baby » hop when they are due. `world` is the live world, read never written.
   */
  onEvent(
    event: SimEvent,
    world: Readonly<World>,
    fx: Pick<LevelFx, 'liftBaby' | 'playResponseClip'>,
  ): void;
  /** A new level: forgets the queued pose. */
  reset(): void;
}

/** Whether the threat stands on Papa (the micro-sleep), not on an anchor of the room. */
function isOnPapa(world: Readonly<World>, threatId: number): boolean {
  for (let i = 0; i < world.threats.length; i++) {
    const threat = world.threats[i] as World['threats'][number];
    if (threat.id === threatId) return threat.anchorId === PAPA_TARGET_ANCHOR_ID;
  }
  return false;
}

const createCue = (): ResponseCue => ({
  response: '',
  quality: '',
  successes: 0,
  isRelief: false,
  isSignalOnly: false,
  cueAt: 0,
});

export function createResponseChoreography(): ResponseChoreography {
  let queuedThreatId: number | null = null;
  /**
   * The cues this choreography fills and hands over, made once (D6): the one of the response judged now,
   * and the one kept for Papa's arrival, so that a response judged meanwhile (the micro-sleep's) leaves it be.
   */
  const cue = createCue();
  const queued = createCue();
  return {
    onEvent(event, world, fx) {
      switch (event.type) {
        case 'ResponseResolved': {
          if (event.quality === 'fail') return;
          // The world of the judgement's step (D6): the arrival's would count later successes.
          cue.response = event.response;
          cue.quality = event.quality;
          cue.successes = world.score.successes;
          cue.isRelief = isReliefSuccess(event, world.feel.characters.relief.lastSharePct);
          cue.isSignalOnly = isSignalOnly(world);
          cue.cueAt = event.t;
          // The micro-sleep is Papa's own business (a threat that stands on him): no baby to lift.
          if (isOnPapa(world, event.threatId)) {
            fx.playResponseClip(cue);
            return;
          }
          // Papa is on his way to this threat: the pose waits for him. Otherwise it plays now.
          if (world.papa.state === 'glide' && world.papa.glide?.threatId === event.threatId) {
            queuedThreatId = event.threatId;
            Object.assign(queued, cue);
          } else {
            fx.playResponseClip(cue);
            fx.liftBaby(world.time.sim);
          }
          return;
        }
        case 'PapaArrived': {
          if (queuedThreatId === null) return;
          queuedThreatId = null;
          queued.cueAt = event.t;
          fx.playResponseClip(queued);
          fx.liftBaby(event.t);
          return;
        }
        case 'PapaStateChanged': {
          // A tap on the floor or a move cancelled the glide: the pose is dropped, not played late.
          if (event.from === 'glide' && event.to !== 'idle') queuedThreatId = null;
          return;
        }
        default:
          return;
      }
    },
    reset() {
      queuedThreatId = null;
    },
  };
}
