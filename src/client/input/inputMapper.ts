import type { Feel } from '@content/schemas/feel';
import { GAMEPAD_PRESS_ID, KEYBOARD_PRESS_ID } from '@shared/constants';
import { log } from '@shared/log';
import { asRealMs, asSimMs, type SimMs } from '@shared/time';
import {
  isBeatStepRunning,
  isDuelStepRunning,
  isFlowLive,
  isPapaBusy,
  isStealthStepRunning,
  type World,
} from '@sim';
import type { AppFsm } from '../app/appFsm.ts';
import type { ActiveLevel } from '../app/levelSession.ts';
import type { PauseController } from '../app/pauseController.ts';
import { pickAutoTarget } from './autoTarget.ts';
import { isKindInReach, pickContextObject, pickMessProp } from './contextObject.ts';
import {
  createPadState,
  type GamepadInput,
  PAD_BUTTONS,
  type PadButton,
  type PadFamily,
  type StickAxes,
} from './gamepadInput.ts';
import type { FloorPoint, HitTester, ObjectTarget, PickTarget, ThreatTargets } from './hitTest.ts';
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
   * `feel.stealth.holdMinMs`: how long a floor finger stays down to take the breath. Read at each use,
   * and its own value: `feel.input.holdMinMs` is the Firmness threshold (story 4.9 review).
   */
  stealth: Pick<Feel['stealth'], 'holdMinMs'>;
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
   * object is never also a floor tap. Dropped while Papa is busy (drinking, asleep, on the phone or in the toilet).
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
  /**
   * The breath key (E, or the pad's right trigger) went down or up (story 4.9): while live in a stealth
   * step, the down holds Papa's breath (`HoldAnywhere`) and the up lets it go (`ReleaseHold`, only if
   * this device took it). Nothing anywhere else.
   */
  handleHold(phase: 'down' | 'up', timeStampAtReal: number, device: 'keyboard' | 'gamepad'): void;
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
  // The targets of a tap in the final rush: the level's objects, then the props that are a mess
  // (story 3.5). One buffer, refilled at each tap, so that a tap allocates nothing.
  const messTargets: PickTarget[] = [];
  const messTargetsOf = (
    world: Readonly<World>,
    objects: readonly ObjectTarget[],
  ): readonly PickTarget[] => {
    if (world.flow.state !== 'finalRush') return objects;
    messTargets.length = 0;
    for (let i = 0; i < objects.length; i++) messTargets.push(objects[i] as ObjectTarget);
    for (let i = 0; i < world.props.length; i++) {
      const prop = world.props[i] as World['props'][number];
      if (prop.isMess) messTargets.push(prop);
    }
    return messTargets;
  };
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
  // The breath (story 4.9). One device holds it at a time: the press id that sent `HoldAnywhere` (a
  // pointer's, or the keyboard's or the pad's), which alone can send the `ReleaseHold`. A `ReleaseHold`
  // dated before its hold is clamped to it, like a `Release`.
  let breathHolder: number | null = null;
  let breathHeldAt: SimMs = asSimMs(0);
  // The finger that last tapped the floor in a stealth step: still down `holdMinMs` later, it holds
  // the breath, so that « Papa walks there, breath held » (D11). It has walked from the first instant.
  let floorFinger: { pointerId: number; downAtReal: number; isHolding: boolean } | null = null;

  // The one conversion of a real input stamp into the sim's time, corrected by the calibrated
  // screen latency (ADR-003). `simClockStamp` (the sim's own clock, after a resume) is not an input
  // stamp and stays uncorrected.
  const toSim = (active: ActiveLevel, atReal: number): SimMs =>
    active.timeMap.realToSim(asRealMs(atReal - deps.visualOffsetMs()));

  // Live: in a level, running, and the level still going, in a special sequence too (story 4.4): a
  // level that has ended takes no input.
  const isLive = (): boolean => {
    if (deps.appFsm.state !== 'level' || deps.pause.state !== 'running') return false;
    const active = deps.getActive();
    return active !== null && isFlowLive(active.sim.world);
  };

  // A special sequence is under way (story 4.4): Papa stands still, the sim ignores every tap on the
  // floor, an object or the baby and every move, so the client sends none and draws no tap marker
  // (a marker must never lie). A press on a threat goes through. A key held through it walks again
  // at the end (boot calls `resumeHeld` on `SequenceEnded`).
  // A stealth step is the one sequence that is walked (story 4.9): Papa moves, so moves and floor taps
  // go through and the tap marker shows.
  const isHeldInPlace = (active: ActiveLevel): boolean =>
    active.sim.world.flow.state === 'sequence' && !isStealthStepRunning(active.sim.world);

  // Papa drinks, sleeps, is on the phone or in the toilet (stories 1.19 D6, 1.20, 4.3): the sim
  // ignores every move and press meanwhile, so the client sends no move, floor, object or baby
  // command. A press on a threat is the one it does send (story 2.12): the sim refuses it with
  // `TapRefused`, or judges it if that step already has Papa free. A key held through it walks again
  // on `PapaStateChanged → idle` (boot calls `resumeHeld`).
  const isBusy = (active: ActiveLevel): boolean => isPapaBusy(active.sim.world.papa);

  // A new level begins with nothing sent and no finger down on a threat of the old one.
  const bindTo = (active: ActiveLevel): void => {
    if (active.sim === boundSim) return;
    boundSim = active.sim;
    deps.moveIntent.reset();
    press.forget();
    breathHolder = null;
    floorFinger = null;
  };

  // Takes the breath for `id`, if nobody holds it (the sim ignores a second `HoldAnywhere` anyway).
  const holdBreath = (active: ActiveLevel, id: number, t: SimMs): void => {
    if (breathHolder !== null) return;
    breathHolder = id;
    breathHeldAt = t;
    active.sim.enqueue({ type: 'HoldAnywhere', t });
  };

  // Lets the breath go if `id` holds it. Sent even while paused or counting down, like a finger's end.
  const letGoBreath = (active: ActiveLevel, id: number, t: SimMs): void => {
    if (breathHolder !== id) return;
    breathHolder = null;
    active.sim.enqueue({ type: 'ReleaseHold', t: t < breathHeldAt ? breathHeldAt : t });
  };

  // Sends what is held if it changed. `stampOf` gives the command's sim time and is only called
  // when a command is sent, so a frame with nothing new never reads the time map.
  const refreshMove = (stampOf: (active: ActiveLevel) => SimMs): void => {
    const active = deps.getActive();
    if (active === null || !isLive()) return;
    bindTo(active);
    if (isHeldInPlace(active)) return;
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
    const t = stampOf(active);
    const threatId = targetNow(active);
    if (isBusy(active)) {
      // The finger is recorded so that its `Release` follows (D2); no target-highlight mark.
      if (threatId !== null) {
        heldPressAt = t;
        active.sim.enqueue({ type: 'PressThreat', t, threatId });
        press.pressed(pressId, threatId);
      } else if (log.enabled('debug')) {
        log.debug('input', 'action dropped: Papa is busy');
      }
      return;
    }
    if (threatId !== null) {
      heldPressAt = t;
      active.sim.enqueue({ type: 'PressThreat', t, threatId });
      press.pressed(pressId, threatId);
      deps.onThreatPressed?.(threatId);
      return;
    }
    // A sequence holds Papa in place (story 4.4): with no threat up, the context action sends
    // nothing, except in a beats step, where it is the tap to the beat (story 4.5): no marker, no
    // press to release (a release ends nothing), the stamp corrected like every other input.
    if (isHeldInPlace(active)) {
      if (isBeatStepRunning(active.sim.world)) {
        active.sim.enqueue({ type: 'TapBeat', t });
        return;
      }
      if (log.enabled('debug'))
        log.debug('input', 'action dropped: a sequence holds Papa in place');
      return;
    }
    // A stealth step never takes the baby or walks to an object (story 4.9): the action is for the
    // threat that is up (even a false alarm, D12), and sends nothing with none up.
    if (isStealthStepRunning(active.sim.world)) {
      if (log.enabled('debug'))
        log.debug('input', 'action dropped: no threat is up in a stealth step');
      return;
    }
    // No threat is active (D6): the context action, on the nearer of the baby and the nearest
    // object, both in reach (story 1.21: ties go to the baby; story 4.1: not while he is carried).
    const { papa, baby } = active.sim.world;
    const { contextReachM } = deps.input;
    // In the final rush a prop that is a mess comes first (story 3.5): ahead of the baby, carried or
    // not, and of any object. With none in reach the action is what it always was.
    if (active.sim.world.flow.state === 'finalRush') {
      const propId = pickMessProp(active.sim.world.props, papa.xM, papa.zM, contextReachM);
      if (propId !== null) {
        active.sim.enqueue({ type: 'TapObject', t, objectId: propId });
        return;
      }
    }
    const objects = deps.getObjects();
    const isCarried = baby.state === 'carried';
    // A toilet is no object in reach while the baby is carried (story 4.3): the sim refuses the trip,
    // so the action puts him down, and the next press goes in.
    const objectId = pickContextObject(
      objects,
      papa.xM,
      papa.zM,
      contextReachM,
      isCarried ? 'toilet' : null,
    );
    const babyDistSq = (baby.xM - papa.xM) ** 2 + (baby.zM - papa.zM) ** 2;
    const isBabyInReach = babyDistSq <= contextReachM * contextReachM;
    const object = objectId === null ? undefined : objects.find((o) => o.id === objectId);
    const objectDistSq =
      object === undefined
        ? Number.POSITIVE_INFINITY
        : (object.xM - papa.xM) ** 2 + (object.zM - papa.zM) ** 2;
    // A carried baby is always in reach, so an object in reach wins over him (story 4.1): the coffee
    // machine and the phone must stay usable from the keyboard. Without one, the action puts him down.
    // A free baby never beats a toilet in reach, whatever the distances (story 4.3): he lands
    // `putDownOffsetM` ahead of Papa, possibly nearer than the door, and « the nearer wins » would
    // take him back for ever. To take a baby beside the door, tap him or step away.
    // « In reach » is asked of every toilet, not of the nearest object: a coffee machine nearer than
    // the door must not give the baby back his place.
    const isToiletInReach = isKindInReach(objects, 'toilet', papa.xM, papa.zM, contextReachM);
    if (
      isBabyInReach &&
      (isCarried || !isToiletInReach) &&
      (isCarried ? objectId === null : babyDistSq <= objectDistSq)
    ) {
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

  // The breath key or trigger (story 4.9): live in a stealth step only.
  const handleHold = (
    phase: 'down' | 'up',
    stampOf: (active: ActiveLevel) => SimMs,
    device: 'keyboard' | 'gamepad',
  ): void => {
    const id = device === 'keyboard' ? KEYBOARD_PRESS_ID : GAMEPAD_PRESS_ID;
    const active = deps.getActive();
    if (phase === 'up') {
      if (active === null || deps.appFsm.state !== 'level') return;
      bindTo(active);
      letGoBreath(active, id, stampOf(active));
      return;
    }
    lastDevice = device;
    if (active === null || !isLive()) return;
    bindTo(active);
    if (!isStealthStepRunning(active.sim.world)) return;
    holdBreath(active, id, stampOf(active));
  };

  // A floor finger still down `holdMinMs` after it tapped holds the breath, stamped at that instant.
  const refreshFingerHold = (): void => {
    if (floorFinger === null && breathHolder === null) return;
    const active = deps.getActive();
    if (active === null) return;
    bindTo(active);
    // The step is over (the door, a gag, the level): the sim let the breath go with it and ignores the
    // rest, so the mapper forgets its finger and its holder, and a chained step starts clean.
    if (!isStealthStepRunning(active.sim.world)) {
      floorFinger = null;
      breathHolder = null;
      return;
    }
    if (floorFinger === null || floorFinger.isHolding || !isLive()) return;
    const holdAtReal = floorFinger.downAtReal + deps.stealth.holdMinMs;
    if (deps.nowAtReal() < holdAtReal) return;
    floorFinger.isHolding = true;
    holdBreath(active, floorFinger.pointerId, toSim(active, holdAtReal));
  };

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
      if (button === 'hold') {
        // The right trigger is the breath in a stealth step and nothing else: it reaches no menu.
        if (padState.released.hold) handleHold('up', edgeStampOf, 'gamepad');
        if (padState.pressed.hold) handleHold('down', edgeStampOf, 'gamepad');
        continue;
      }
      if (padState.released[button] && button === 'confirm') {
        act('up', edgeStampOf, 'gamepad');
      }
      if (!padState.pressed[button]) continue;
      lastDevice = 'gamepad';
      if (button === 'confirm' && isLiveNow) act('down', edgeStampOf, 'gamepad');
      else deps.onPadButton?.(button, padState.stampAtReal);
    }
  };

  const pollAndRefresh = (): void => {
    readPad(false);
    refreshFingerHold();
  };

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
      if (isBusy(active)) {
        // The press the client used to drop (story 2.12 D2): the sim refuses it with `TapRefused`,
        // or judges it if that step already has Papa free. The finger is recorded so that its
        // `Release` follows. No highlight mark, no tap marker, and no floor, object or baby command.
        if (threatId !== null) {
          heldPressAt = toSim(active, sample.timeStamp);
          active.sim.enqueue({ type: 'PressThreat', t: heldPressAt, threatId });
          press.pressed(sample.pointerId, threatId);
        } else if (log.enabled('debug')) {
          log.debug('input', 'tap dropped: Papa is busy');
        }
        return;
      }
      if (threatId !== null) {
        heldPressAt = toSim(active, sample.timeStamp);
        active.sim.enqueue({ type: 'PressThreat', t: heldPressAt, threatId });
        press.pressed(sample.pointerId, threatId);
        deps.onThreatPressed?.(threatId);
        return;
      }
      // Nothing but a threat answers a finger during a sequence, and no marker is drawn (story 4.4);
      // in a beats step the finger, anywhere on the screen, is the tap to the beat (story 4.5).
      if (isHeldInPlace(active)) {
        if (isBeatStepRunning(active.sim.world)) {
          active.sim.enqueue({ type: 'TapBeat', t: toSim(active, sample.timeStamp) });
          return;
        }
        // In a duel step a finger anywhere on the screen is the press on the threat that is up
        // (story 4.6, D10): a duel of patience tests when, not where, and a tap beside a small marker
        // would be lost at the one moment that matters. The `Release` follows as for a pick. With no
        // threat up (a rest between rounds) the finger is free and sends nothing.
        if (isDuelStepRunning(active.sim.world)) {
          const duelThreatId = targetNow(active);
          if (duelThreatId === null) return;
          heldPressAt = toSim(active, sample.timeStamp);
          active.sim.enqueue({ type: 'PressThreat', t: heldPressAt, threatId: duelThreatId });
          press.pressed(sample.pointerId, duelThreatId);
          deps.onThreatPressed?.(duelThreatId);
          return;
        }
        if (log.enabled('debug')) log.debug('input', 'tap dropped: a sequence holds Papa in place');
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
      // In the final rush a prop that is a mess is a target like an object (story 3.5): one list, so the
      // nearest to the finger wins whatever it is (objects first on a tie), and the baby is weighed
      // against all of them.
      const pickTargets = messTargetsOf(active.sim.world, objects);
      const objectId =
        pickTargets.length === 0
          ? null
          : deps.hitTester.pickObject(
              sample.clientX,
              sample.clientY,
              rect,
              pickTargets,
              babyDistSq === null
                ? deps.objectTouchRadiusPx
                : Math.sqrt(babyDistSq) - STRICTLY_NEARER_PX,
            );
      const isStealth = isStealthStepRunning(active.sim.world);
      if (babyDistSq !== null && objectId === null) {
        active.sim.enqueue({
          type: 'TapBaby',
          t: toSim(active, sample.timeStamp),
        });
        // In a stealth step the tap on the baby touches him (a false alarm is lost by it) and walks
        // nowhere: no marker (story 4.9).
        if (!isStealth) {
          deps.showTapMarker(baby.xM, baby.zM);
          deps.onTap?.(baby.xM, baby.zM);
        }
        return;
      }
      // No coffee in a stealth step: a tap on an object sends nothing and draws no marker.
      if (objectId !== null && isStealth) return;
      if (objectId !== null) {
        const object = objects.find((candidate) => candidate.id === objectId);
        const prop =
          object === undefined
            ? active.sim.world.props.find((candidate) => candidate.id === objectId)
            : undefined;
        active.sim.enqueue({
          type: 'TapObject',
          t: toSim(active, sample.timeStamp),
          objectId,
        });
        // A prop of the rush: the marker shows where Papa will stand, the prop's floor point.
        if (prop !== undefined) {
          deps.showTapMarker(prop.xM, prop.zM);
          deps.onTap?.(prop.xM, prop.zM);
          return;
        }
        // The marker shows where Papa will stand: the object's floor point. Not for a toilet while
        // he carries the baby (story 4.3): Papa goes nowhere, the sim refuses and the hint says why.
        if (object !== undefined && !(isCarried && object.kind === 'toilet')) {
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
      // The finger stays down: past `holdMinMs` it holds the breath (the poll sends it).
      if (isStealth) {
        floorFinger = {
          pointerId: sample.pointerId,
          downAtReal: sample.timeStamp,
          isHolding: false,
        };
      }
    },
    handlePointerUp(sample) {
      const active = deps.getActive();
      if (active === null || deps.appFsm.state !== 'level') return;
      bindTo(active);
      if (floorFinger !== null && floorFinger.pointerId === sample.pointerId) {
        const finger = floorFinger;
        floorFinger = null;
        // Outside a stealth step (it ended since the tap) the breath is not the sim's business any more.
        if (!isStealthStepRunning(active.sim.world)) {
          if (breathHolder === finger.pointerId) breathHolder = null;
        } else {
          // Held `holdMinMs` already but not read yet by the poll: the hold is stamped where it began.
          if (!finger.isHolding && sample.timeStamp >= finger.downAtReal + deps.stealth.holdMinMs) {
            holdBreath(
              active,
              finger.pointerId,
              toSim(active, finger.downAtReal + deps.stealth.holdMinMs),
            );
            finger.isHolding = true;
          }
          if (finger.isHolding)
            letGoBreath(active, finger.pointerId, toSim(active, sample.timeStamp));
        }
      }
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
      const simNow = active.sim.world.time.sim;
      // A pause with the breath held ends it now, at the sim clock: a pause in a passage costs its
      // gasp, as a pause in a Firmness costs the Firmness (story 4.9).
      if (breathHolder !== null) letGoBreath(active, breathHolder, simNow);
      floorFinger = null;
      if (!press.releaseAll()) return;
      // The press may be dated a step ahead of the sim clock (it is applied at the next step).
      active.sim.enqueue({ type: 'Release', t: heldPressAt > simNow ? heldPressAt : simNow });
    },
    onKeysChanged(timeStampAtReal) {
      if (deps.held.size > 0) lastDevice = 'keyboard';
      refreshMove((active) => toSim(active, timeStampAtReal));
    },
    handleAction,
    handleHold: (phase, timeStampAtReal, device) =>
      handleHold(phase, (active) => toSim(active, timeStampAtReal), device),
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
