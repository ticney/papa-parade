import { log } from '@shared/log';
import { asRealMs } from '@shared/time';
import type { AppFsm } from '../app/appFsm.ts';
import type { ActiveLevel } from '../app/levelSession.ts';
import type { PauseController } from '../app/pauseController.ts';
import type { GamepadInput, StickAxes } from './gamepadInput.ts';
import type { FloorPoint, HitTester } from './hitTest.ts';
import type { MoveIntent } from './moveIntent.ts';
import type { PointerSample } from './pointerInput.ts';

export interface InputMapperDeps {
  appFsm: Pick<AppFsm, 'state'>;
  pause: Pick<PauseController, 'state'>;
  /** The level being played, or null. Read at each input, so a stale sim is never kept. */
  getActive(): ActiveLevel | null;
  hitTester: HitTester;
  /** The canvas box on screen, in CSS px. */
  canvasRect(): { left: number; top: number; width: number; height: number };
  /** The movement keys held, tracked at all times. */
  held: ReadonlySet<string>;
  gamepad: GamepadInput;
  moveIntent: MoveIntent;
  /** Shows the tap marker at a point of the floor: called in the handler, drawn by the next frame. */
  showTapMarker(xM: number, zM: number): void;
  /** Told about each accepted tap (the debug build mirrors it for Playwright). */
  onTap?(xM: number, zM: number): void;
  /** Real time now, same base as `event.timeStamp`. */
  nowAtReal(): number;
}

export interface InputMapper {
  /** Whether input reaches the sim: a level is running, not paused, not counting down. */
  isLive(): boolean;
  /** `pointerdown` on the canvas: a tap on the floor. */
  handlePointerDown(sample: PointerSample): void;
  /** The held movement keys changed (keydown, keyup, blur, hidden). */
  onKeysChanged(timeStampAtReal: number): void;
  /** Once per level frame: reads the stick, and sends a direction if it changed. */
  pollGamepad(): void;
  /**
   * Sends what is held right now if it differs from what the sim was last told: after a resume
   * (a key held through the pause walks again, one released during it stops Papa) and when a new
   * level begins (a new sim starts with nothing sent).
   */
  resync(): void;
}

/**
 * Turns raw input into typed, timestamped `SimCommand`s (the sim never sees an event). The gate
 * (D9): only while `appState === 'level'`, the game `running` and a level active. Keys and stick
 * are tracked outside it, so that a resume can send what is held. The calibration offset
 * (`visualOffsetMs`, story 2.7) will be subtracted from the real timestamps here, nowhere else.
 */
export function createInputMapper(deps: InputMapperDeps): InputMapper {
  const stick: StickAxes = { x: 0, y: 0 };
  const picked: FloorPoint = { xM: 0, zM: 0 };
  let boundSim: ActiveLevel['sim'] | null = null;

  const isLive = (): boolean =>
    deps.appFsm.state === 'level' && deps.pause.state === 'running' && deps.getActive() !== null;

  const refreshMove = (atReal: number): void => {
    const active = deps.getActive();
    if (active === null || !isLive()) return;
    if (active.sim !== boundSim) {
      boundSim = active.sim;
      deps.moveIntent.reset();
    }
    deps.moveIntent.update(deps.held, stick, active.timeMap.realToSim(asRealMs(atReal)));
  };

  const pollAndRefresh = (): void => {
    if (!isLive()) return;
    deps.gamepad.poll(stick);
    refreshMove(deps.nowAtReal());
  };

  return {
    isLive,
    handlePointerDown(sample) {
      if (!sample.isPrimary || sample.button !== 0) return;
      const active = deps.getActive();
      if (active === null || !isLive()) {
        if (log.enabled('debug')) log.debug('input', 'tap dropped: no level is live');
        return;
      }
      const rect = deps.canvasRect();
      if (!(rect.width > 0 && rect.height > 0)) return;
      const ndcX = ((sample.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = 1 - ((sample.clientY - rect.top) / rect.height) * 2;
      if (!deps.hitTester.pickFloor(ndcX, ndcY, picked)) return;
      active.sim.enqueue({
        type: 'TapFloor',
        t: active.timeMap.realToSim(asRealMs(sample.timeStamp)),
        xM: picked.xM,
        zM: picked.zM,
      });
      deps.showTapMarker(picked.xM, picked.zM);
      deps.onTap?.(picked.xM, picked.zM);
    },
    onKeysChanged(timeStampAtReal) {
      refreshMove(timeStampAtReal);
    },
    pollGamepad: pollAndRefresh,
    resync: pollAndRefresh,
  };
}
