import type { SimEvent, World } from '@sim';
import type { LevelFx } from '../render/levelScene.ts';

/**
 * The final pose of a response, played after its sound and haptic (P3 of the architecture: the
 * judgement is at the press, the pose at the arrival). Pure state, one queued threat id: E1 has one
 * active threat at a time, and the structure takes a list if story 1.18 (the waves) needs more.
 */
export interface ResponseChoreography {
  /**
   * Reads one sim event (in order, after the step that emitted it) and starts the provisional
   * « lift the baby » pose when it is due. `world` is the live world, read never written.
   */
  onEvent(event: SimEvent, world: Readonly<World>, fx: Pick<LevelFx, 'liftBaby'>): void;
  /** A new level: forgets the queued pose. */
  reset(): void;
}

export function createResponseChoreography(): ResponseChoreography {
  let queuedThreatId: number | null = null;
  return {
    onEvent(event, world, fx) {
      switch (event.type) {
        case 'ResponseResolved': {
          if (event.quality === 'fail') return;
          // Papa is on his way to this threat: the pose waits for him. Otherwise it plays now.
          if (world.papa.state === 'glide' && world.papa.glide?.threatId === event.threatId) {
            queuedThreatId = event.threatId;
          } else {
            fx.liftBaby(world.time.sim);
          }
          return;
        }
        case 'PapaArrived': {
          if (queuedThreatId === null) return;
          queuedThreatId = null;
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
