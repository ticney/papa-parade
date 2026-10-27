import { log } from '@shared/log';
import { asRealMs, asSimMs, type SimMs } from '@shared/time';
import type { AppFsm } from '../app/appFsm.ts';
import type { ActiveLevel } from '../app/levelSession.ts';
import type { PauseController } from '../app/pauseController.ts';
import type { GamepadInput, StickAxes } from './gamepadInput.ts';
import type { FloorPoint, HitTester, ThreatTargets } from './hitTest.ts';
import type { MoveIntent } from './moveIntent.ts';
import type { PointerSample } from './pointerInput.ts';
import { createThreatPressTracker } from './threatPress.ts';

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
  /** The threats of the level being played and their icon points, or null outside a level. */
  getThreatTargets(): ThreatTargets | null;
  /** `feel.input.touchRadiusPx`: how far from a threat's icon a press still counts, in CSS px. */
  touchRadiusPx: number;
  /**
   * Told about each press on a threat, in the handler: the client highlights it before the next
   * frame (and the debug build marks the press for the latency check).
   */
  onThreatPressed?(threatId: number): void;
  /** Real time now, same base as `event.timeStamp`. */
  nowAtReal(): number;
}

export interface InputMapper {
  /** Whether input reaches the sim: a level is running, not paused, not counting down. */
  isLive(): boolean;
  /**
   * `pointerdown` on the canvas: a press on a threat's icon (within `touchRadiusPx`), else a tap
   * on the floor. A press on a threat is never also a floor tap.
   */
  handlePointerDown(sample: PointerSample): void;
  /**
   * `pointerup` or `pointercancel` anywhere: the pointer that pressed a threat lets go, so the sim
   * gets a `Release`. Sent even while paused or counting down (a tap's end must not be lost).
   */
  handlePointerUp(sample: PointerSample): void;
  /**
   * A pause was requested while a finger still holds a threat: sends the `Release` now, stamped
   * with the sim clock (the finger's own up will come after the pause, too late to be fair).
   */
  releaseHeld(): void;
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
  /**
   * Forgets what was sent, then sends what is held: a tap made while a key was held replaced the
   * direction walk by a path, and when the path ends the held direction walks again.
   */
  resumeHeld(): void;
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
  const press = createThreatPressTracker();
  // The sim time of the press the tracker holds: a `Release` must not be dated before it (the sim
  // ends only the presses made at or before its `t`).
  let heldPressAt: SimMs = asSimMs(0);

  const isLive = (): boolean =>
    deps.appFsm.state === 'level' && deps.pause.state === 'running' && deps.getActive() !== null;

  // A new level begins with nothing sent and no finger down on a threat of the old one.
  const bindTo = (active: ActiveLevel): void => {
    if (active.sim === boundSim) return;
    boundSim = active.sim;
    deps.moveIntent.reset();
    press.forget();
  };

  // Sends what is held if it changed. `stampOf` gives the command's sim time and is only called
  // when a command is sent, so a frame with nothing new never reads the time map.
  const refreshMove = (stampOf: (active: ActiveLevel) => SimMs): void => {
    const active = deps.getActive();
    if (active === null || !isLive()) return;
    bindTo(active);
    deps.moveIntent.update(deps.held, stick, () => stampOf(active));
  };

  const pollAndRefresh = (): void => {
    if (!isLive()) return;
    deps.gamepad.poll(stick);
    refreshMove((active) => active.timeMap.realToSim(asRealMs(deps.nowAtReal())));
  };

  // After a resume or a new level the loop may not have recorded a frame yet, so the time map
  // cannot be asked: the command is stamped with the sim clock, which is "now" for the sim.
  const resyncNow = (): void => {
    if (!isLive()) return;
    deps.gamepad.poll(stick);
    refreshMove((active) => active.sim.world.time.sim);
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
      bindTo(active);
      const targets = deps.getThreatTargets();
      const threatId =
        targets === null
          ? null
          : deps.hitTester.pickThreat(
              sample.clientX,
              sample.clientY,
              rect,
              targets,
              deps.touchRadiusPx,
            );
      if (threatId !== null) {
        heldPressAt = active.timeMap.realToSim(asRealMs(sample.timeStamp));
        active.sim.enqueue({ type: 'PressThreat', t: heldPressAt, threatId });
        press.pressed(sample.pointerId, threatId);
        deps.onThreatPressed?.(threatId);
        return;
      }
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
    handlePointerUp(sample) {
      const active = deps.getActive();
      if (active === null || deps.appFsm.state !== 'level') return;
      bindTo(active);
      if (!press.released(sample.pointerId)) return;
      active.sim.enqueue({
        type: 'Release',
        t: active.timeMap.realToSim(asRealMs(sample.timeStamp)),
      });
    },
    releaseHeld() {
      const active = deps.getActive();
      if (active === null) return;
      bindTo(active);
      if (!press.releaseAll()) return;
      // The press may be dated a step ahead of the sim clock (it is applied at the next step).
      const simNow = active.sim.world.time.sim;
      active.sim.enqueue({ type: 'Release', t: heldPressAt > simNow ? heldPressAt : simNow });
    },
    onKeysChanged(timeStampAtReal) {
      refreshMove((active) => active.timeMap.realToSim(asRealMs(timeStampAtReal)));
    },
    pollGamepad: pollAndRefresh,
    resync: resyncNow,
    resumeHeld() {
      deps.moveIntent.reset();
      resyncNow();
    },
  };
}
