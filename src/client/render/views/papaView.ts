import { ISO_YAW_DEG } from '@shared/constants';
import type { BabySlice, PapaLook, PapaSlice } from '@sim';
import {
  BoxGeometry,
  Color,
  Euler,
  Group,
  Matrix4,
  Mesh,
  type Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { type BlobKit, blobSizeM } from '../blobShadow.ts';
import { interpolateXZ, type PointXZ } from '../interpolate.ts';
import { PALETTE } from '../materials/palette.ts';
import type { ToonMaterialCache } from '../materials/toonMaterial.ts';
import {
  type BrowPose,
  createBrowState,
  REST_BROW_POSE,
  stepBrows,
  unplaceBrows,
} from './brows.ts';
import {
  PAPA_IDLE_CLIPS,
  PAPA_REACTION_CLIPS,
  PAPA_TRAVELLING,
  papaClipOf,
} from './characterClips.ts';
import { type FadesConfig, fadeMsOf } from './characterFades.ts';
import {
  busyCycleAt,
  busyFitTimeScaleOf,
  type ClipFacings,
  clipTimeScaleOf,
  papaFacingYawRad,
  stepSpeedMpsOf,
  type TravelClips,
} from './characterMotion.ts';
import { type CharacterRig, EYELIDS_OPEN_SCALE } from './characterRig.ts';
import { createSpring, resetSpring, stepAngleSpring, stepSpring } from './characterSpring.ts';
import { createForelockState, resetForelock, stepForelock } from './forelock.ts';
import {
  breathPeriodMsOf,
  createBreathState,
  createLeanState,
  type LifeInputs,
  resetBreath,
  resetLean,
  stepBreath,
  stepLean,
  stoopDegOf,
} from './lifeLayer.ts';
import {
  createIdleSlot,
  idleSlotAt,
  isPapaIdleEligible,
  PAPA_IDLE_SALT,
  passageOneShotOf,
} from './papaActing.ts';
import {
  createPapaGazeAim,
  type PapaGazeInput,
  type PapaGazeKind,
  papaGazeOf,
} from './papaGaze.ts';

/** The bones Papa's life layer writes over his clips (story 7.8, D3): the torso and the head. */
export const PAPA_LIFE_BONES = ['spine', 'head'] as const;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
/** A lock shorter than this, in metres, has no direction to turn: a file with no forelock marker. */
const FORELOCK_LENGTH_MIN_M = 1e-4;
const IDENTITY = new Quaternion();
/** The brows turn about the head's forward axis (story 7.10, D2): +θ lifts the end toward his left. */
const BROW_TILT_AXIS = new Vector3(0, 0, 1);
const IDLE_CLIPS: readonly string[] = PAPA_IDLE_CLIPS;
/** The gesture that fits the sim's busy span (story 7.12, D3). */
const PICK_UP_CLIP = 'pick_up';

/** One character's two brows and their rest positions, read once (story 7.10, D2). */
export interface BrowBones {
  readonly left: Object3D;
  readonly right: Object3D;
  readonly leftRest: Vector3;
  readonly rightRest: Vector3;
}

/** `brow_l` and `brow_r` of `rig` with their rest positions, read once at creation (D2). */
export function browBonesOf(rig: CharacterRig): BrowBones {
  const left = rig.node('brow_l');
  const right = rig.node('brow_r');
  return { left, right, leftRest: left.position.clone(), rightRest: right.position.clone() };
}

/**
 * Writes both brows, absolutely, from their rest (story 7.10, D2): raised by `raiseOffsetM`, toward the
 * nose by `inwardOffsetM`, his left up and his right down by `skewOffsetM`; `brow_l` turned by −tilt and
 * `brow_r` by +tilt about the head's forward axis, so a positive tilt lifts both inner ends; both scaled by
 * `scalePct` about their bone (the bar's centre). Allocates nothing.
 */
export function writeBrowBones(bones: BrowBones, pose: Readonly<BrowPose>, scalePct: number): void {
  const { left, right, leftRest, rightRest } = bones;
  const tiltRad = pose.tiltDeg * DEG_TO_RAD;
  const scale = scalePct / 100;
  left.position.set(
    leftRest.x - pose.inwardOffsetM,
    leftRest.y + pose.raiseOffsetM + pose.skewOffsetM,
    leftRest.z,
  );
  right.position.set(
    rightRest.x + pose.inwardOffsetM,
    rightRest.y + pose.raiseOffsetM - pose.skewOffsetM,
    rightRest.z,
  );
  left.quaternion.setFromAxisAngle(BROW_TILT_AXIS, 0 - tiltRad);
  right.quaternion.setFromAxisAngle(BROW_TILT_AXIS, tiltRad);
  left.scale.setScalar(scale);
  right.scale.setScalar(scale);
}

/**
 * Papa's height, feet on the floor to the top of his head, in metres: what the markers above him
 * read. The mesh is authored to it (`papa.glb`), and the silhouette test in `characterAssets.test.ts`
 * measures the file against it: changing it here moves the markers, not the drawing.
 */
export const PAPA_HEIGHT_M = 0.9;

// The micro-sleep (story 1.19). Diegetic: 3D, never a DOM overlay.
const PAPA_Z_COLOR = PALETTE.ink;
/** The « Z » of a sleeping Papa floats this far above his head, in metres... */
const PAPA_Z_HEIGHT_M = 0.45;
/** ...bobs by this much, in metres... */
const PAPA_Z_BOB_M = 0.06;
/** ...once per this long, in sim ms. */
const PAPA_Z_BOB_PERIOD_MS = 1200;
/** Each bar of the « Z » is this long, in metres, and this thick. */
const PAPA_Z_SIZE_M = 0.2;
const PAPA_Z_THICKNESS_M = 0.04;

/** Where Papa is drawn and which way he faces. */
export interface PapaPose extends PointXZ {
  /** Rotation about the vertical axis, in radians: 0 faces +z, a positive angle turns toward +x. */
  yawRad: number;
}

/**
 * Papa's pose at `alpha` of the way from the last step to the next: the position interpolated
 * between the two last steps (D11), the heading turned into an angle (trigonometry is for the
 * client; the sim keeps a unit vector). Pure and allocation-free: it writes `out`.
 */
export function papaPoseAt(papa: Readonly<PapaSlice>, alpha: number, out: PapaPose): void {
  interpolateXZ(papa.prevXM, papa.prevZM, papa.xM, papa.zM, alpha, out);
  out.yawRad = Math.atan2(papa.headingX, papa.headingZ);
}

/** The side effects of his busy props (`feedback.json › characters.busyProps`, story 2.13). */
export interface BusyPropsConfig {
  readonly steamSwayDeg: number;
  readonly steamStretchPct: number;
  readonly steamPeriodMs: number;
  readonly blablaTiltDeg: number;
  readonly blablaBobAmplitudeM: number;
  readonly blablaPeriodMs: number;
  readonly blablaPlace: { readonly screenOffsetM: number; readonly heightM: number };
}

/**
 * What the view reads from the feedback table (`feedback.json › characters`), once per level. The fades,
 * the turn and the rest of the life layer are `feel.json › characters`, read each frame (`LifeInputs`).
 */
export interface CharacterMotionConfig {
  readonly clips: TravelClips;
  /** Where each clip turns his body (story 2.13). */
  readonly clipFacing: ClipFacings;
  readonly busyProps: BusyPropsConfig;
}

export interface PapaView {
  /** Where Papa was last drawn (interpolated): what a marker that follows him reads. It never waits for his body to turn. */
  readonly pose: Readonly<PapaPose>;
  /** Moves him and his shadow. Allocates nothing. */
  update(papa: Readonly<PapaSlice>, alpha: number): void;
  /**
   * Plays the loop the world says now (fading in over its passage's fade), turns his body on its spring
   * toward the facing of the clip the player sees (the camera, away from the baby) or else his heading,
   * advances his mixer by `dtMs` of sim time, then lays the life layer over the clip (story 7.8, D3):
   * lean, breath and stoop on `spine`, the gaze on `head`, then his brows on his expression (story 7.10) and
   * the forelock's pendulum (story 7.9).
   * A `dtMs` of 0 holds him. Allocates nothing once the clips have played once.
   */
  animate(
    papa: Readonly<PapaSlice>,
    baby: Readonly<BabySlice>,
    dtMs: number,
    life: Readonly<LifeInputs>,
  ): void;
  /** Plays a clip once, over his loop, fading in over `fadeMs`. */
  playOnce(clip: string, fadeMs: number, holdsLastPose?: boolean): void;
  /**
   * Cuts his acting one-shot under way (an idle, a start, a brake: story 7.11, D11), and only that: the loop
   * fades in from now over `fades.startMs` into a travelling loop, `fades.otherMs` otherwise. The scene calls
   * it in the frame of a state change or of an accepted command (D12). Allocates nothing.
   */
  cutActing(fades: Readonly<FadesConfig>): void;
  /**
   * Plays `clip` once as an acting one-shot (story 7.12, D5: the sigh), fading in over `fadeMs`: every cut of
   * his acting then applies to it (a tap, a state change, the guard, the baby in his arms). Allocates nothing.
   */
  playActing(clip: string, fadeMs: number): void;
  /** His acting one-shot under way (story 7.11): an idle, a start, a brake or the sigh, else null. */
  readonly actingClip: string | null;
  /** Any one-shot under way (an acting one, a response pose, a gag), else null (story 7.12). */
  readonly oneShotName: string | null;
  /** Whether his puffed cheeks are shown (story 7.11, D6): while he holds his breath. */
  readonly isCheeksShown: boolean;
  /** The clip the player sees. */
  readonly clipName: string | null;
  /** His mixer's clock, in sim ms. */
  readonly mixerTimeMs: number;
  /** Scales his body, feet on the floor (the squash); the shadow stays. Allocates nothing. */
  setSquash(xz: number, y: number): void;
  /** Stops his clips and starts them over (a restart, a stopped loop, a replay moment): the forelock rests. */
  resetAnimation(): void;
  /**
   * Lowers his eyelids: 0 is open, 1 is shut. Clamped. Allocates nothing.
   */
  setEyelids(amount01: number): void;
  /**
   * A sleeping Papa: eyelids shut and a « Z » floating above his head, bobbing on `clockMs` (sim
   * ms). Off, it hides the « Z » and leaves the eyelids to `setEyelids`. Allocates nothing.
   */
  setAsleep(isAsleep: boolean, clockMs: number): void;
  /**
   * A mug in his hand while he drinks, with its steam swaying on `clockMs` (sim ms). Under reduced motion
   * the steam is shown, held at its rest transform. Allocates nothing.
   */
  setDrinking(isDrinking: boolean, clockMs: number, isMotionReduced: boolean): void;
  /**
   * A handset at the side of his head while he is on the phone, and a bla-bla bubble at his side that
   * wobbles on `clockMs` (sim ms). Under reduced motion the bubble is shown, held at its rest transform.
   * Allocates nothing.
   */
  setOnPhone(isOnPhone: boolean, clockMs: number, isMotionReduced: boolean): void;
  /** The way his drawn body faces, in radians (0 faces +z, positive toward +x): it turns, the sim's heading does not. */
  readonly bodyYawRad: number;
  /** His lean now, in degrees (story 7.8): forward into a start, back from a stop; 0 under reduced motion. */
  readonly leanDeg: number;
  /** His lean into a turn now, in degrees, positive toward his right. */
  readonly leanRollDeg: number;
  /** His fatigue stoop now, in degrees forward. */
  readonly stoopDeg: number;
  /** His breath's pitch now, in degrees; 0 held or under reduced motion. */
  readonly breathDeg: number;
  /** His head's turn from his body now, in degrees, positive toward his left. */
  readonly headYawDeg: number;
  /** What his head follows now. */
  readonly gazeKind: PapaGazeKind;
  /** How far his forelock turns from its rest now, in degrees (story 7.9); 0 at rest or under reduced motion. */
  readonly forelockDeg: number;
  /** How shut his eyelids are drawn, 0 (open) to 100: the micro-sleep's telegraph or his sleep, nothing else. */
  readonly eyelidsPct: number;
  /** His brows' drawn tilt now, in degrees, positive inner ends up (story 7.10). */
  readonly browTiltDeg: number;
  /** How far the steam leans now, in degrees; 0 while it is hidden or held. */
  readonly steamSwayDeg: number;
  /** How far the bla-bla bubble tilts now, in degrees; 0 while it is hidden or held. */
  readonly blablaTiltDeg: number;
  /**
   * Papa is out of the room (the toilet, story 4.3): the whole of him, blob shadow included, is
   * hidden, and drawn again with the next call that says he is back, his forelock at rest. Allocates nothing.
   */
  setAway(isAway: boolean): void;
  /**
   * Stands Papa's hair on end: 0 is flat (the spikes are hidden), 1 is fully up. A value outside
   * 0..1 is clamped. A look with his hair on end holds it up whatever this says. Allocates nothing.
   */
  setHair(amount01: number): void;
  /** Shows or hides each part of his look on its own (story 7.2, D2). Allocates nothing. */
  setLook(look: Readonly<PapaLook>): void;
  /** Frees what the view made and the rig; the shared materials belong to the scene. */
  dispose(): void;
}

/**
 * Papa as a rigged `.glb` with a blob shadow under him. The blob does not turn: it follows his
 * position only. `papa` is the group his body turns and squashes on, above the rig (D7); no gameplay
 * value is ever read from it. `radiusM` sizes the shadow alone: the mesh is authored at real size (D8).
 */
export function createPapaView(
  scene: Object3D,
  toon: ToonMaterialCache,
  blobs: BlobKit,
  radiusM: number,
  rig: CharacterRig,
  motion: CharacterMotionConfig,
): PapaView {
  const widthM = Math.max(radiusM * 2, 0.01);
  const body = new Group();
  body.name = 'papa';
  body.add(rig.root);
  const shadow = blobs.createMesh('blob_papa');
  shadow.scale.set(blobSizeM(widthM), 1, blobSizeM(widthM));

  const eyelids = rig.node('eyelids');
  const mug = rig.node('papa_mug');
  const steam = rig.node('papa_mug_steam');
  const handset = rig.node('papa_handset');
  const blabla = rig.node('papa_blabla');
  const hair = rig.node('papa_hair');
  const mash = rig.node('papa_look_mash');
  const shirt = rig.node('papa_shirt');
  const insideOutShirt = rig.node('papa_look_shirt');
  const cheeks = rig.node('papa_cheeks');
  cheeks.visible = false;
  mug.visible = false;
  handset.visible = false;
  hair.visible = false;
  mash.visible = false;
  insideOutShirt.visible = false;
  blabla.visible = false;

  // The steam sways about the rim it stands on, so its rest transform is the file's: written back as is when held.
  const steamRestRotationZ = steam.rotation.z;
  const steamRestScaleY = steam.scale.y;
  const { busyProps } = motion;
  const steamSwayRad = (busyProps.steamSwayDeg * Math.PI) / 180;
  const blablaTiltRad = (busyProps.blablaTiltDeg * Math.PI) / 180;
  // The bubble leaves the turning body for the group, which never turns, and stands at his side, on
  // the side of the screen `screenOffsetM` says (screen right is (cos yaw, -sin yaw) for the camera at
  // `ISO_YAW_DEG`). It faces the camera, so that it reads from every heading (D4).
  const cameraYawRad = (ISO_YAW_DEG * Math.PI) / 180;
  const blablaPlace = busyProps.blablaPlace;
  const blablaBaseX = blablaPlace.screenOffsetM * Math.cos(cameraYawRad);
  const blablaBaseZ = -blablaPlace.screenOffsetM * Math.sin(cameraYawRad);
  const blablaRestRotationZ = blabla.rotation.z;

  // The « Z »: two bars and a diagonal, in ink, above the head. Made here, not in the file: it
  // floats free of the skeleton.
  const zBarGeometry = new BoxGeometry(PAPA_Z_SIZE_M, PAPA_Z_THICKNESS_M, PAPA_Z_THICKNESS_M);
  const zDiagonalGeometry = new BoxGeometry(
    PAPA_Z_SIZE_M * Math.SQRT2,
    PAPA_Z_THICKNESS_M,
    PAPA_Z_THICKNESS_M,
  );
  const zMaterial = toon.get(new Color(PAPA_Z_COLOR));
  const zSign = new Group();
  zSign.name = 'papa_z';
  const zTop = new Mesh(zBarGeometry, zMaterial);
  zTop.position.y = PAPA_Z_SIZE_M / 2;
  const zBottom = new Mesh(zBarGeometry, zMaterial);
  zBottom.position.y = -PAPA_Z_SIZE_M / 2;
  const zDiagonal = new Mesh(zDiagonalGeometry, zMaterial);
  zDiagonal.rotation.z = Math.PI / 4;
  zSign.add(zTop, zBottom, zDiagonal);
  zSign.visible = false;

  const group = new Group();
  group.name = 'papa_group';
  group.add(body, shadow, zSign, blabla);
  blabla.position.set(blablaBaseX, blablaPlace.heightM, blablaBaseZ);
  blabla.rotation.set(0, cameraYawRad, blablaRestRotationZ);
  scene.add(group);
  const pose: PapaPose = { xM: 0, zM: 0, yawRad: 0 };
  /** Whether the body spring has been put on his heading yet (his first frame, or after a restart). */
  let isBodyPlaced = false;
  const bodySpring = createSpring(0);
  // The life layer (story 7.8), made once: the loop's passage, the lean, the breath, the gaze.
  const spine = rig.node('spine');
  const head = rig.node('head');
  let loopClip: string | null = null;
  let isLoopTravelling = false;
  // The acting (story 7.11): the one-shot it plays, the spells a start or a brake reads, the idles' window.
  let actingClip: string | null = null;
  /** Whether the spell he is in travels, or null before his first frame (a restart). */
  let isSpellTravelling: boolean | null = null;
  /** When the spell he is in began, in sim ms: the `enteredAt` of its first state. */
  let spellStartAt = 0;
  /** How long the spell before this one lasted, in sim ms, or null when unknown. */
  let lastSpellMs: number | null = null;
  /** The step clock of the last frame that read the idles' slots, or null after a restart. */
  let lastSlotSimMs: number | null = null;
  const idleSlot = createIdleSlot();
  let isCheeksShownNow = false;
  const cutActingNow = (fades: Readonly<FadesConfig>): void => {
    if (actingClip !== null && rig.oneShotName === actingClip) {
      rig.cutOnce(isLoopTravelling ? fades.startMs : fades.otherMs);
    }
    actingClip = null;
  };
  const lean = createLeanState();
  const breath = createBreathState();
  const headSpring = createSpring(0);
  const gazeAim = createPapaGazeAim();
  const gazeInput: { -readonly [K in keyof PapaGazeInput]: PapaGazeInput[K] } = {
    papaXM: 0,
    papaZM: 0,
    bodyYawRad: 0,
    babyXM: 0,
    babyZM: 0,
    isResponding: false,
    isAsleep: false,
  };
  const offsetEuler = new Euler(0, 0, 0, 'XYZ');
  const offset = new Quaternion();
  let stoopNowDeg = 0;
  let breathNowDeg = 0;
  // The forelock (story 7.9, D7): its tip at rest in the head's axes, the lock's root plus the marker the
  // file puts at its tip, read once (both rest at the identity, so they add up). The rest direction is the
  // marker's. A file with no marker has no lock to swing.
  const forelock = rig.node('forelock');
  const forelockTipM = rig.node('papa_forelock_tip').position;
  const hasForelock = forelockTipM.lengthSq() > FORELOCK_LENGTH_MIN_M * FORELOCK_LENGTH_MIN_M;
  const forelockRestDir = forelockTipM.clone().normalize();
  const forelockTipInHead = forelock.position.clone().add(forelockTipM);
  const forelockState = createForelockState();
  const forelockAt = new Vector3();
  const forelockAim = new Vector3();
  const forelockTurn = new Quaternion();
  const headInRoom = new Matrix4();
  const headInverse = new Matrix4();
  let isForelockPlaced = false;
  let forelockNowDeg = 0;
  // The brows (story 7.10): written last with the forelock, after the gaze, from rests read once.
  const brows = browBonesOf(rig);
  const browState = createBrowState();
  /** The brows' size the last frame drew, in % (`browScalePct`): a restart keeps it. */
  let browScaleNowPct = 100;
  let isAwayNow = false;
  let steamSwayNowDeg = 0;
  let blablaTiltNowDeg = 0;

  let asleepAmount = 0;
  let wantedEyelids = 0;
  const applyEyelids = (): void => {
    eyelids.scale.y = Math.max(EYELIDS_OPEN_SCALE, wantedEyelids, asleepAmount);
  };
  applyEyelids();

  let gagHairAmount = 0;
  let lookHairAmount = 0;
  const applyHair = (): void => {
    // One mesh for the gag and the look, drawn at the greater of the two (D2).
    const amount = Math.max(gagHairAmount, lookHairAmount);
    hair.visible = amount > 0;
    hair.scale.y = amount > 0 ? amount : 1;
  };

  return {
    get pose() {
      return pose;
    },
    update(papa, alpha) {
      papaPoseAt(papa, alpha, pose);
      // The group sits on the floor under him; only the body turns (a round shadow looks the same
      // from every side).
      group.position.set(pose.xM, 0, pose.zM);
      if (!isBodyPlaced) {
        isBodyPlaced = true;
        resetSpring(bodySpring, pose.yawRad);
        body.rotation.y = pose.yawRad;
      }
    },
    animate(papa, baby, dtMs, life) {
      const { characters } = life;
      const { fades } = characters;
      const isReduced = life.isMotionReduced;
      const isGuarded = life.isSignalOnly;
      const isCarried = baby.state === 'carried';
      // The loop, and the passage it is (D4): a start, a stop, or any other. On tiptoe in a stealth step (7.11).
      const clip = papaClipOf(papa, baby, life.isStealth, life.papaChoreClip);
      const isTravelling = PAPA_TRAVELLING[papa.state];
      // The spells a start or a brake reads (story 7.11, D3, D4), dated with the world's sim instants.
      if (isSpellTravelling === null) {
        isSpellTravelling = isTravelling;
        spellStartAt = papa.enteredAt;
      } else if (isTravelling !== isSpellTravelling) {
        lastSpellMs = papa.enteredAt - spellStartAt;
        spellStartAt = papa.enteredAt;
        isSpellTravelling = isTravelling;
      }
      const speedMps = stepSpeedMpsOf(papa);
      // The pick-up plays one cycle over the sim's busy span (story 7.12, D3); the sim's span never changes.
      const timeScale =
        clip === PICK_UP_CLIP
          ? busyFitTimeScaleOf(rig.durationMsOf(PICK_UP_CLIP), papa.busyUntil - papa.enteredAt)
          : clipTimeScaleOf(clip, speedMps, motion.clips);
      if (clip !== loopClip) {
        const fromClip = loopClip;
        loopClip = clip;
        rig.play(clip, timeScale, fadeMsOf(isLoopTravelling, isTravelling, 'loop', fades));
        isLoopTravelling = isTravelling;
        // A new loop cuts an acting one-shot in this frame (D11), then may start or brake (D3, D4).
        cutActingNow(fades);
        const passage = isCarried
          ? null
          : passageOneShotOf(
              fromClip,
              clip,
              papa.state,
              lastSpellMs,
              characters.startStop,
              isGuarded,
              isReduced,
            );
        if (passage !== null && rig.oneShotName === null) {
          rig.playOnce(passage, passage === 'walk_start' ? fades.startMs : fades.otherMs);
          actingClip = passage;
        }
      } else {
        rig.play(clip, timeScale, fades.otherMs);
      }
      // An acting one-shot handed back, or replaced by an event's, is forgotten; one is cut the frame the
      // baby is picked up, a duel or stealth step begins, motion is reduced, or (an idle) he leaves `idle`.
      if (actingClip !== null && rig.oneShotName !== actingClip) actingClip = null;
      if (
        actingClip !== null &&
        (isCarried ||
          isGuarded ||
          (isReduced && !PAPA_REACTION_CLIPS.includes(actingClip)) ||
          (papa.state !== 'idle' && IDLE_CLIPS.includes(actingClip)))
      ) {
        cutActingNow(fades);
      }
      // The idles (D8, D9): each slot is seen by the one frame whose step clock first reaches it; a slot he
      // is not free for shows nothing, and the next comes on time. The first frame after a restart starts none.
      if (lastSlotSimMs === null || life.simMs < lastSlotSimMs) {
        lastSlotSimMs = life.simMs;
      } else if (dtMs > 0 && life.simMs > lastSlotSimMs) {
        idleSlotAt(
          life.levelSeed,
          PAPA_IDLE_SALT,
          papa.enteredAt,
          life.simMs,
          characters.idles,
          IDLE_CLIPS.length,
          idleSlot,
        );
        if (
          idleSlot.index >= 0 &&
          idleSlot.startAt > lastSlotSimMs &&
          isPapaIdleEligible(papa, baby, isGuarded, isReduced, rig.oneShotName !== null)
        ) {
          const idle = IDLE_CLIPS[idleSlot.variant] as string;
          rig.playOnce(idle, fades.otherMs);
          actingClip = idle;
        }
        lastSlotSimMs = life.simMs;
      }
      // The clip the player sees (a one-shot over his loop) decides where he faces; his heading is the
      // sim's. The drawn body springs toward it (D5); under reduced motion with no overshoot.
      const wantedYawRad =
        papaFacingYawRad(papa, baby, rig.clipName, motion.clipFacing) ?? pose.yawRad;
      if (!isBodyPlaced) {
        isBodyPlaced = true;
        resetSpring(bodySpring, wantedYawRad);
      }
      const { turn } = characters;
      body.rotation.y = stepAngleSpring(
        bodySpring,
        wantedYawRad,
        dtMs,
        turn.reachMs,
        isReduced ? 1 : turn.dampingRatio,
        turn.overshootMaxDeg * DEG_TO_RAD,
      );
      // The clips first, the life layer's bones back to what the clips give them (D3)...
      rig.update(dtMs, characters.fades.returnMs);
      // ...then the offsets over them: the torso (stoop, lean, breath), then the head (the gaze).
      stepLean(lean, speedMps, bodySpring.velocityPerMs, dtMs, characters.lean, isReduced);
      const breathFactor = stepBreath(
        breath,
        dtMs,
        breathPeriodMsOf(characters.breath, life.isAlert),
        life.isBreathHeld,
        isReduced,
      );
      stoopNowDeg = stoopDegOf(life.fatigue, characters.stoop.maxDeg);
      breathNowDeg = breathFactor * characters.breath.papaAmplitudeDeg;
      offsetEuler.set(
        (stoopNowDeg + lean.pitchDeg + breathNowDeg) * DEG_TO_RAD,
        0,
        lean.rollDeg * DEG_TO_RAD,
      );
      spine.quaternion.multiply(offset.setFromEuler(offsetEuler));
      gazeInput.papaXM = pose.xM;
      gazeInput.papaZM = pose.zM;
      gazeInput.bodyYawRad = bodySpring.drawn;
      gazeInput.babyXM = life.babyXM;
      gazeInput.babyZM = life.babyZM;
      gazeInput.isResponding = life.isResponding;
      gazeInput.isAsleep = papa.state === 'asleep';
      papaGazeOf(
        gazeInput,
        life.gazeSight,
        characters.gaze.maxYawDeg * DEG_TO_RAD,
        characters.gaze.behindDeg * DEG_TO_RAD,
        gazeAim,
      );
      const headYawRad = stepSpring(
        headSpring,
        gazeAim.yawRad,
        dtMs,
        characters.gaze.reachMs,
        1,
        Number.POSITIVE_INFINITY,
      );
      offsetEuler.set(0, headYawRad, 0);
      head.quaternion.multiply(offset.setFromEuler(offsetEuler));
      // His brows on his expression (D2, D9, D14): before the forelock, whose block returns early.
      const face = characters.expressions.papa;
      stepBrows(
        browState,
        life.papaExpression === 'neutral' ? REST_BROW_POSE : face.poses[life.papaExpression],
        dtMs,
        characters.expressions.reachMs,
      );
      browScaleNowPct = face.browScalePct;
      writeBrowBones(brows, browState.drawn, browScaleNowPct);
      // His puffed cheeks while he holds his breath (story 7.11, D6): a state, so under reduced motion too.
      isCheeksShownNow = life.isBreathHeld;
      cheeks.visible = isCheeksShownNow;
      // The forelock last, after the gaze: where a rigid lock's tip would be now, with the head as drawn,
      // in the room's metres (the scene he stands in), so that a screen shake never swings it.
      if (!hasForelock) return;
      head.updateWorldMatrix(true, false);
      headInRoom.copy(scene.matrixWorld).invert().multiply(head.matrixWorld);
      forelockAt.copy(forelockTipInHead).applyMatrix4(headInRoom);
      if (isReduced || !isForelockPlaced) {
        // Under reduced motion it is decoration: at rest, and so ready to start from rest again.
        resetForelock(forelockState, forelockAt.x, forelockAt.y, forelockAt.z);
        isForelockPlaced = true;
        forelock.quaternion.identity();
        forelockNowDeg = 0;
        return;
      }
      const { forelock: lock } = characters;
      stepForelock(
        forelockState,
        forelockAt.x,
        forelockAt.y,
        forelockAt.z,
        dtMs,
        lock.reachMs,
        lock.dampingRatio,
      );
      // The lagged tip back in the head's axes, seen from the lock's root: the lock turns toward it.
      forelockAim
        .set(forelockState.x.drawn, forelockState.y.drawn, forelockState.z.drawn)
        .applyMatrix4(headInverse.copy(headInRoom).invert())
        .sub(forelock.position);
      if (forelockAim.lengthSq() < FORELOCK_LENGTH_MIN_M * FORELOCK_LENGTH_MIN_M) {
        // The tip is on its root: no direction to turn toward, so the lock hangs at rest, not on last frame's pose.
        forelock.quaternion.identity();
        forelockNowDeg = 0;
        return;
      }
      forelockTurn.setFromUnitVectors(forelockRestDir, forelockAim.normalize());
      const turnRad = 2 * Math.acos(Math.min(1, Math.abs(forelockTurn.w)));
      const maxRad = lock.maxDeg * DEG_TO_RAD;
      if (turnRad > maxRad) {
        forelock.quaternion.slerpQuaternions(IDENTITY, forelockTurn, maxRad / turnRad);
        forelockNowDeg = lock.maxDeg;
      } else {
        forelock.quaternion.copy(forelockTurn);
        forelockNowDeg = turnRad * RAD_TO_DEG;
      }
    },
    playOnce(clip, fadeMs, holdsLastPose) {
      rig.playOnce(clip, fadeMs, holdsLastPose);
    },
    cutActing(fades) {
      cutActingNow(fades);
    },
    playActing(clip, fadeMs) {
      rig.playOnce(clip, fadeMs);
      actingClip = clip;
    },
    get actingClip() {
      return actingClip;
    },
    get oneShotName() {
      return rig.oneShotName;
    },
    get isCheeksShown() {
      return isCheeksShownNow;
    },
    get clipName() {
      return rig.clipName;
    },
    get mixerTimeMs() {
      return rig.mixerTimeMs;
    },
    setSquash(xz, y) {
      body.scale.set(xz, y, xz);
    },
    resetAnimation() {
      rig.reset();
      body.scale.set(1, 1, 1);
      // A restart starts at rest: the body back on his heading at the next frame, no lean, no turn of the head.
      isBodyPlaced = false;
      loopClip = null;
      isLoopTravelling = false;
      // The acting starts over: no one-shot, no spell known, no slot seen (`rig.reset` dropped the clips).
      actingClip = null;
      isSpellTravelling = null;
      lastSpellMs = null;
      lastSlotSimMs = null;
      resetLean(lean);
      resetBreath(breath);
      resetSpring(headSpring, 0);
      gazeAim.kind = 'ahead';
      gazeAim.yawRad = 0;
      stoopNowDeg = 0;
      breathNowDeg = 0;
      isForelockPlaced = false;
      forelock.quaternion.identity();
      forelockNowDeg = 0;
      // The brows at rest now; the next frame snaps them on his expression (D9).
      unplaceBrows(browState);
      writeBrowBones(brows, browState.drawn, browScaleNowPct);
    },
    setEyelids(amount01) {
      const amount = Math.min(1, Math.max(0, amount01));
      if (amount === wantedEyelids) return;
      wantedEyelids = amount;
      applyEyelids();
    },
    setAsleep(isAsleep, clockMs) {
      zSign.visible = isAsleep;
      if (isAsleep) {
        zSign.position.y =
          PAPA_HEIGHT_M +
          PAPA_Z_HEIGHT_M +
          PAPA_Z_BOB_M * Math.sin((2 * Math.PI * clockMs) / PAPA_Z_BOB_PERIOD_MS);
      }
      const next = isAsleep ? 1 : 0;
      if (next === asleepAmount) return;
      asleepAmount = next;
      applyEyelids();
    },
    setDrinking(isDrinking, clockMs, isMotionReduced) {
      mug.visible = isDrinking;
      if (!isDrinking) {
        steamSwayNowDeg = 0;
        return;
      }
      // Shown, and still when motion is reduced: a pose carries a state, the steam only decorates it.
      const cycle = isMotionReduced ? 0 : busyCycleAt(clockMs, busyProps.steamPeriodMs);
      steam.rotation.z = steamRestRotationZ + cycle * steamSwayRad;
      steam.scale.y = steamRestScaleY * (1 + cycle * (busyProps.steamStretchPct / 100));
      steamSwayNowDeg = cycle * busyProps.steamSwayDeg;
    },
    setOnPhone(isOnPhone, clockMs, isMotionReduced) {
      handset.visible = isOnPhone;
      blabla.visible = isOnPhone;
      if (!isOnPhone) {
        blablaTiltNowDeg = 0;
        return;
      }
      const cycle = isMotionReduced ? 0 : busyCycleAt(clockMs, busyProps.blablaPeriodMs);
      blabla.rotation.z = blablaRestRotationZ + cycle * blablaTiltRad;
      blabla.position.y = blablaPlace.heightM + cycle * busyProps.blablaBobAmplitudeM;
      blablaTiltNowDeg = cycle * busyProps.blablaTiltDeg;
    },
    get bodyYawRad() {
      return isBodyPlaced ? bodySpring.drawn : pose.yawRad;
    },
    get leanDeg() {
      return lean.pitchDeg;
    },
    get leanRollDeg() {
      return lean.rollDeg;
    },
    get stoopDeg() {
      return stoopNowDeg;
    },
    get breathDeg() {
      return breathNowDeg;
    },
    get headYawDeg() {
      return headSpring.drawn * RAD_TO_DEG;
    },
    get gazeKind() {
      return gazeAim.kind;
    },
    get forelockDeg() {
      return forelockNowDeg;
    },
    get browTiltDeg() {
      return browState.drawn.tiltDeg;
    },
    get eyelidsPct() {
      return Math.max(wantedEyelids, asleepAmount) * 100;
    },
    get steamSwayDeg() {
      return steamSwayNowDeg;
    },
    get blablaTiltDeg() {
      return blablaTiltNowDeg;
    },
    setAway(isAway) {
      group.visible = !isAway;
      // Back in the room: the lock rests where he comes back, it does not swing from where he left.
      if (isAwayNow && !isAway) isForelockPlaced = false;
      isAwayNow = isAway;
    },
    setHair(amount01) {
      gagHairAmount = Math.min(1, Math.max(0, amount01));
      applyHair();
    },
    setLook(look) {
      mash.visible = look.hasMashOnCheek;
      shirt.visible = !look.isShirtInsideOut;
      insideOutShirt.visible = look.isShirtInsideOut;
      lookHairAmount = look.hasHairOnEnd ? 1 : 0;
      applyHair();
    },
    dispose() {
      rig.dispose();
      // The bubble left the rig's scene for the group: `rig.dispose()` no longer reaches it or its hull (D4).
      blabla.traverse((node) => {
        if (node instanceof Mesh) node.geometry.dispose();
      });
      zBarGeometry.dispose();
      zDiagonalGeometry.dispose();
      scene.remove(group);
    },
  };
}
