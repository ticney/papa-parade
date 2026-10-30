import type { Feel } from '@content/schemas/feel';
import { GAMEPAD_PRESS_ID, KEYBOARD_PRESS_ID } from '@shared/constants';
import { log } from '@shared/log';
import { asRealMs, asSimMs, type SimMs } from '@shared/time';
import { isPapaBusy } from '@sim';
import type { AppFsm } from '../app/appFsm.ts';
import type { ActiveLevel } from '../app/levelSession.ts';
import type { PauseController } from '../app/pauseController.ts';
import { pickAutoTarget } from './autoTarget.ts';
import { pickContextObject } from './contextObject.ts';
import {
  createPadState,
  type GamepadInput,
  PAD_BUTTONS,
  type PadButton,
  type PadFamily,
  type StickAxes,
} from './gamepadInput.ts';
import type { FloorPoint, HitTester, ObjectTarget, ThreatTargets } from './hitTest.ts';
import { type MenuStickMemory, stickToMenuStep } from './menuStep.ts';
import type { FloorDir } from './moveDirection.ts';
import type { MoveIntent } from './moveIntent.ts';
import type { PointerSample } from './pointerInput.ts';
import { createThreatPressTracker } from './threatPress.ts';

/** An object must be this much nearer (CSS px) than the baby to win his tap: a tie goes to him. */
const STRICTLY_NEARER_PX = 1e-6;

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
  /** `feel.input.objectTouchRadiusPx`: how far from an object's icon point a press still counts, in CSS px. */
  objectTouchRadiusPx: number;
  /**
   * Told about each press on a threat, in the handler: the client highlights it before the next
   * frame (and the debug build marks the press for the latency check).
   */
  onThreatPressed?(threatId: number): void;
  /**
   * `feel.input`: the auto-target cone, the reach of the context action and the stick's deadzone,
   * read at each use so that a changed feel applies at once.
   */
  input: Pick<Feel['input'], 'autoTargetConeDeg' | 'contextReachM' | 'stickDeadzonePct'>;
  /**
   * `feel.baby.bodyRadiusM`: the baby's centre is this high above the floor, for the touch hit test
   * (story 1.21). Read at each tap.
   */
  babyBodyRadiusM: number;
  /**
   * How high above the floor a tap aims at the baby while Papa carries him (story 4.1): where he is
   * drawn, in Papa's arms. Read at each tap.
   */
  babyCarriedHeightM: number;
  /**
   * How far in front of Papa, along the baby's gaze, the carried baby is drawn (story 4.1): a tap
   * aims there, not at Papa's feet axis. Read at each tap.
   */
  babyCarriedForwardM: number;
  /** The interactive objects of the level being played (`sim.objects`), or an empty list. */
  getObjects(): readonly ObjectTarget[];
  /**
   * A button of the pad went down that the mapper does not act on: any button outside play, and in
   * play every one but A (Start, B, the D-pad). The UI shell routes it (pause, menus). `atReal` is
   * the edge's own stamp (the calibration counts A as a tap, story 2.7).
   */
  onPadButton?(button: PadButton, atReal: number): void;
  /** The pad appeared (`true`) or went away (`false`), seen by the poll. */
  onPadPresence?(isPresent: boolean, family: PadFamily): void;
  /** Real time now, same base as `event.timeStamp`. */
  nowAtReal(): number;
  /**
   * The calibrated screen latency, in ms, subtracted from every input stamp (story 2.7): 0 for a
   * player who has not calibrated, in which case no stamp moves. Read at each input, so a
   * recalibration applies to the very next one.
   */
  visualOffsetMs(): number;
}

/** The device that gave the last input: it decides whether the auto-target is shown (D8). */
export type InputDevice = 'pointer' | 'keyboard' | 'gamepad';

export interface InputMapper {
  /** Whether input reaches the sim: a level is running, not paused, not counting down. */
  isLive(): boolean;
  /**
   * `pointerdown` on the canvas: a press on a threat's icon (within `touchRadiusPx`), else a tap on
   * the baby (within `objectTouchRadiusPx` of his centre, `TapBaby`, story 1.21) or on an object
   * (within `objectTouchRadiusPx`), whichever is nearer to the finger, else a tap on the floor. A press on a threat or an
   * object is never also a floor tap. Dropped while Papa is busy (drinking or asleep).
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
  /**
   * The action key went down or up (Space, or A on a pad): while live, the down parries the
   * auto-targeted threat or, with no threat active, walks Papa to the nearest object in reach; the
   * up releases a press this device made. `timeStampAtReal` is the event's (a pad's: D5).
   */
  handleAction(phase: 'down' | 'up', timeStampAtReal: number, device: 'keyboard' | 'gamepad'): void;
  /** The device of the last input, or null before any: the auto-target shows for keyboard and gamepad only. */
  readonly lastDevice: InputDevice | null;
  /**
   * The threat Space or A would parry now, or null (also when no level is live). Recomputed from
   * the live world with the aim of the held keys or stick; allocation-free, read once per frame.
   */
  targetedThreatId(): number | null;
  /** The family of the pad last seen (glyphs): Xbox until a pad says otherwise. */
  readonly padFamily: PadFamily;
  /**
   * Once per frame, in a level or not: reads the pad (presence, buttons, stick). The stick walks
   * only while live; A acts only while live; the other buttons, and every one outside play, go to
   * `onPadButton`.
   */
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
 * (`visualOffsetMs`, story 2.7) is subtracted from the real timestamps here, nowhere else, and from
 * every one: a press, a release, a key, an action. A corrected press with a raw release would add
 * the offset to every hold.
 */
export function createInputMapper(deps: InputMapperDeps): InputMapper {
  const stick: StickAxes = { x: 0, y: 0 };
  const padState = createPadState();
  const aim: FloorDir = { x: 0, z: 0 };
  const picked: FloorPoint = { xM: 0, zM: 0 };
  /** The point a tap on the baby aims at: his floor point, or where he is drawn when carried. */
  const babyAim: FloorPoint = { xM: 0, zM: 0 };
  let lastDevice: InputDevice | null = null;
  let wasPadPresent = false;
  let wasStickPushed = false;
  const menuStick: MenuStickMemory = { isActive: false };
  let family: PadFamily = 'xbox';
  let boundSim: ActiveLevel['sim'] | null = null;
  const press = createThreatPressTracker();
  // The sim time of the press the tracker holds: a `Release` must not be dated before it (the sim
  // ends only the presses made at or before its `t`).
  let heldPressAt: SimMs = asSimMs(0);

  // The one conversion of a real input stamp into the sim's time, corrected by the calibrated
  // screen latency (ADR-003). `simClockStamp` (the sim's own clock, after a resume) is not an input
  // stamp and stays uncorrected.
  const toSim = (active: ActiveLevel, atReal: number): SimMs =>
    active.timeMap.realToSim(asRealMs(atReal - deps.visualOffsetMs()));

  // Live: in a level, running, and the level still playing (a level that has ended takes no input).
  const isLive = (): boolean => {
    if (deps.appFsm.state !== 'level' || deps.pause.state !== 'running') return false;
    const active = deps.getActive();
    return active !== null && active.sim.world.flow.state === 'playing';
  };

  // Papa drinks, sleeps or is on the phone (stories 1.19 D6, 1.20): the sim ignores every move and
  // press meanwhile, so the client sends none either. A key held through it walks again on `PapaStateChanged → idle`
  // (boot calls `resumeHeld`).
  const isBusy = (active: ActiveLevel): boolean => isPapaBusy(active.sim.world.papa);

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
    if (isBusy(active)) {
      // Only a move that was asked for is worth a line: this runs every frame.
      if (log.enabled('debug') && (deps.held.size > 0 || stick.x !== 0 || stick.y !== 0)) {
        log.debug('input', 'move dropped: Papa is busy');
      }
      return;
    }
    deps.moveIntent.update(deps.held, stick, () => stampOf(active));
  };

  // The threat Space or A parries, from the live world and the aim (D1, D4). Null when none is active.
  const targetNow = (active: ActiveLevel): number | null => {
    const { world } = active.sim;
    const hasAim = deps.moveIntent.aimDir(aim);
    return pickAutoTarget(
      world.threats,
      world.papa.xM,
      world.papa.zM,
      hasAim ? aim : null,
      deps.input.autoTargetConeDeg,
    );
  };

  // A `Release` dated before the press it ends is not what the sim ends (it ends the presses made at
  // or before its `t`): a late, older stamp is clamped to the press.
  const releaseStamp = (t: SimMs): SimMs => (t < heldPressAt ? heldPressAt : t);

  // `stampOf` gives the command's sim time: the event's own, or the sim clock after a resume.
  const act = (
    phase: 'down' | 'up',
    stampOf: (active: ActiveLevel) => SimMs,
    device: 'keyboard' | 'gamepad',
  ): void => {
    const pressId = device === 'keyboard' ? KEYBOARD_PRESS_ID : GAMEPAD_PRESS_ID;
    const active = deps.getActive();
    if (phase === 'up') {
      // Sent even while paused or counting down, like a finger's end; nothing if it pressed nothing.
      if (active === null || deps.appFsm.state !== 'level') return;
      bindTo(active);
      if (!press.released(pressId)) return;
      active.sim.enqueue({ type: 'Release', t: releaseStamp(stampOf(active)) });
      return;
    }
    lastDevice = device;
    if (active === null || !isLive()) {
      if (log.enabled('debug')) log.debug('input', 'action dropped: no level is live');
      return;
    }
    bindTo(active);
    if (isBusy(active)) {
      if (log.enabled('debug')) log.debug('input', 'action dropped: Papa is busy');
      return;
    }
    const t = stampOf(active);
    const threatId = targetNow(active);
    if (threatId !== null) {
      heldPressAt = t;
      active.sim.enqueue({ type: 'PressThreat', t, threatId });
      press.pressed(pressId, threatId);
      deps.onThreatPressed?.(threatId);
      return;
    }
    // No threat is active (D6): the context action, on the nearer of the baby and the nearest
    // object, both in reach (story 1.21: ties go to the baby; story 4.1: not while he is carried).
    const { papa, baby } = active.sim.world;
    const { contextReachM } = deps.input;
    const objects = deps.getObjects();
    const objectId = pickContextObject(objects, papa.xM, papa.zM, contextReachM);
    const babyDistSq = (baby.xM - papa.xM) ** 2 + (baby.zM - papa.zM) ** 2;
    const isBabyInReach = babyDistSq <= contextReachM * contextReachM;
    const object = objectId === null ? undefined : objects.find((o) => o.id === objectId);
    const objectDistSq =
      object === undefined
        ? Number.POSITIVE_INFINITY
        : (object.xM - papa.xM) ** 2 + (object.zM - papa.zM) ** 2;
    // A carried baby is always in reach, so an object in reach wins over him (story 4.1): the coffee
    // machine and the phone must stay usable from the keyboard. Without one, the action puts him down.
    const isCarried = baby.state === 'carried';
    if (isBabyInReach && (isCarried ? objectId === null : babyDistSq <= objectDistSq)) {
      active.sim.enqueue({ type: 'TapBaby', t });
      return;
    }
    if (objectId === null) {
      if (log.enabled('debug')) log.debug('input', 'action: no threat, baby or object in reach');
      return;
    }
    active.sim.enqueue({ type: 'TapObject', t, objectId });
  };

  const handleAction = (
    phase: 'down' | 'up',
    timeStampAtReal: number,
    device: 'keyboard' | 'gamepad',
  ): void => act(phase, (active) => toSim(active, timeStampAtReal), device);

  // The stamps of the pad's commands, as functions made once (the poll runs every frame).
  const simClockStamp = (active: ActiveLevel): SimMs => active.sim.world.time.sim;
  const nowStamp = (active: ActiveLevel): SimMs => toSim(active, deps.nowAtReal());
  const padEdgeStamp = (active: ActiveLevel): SimMs => toSim(active, padState.stampAtReal);

  // Reads the pad: its presence, its stick (into `stick`) and its button edges. Runs outside play
  // too (menus). In play the stick refreshes the walk, then A acts; everything else goes to the shell.
  // After a resume the time map may have no frame yet: the walk and A's edges are then stamped with
  // the sim clock (`isResync`), which is "now" for the sim.
  const readPad = (isResync: boolean): void => {
    deps.gamepad.poll(stick, padState);
    family = padState.family;
    if (padState.isPresent !== wasPadPresent) {
      wasPadPresent = padState.isPresent;
      deps.onPadPresence?.(padState.isPresent, family);
    }
    const isLiveNow = isLive();
    if (isLiveNow) refreshMove(isResync ? simClockStamp : nowStamp);
    // The stick makes the pad "the device" when it is pushed out of the deadzone, not for as long as
    // it stays there: a drifting pad must not take the target back after each tap or key.
    const isStickPushed =
      padState.isPresent && Math.hypot(stick.x, stick.y) * 100 > deps.input.stickDeadzonePct;
    if (isStickPushed && !wasStickPushed) lastDevice = 'gamepad';
    wasStickPushed = isStickPushed;
    // The stick also moves a menu's focus, one step per push; its memory follows it in play too, so
    // that a stick held while the game pauses does not step the moment the panel shows.
    const step = padState.isPresent
      ? stickToMenuStep(stick, menuStick, deps.input.stickDeadzonePct)
      : null;
    if (step !== null && !isLiveNow) deps.onPadButton?.(step, deps.nowAtReal());
    const edgeStampOf = isResync ? simClockStamp : padEdgeStamp;
    for (let i = 0; i < PAD_BUTTONS.length; i++) {
      const button = PAD_BUTTONS[i] as PadButton;
      if (padState.released[button] && button === 'confirm') {
        act('up', edgeStampOf, 'gamepad');
      }
      if (!padState.pressed[button]) continue;
      lastDevice = 'gamepad';
      if (button === 'confirm' && isLiveNow) act('down', edgeStampOf, 'gamepad');
      else deps.onPadButton?.(button, padState.stampAtReal);
    }
  };

  const pollAndRefresh = (): void => readPad(false);

  const resyncNow = (): void => {
    if (!isLive()) return;
    readPad(true);
  };

  return {
    isLive,
    handlePointerDown(sample) {
      // Any pointer press (a right click, a second finger) hands the target back to the pointer.
      lastDevice = 'pointer';
      if (!sample.isPrimary || sample.button !== 0) return;
      const active = deps.getActive();
      if (active === null || !isLive()) {
        if (log.enabled('debug')) log.debug('input', 'tap dropped: no level is live');
        return;
      }
      const rect = deps.canvasRect();
      if (!(rect.width > 0 && rect.height > 0)) return;
      bindTo(active);
      if (isBusy(active)) {
        if (log.enabled('debug')) log.debug('input', 'tap dropped: Papa is busy');
        return;
      }
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
        heldPressAt = toSim(active, sample.timeStamp);
        active.sim.enqueue({ type: 'PressThreat', t: heldPressAt, threatId });
        press.pressed(sample.pointerId, threatId);
        deps.onThreatPressed?.(threatId);
        return;
      }
      // The baby and the objects (story 1.21): a finger aims at whichever is nearer, the baby when
      // there is no object in range. An object nearer than the baby, a ringing phone say, is never
      // taken from the finger by a baby crawling past; a tie goes to the baby, like Space / A. The
      // marker shows where Papa will walk.
      const { baby } = active.sim.world;
      const isCarried = baby.state === 'carried';
      // Where he is drawn: lifted, and a little in front of Papa, when he is in his arms.
      babyAim.xM = isCarried ? baby.xM + baby.gazeX * deps.babyCarriedForwardM : baby.xM;
      babyAim.zM = isCarried ? baby.zM + baby.gazeZ * deps.babyCarriedForwardM : baby.zM;
      const babyDistSq = deps.hitTester.pickBaby(
        sample.clientX,
        sample.clientY,
        rect,
        babyAim,
        isCarried ? deps.babyCarriedHeightM : deps.babyBodyRadiusM,
        deps.objectTouchRadiusPx,
      );
      const objects = deps.getObjects();
      const objectId =
        objects.length === 0
          ? null
          : deps.hitTester.pickObject(
              sample.clientX,
              sample.clientY,
              rect,
              objects,
              babyDistSq === null
                ? deps.objectTouchRadiusPx
                : Math.sqrt(babyDistSq) - STRICTLY_NEARER_PX,
            );
      if (babyDistSq !== null && objectId === null) {
        active.sim.enqueue({
          type: 'TapBaby',
          t: toSim(active, sample.timeStamp),
        });
        deps.showTapMarker(baby.xM, baby.zM);
        deps.onTap?.(baby.xM, baby.zM);
        return;
      }
      if (objectId !== null) {
        const object = objects.find((candidate) => candidate.id === objectId);
        active.sim.enqueue({
          type: 'TapObject',
          t: toSim(active, sample.timeStamp),
          objectId,
        });
        // The marker shows where Papa will stand: the object's floor point.
        if (object !== undefined) {
          deps.showTapMarker(object.xM, object.zM);
          deps.onTap?.(object.xM, object.zM);
        }
        return;
      }
      const ndcX = ((sample.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = 1 - ((sample.clientY - rect.top) / rect.height) * 2;
      if (!deps.hitTester.pickFloor(ndcX, ndcY, picked)) return;
      active.sim.enqueue({
        type: 'TapFloor',
        t: toSim(active, sample.timeStamp),
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
        t: releaseStamp(toSim(active, sample.timeStamp)),
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
      if (deps.held.size > 0) lastDevice = 'keyboard';
      refreshMove((active) => toSim(active, timeStampAtReal));
    },
    handleAction,
    get lastDevice() {
      return lastDevice;
    },
    targetedThreatId() {
      const active = deps.getActive();
      if (active === null || !isLive() || isBusy(active)) return null;
      return targetNow(active);
    },
    get padFamily() {
      return family;
    },
    pollGamepad: pollAndRefresh,
    resync: resyncNow,
    resumeHeld() {
      deps.moveIntent.reset();
      resyncNow();
    },
  };
}
