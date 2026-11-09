import type { BabySlice, PapaSlice } from '@sim';
import { Euler, Group, type Object3D, Quaternion } from 'three';
import { type BlobKit, blobSizeM } from '../blobShadow.ts';
import { interpolateXZ, type PointXZ } from '../interpolate.ts';
import { BABY_IDLE_SALT, isBabyClapEligible, isBabyPaused, isBabyRestShown } from './babyActing.ts';
import { createBrowState, REST_BROW_POSE, stepBrows, unplaceBrows } from './brows.ts';
import { BABY_IDLE_CLIPS, babyClipOf, isBabyTravelling } from './characterClips.ts';
import { type FadesConfig, fadeMsOf } from './characterFades.ts';
import { clipTimeScaleOf, stepSpeedMpsOf, wrapAngleRad } from './characterMotion.ts';
import { type CharacterRig, EYELIDS_OPEN_SCALE } from './characterRig.ts';
import { createSpring, resetSpring, stepAngleSpring } from './characterSpring.ts';
import {
  breathPeriodMsOf,
  createBreathState,
  type LifeInputs,
  resetBreath,
  stepBreath,
} from './lifeLayer.ts';
import { createIdleSlot, idleSlotAt } from './papaActing.ts';
import { browBonesOf, type CharacterMotionConfig, writeBrowBones } from './papaView.ts';

/** The bone the baby's life layer writes over his clips (story 7.8, D3): the torso. His head is the gaze. */
export const BABY_LIFE_BONES = ['spine'] as const;
const IDLE_CLIPS: readonly string[] = BABY_IDLE_CLIPS;
/** His sit-down (story 7.12, D7): the passage from his pause on all fours into his sitting loop. */
const SIT_DOWN_CLIP = 'sit_down';
const PAUSE_CLIP = 'crawl_pause';
const SIT_CLIP = 'babble';
/** Whether a loop of his travels: a crawl into his stop plays the sit-down when he never pauses (`afterMs` 0). */
const TRAVELLING_LOOPS: readonly string[] = ['crawl', 'sneak'];
const DEG_TO_RAD = Math.PI / 180;

/** Smallest body radius read, in metres: a feel with no radius still has a (tiny) shadow. */
const BABY_MIN_RADIUS_M = 0.01;

/** Papa's chest height, in metres: the centre of the baby when he is carried (story 4.1). Also where a tap on him aims. */
export const BABY_CARRIED_HEIGHT_M = 0.75;
/** The carried baby is held this far in front of Papa along his heading, in metres. Also where a tap on him aims. */
export const BABY_CARRIED_FORWARD_M = 0.3;

/** The part of a threat the lowering reads: a `ThreatInstance` fits it. */
export interface LayDownThreat {
  readonly state: string;
  readonly enteredAt: number;
  readonly windowOpenAt: number;
}

/**
 * How far the baby has been lowered onto the mattress, 0 to 100 (story 4.8): the descent of a
 * Firmness judged on its release goes linearly from the telegraph's start to `windowOpenAt`, the final
 * pose, on the render's sim clock (`renderSimMs`: the loop's continuous clock, so a slow-mo slows it).
 * It is 100 once the window is open, and 0 for a threat that is not running (a gag or a retreat sends
 * him back up at once). Reading `windowOpenAt` is allowed here: this is not a `wait`, its instant is
 * not hidden, and the player must see the pose coming. Pure and allocation-free.
 */
export function layDownProgressPct(threat: LayDownThreat, renderSimMs: number): number {
  if (threat.state === 'windowOpen') return 100;
  if (threat.state !== 'telegraph') return 0;
  const spanMs = threat.windowOpenAt - threat.enteredAt;
  if (!(spanMs > 0)) return 100;
  return Math.min(100, Math.max(0, ((renderSimMs - threat.enteredAt) / spanMs) * 100));
}

/** Where the baby is drawn and which way it looks. */
export interface BabyPose extends PointXZ {
  /** Rotation about the vertical axis, in radians: 0 faces +z, a positive angle turns toward +x. */
  yawRad: number;
}

/**
 * The baby's pose at `alpha` of the way from the last step to the next: the position interpolated
 * between the two last steps, the gaze (not the heading: the eyes are what the player reads) turned
 * into an angle. Pure and allocation-free: it writes `out`.
 */
export function babyPoseAt(baby: Readonly<BabySlice>, alpha: number, out: BabyPose): void {
  interpolateXZ(baby.prevXM, baby.prevZM, baby.xM, baby.zM, alpha, out);
  out.yawRad = Math.atan2(baby.gazeX, baby.gazeZ);
}

export interface BabyView {
  /**
   * Moves the baby and its shadow. While he is `carried` he is drawn lifted to Papa's chest, a little
   * in front of him, riding Papa's interpolated pose (`papa`; his own, which equals Papa's, when none
   * is given), on top of any `setLiftM` hop. `layDownPct` (0 to 100, default 0) lowers a carried baby
   * from Papa's chest to the laid height (story 4.8: the bomb drop). Allocates nothing.
   */
  update(
    baby: Readonly<BabySlice>,
    alpha: number,
    papa?: Readonly<PapaSlice>,
    layDownPct?: number,
  ): void;
  /**
   * Plays the loop the world says now (fading in over its passage's fade), turns his body on its spring
   * toward his gaze, his head at once on the gaze itself (the eyes are what the player reads), advances
   * his mixer by `dtMs` of sim time, then lays his breath over the clip (story 7.8). A `dtMs` of 0 holds
   * him. His brows go on his expression last (story 7.10). Allocates nothing once the clips have played once.
   */
  animate(baby: Readonly<BabySlice>, dtMs: number, life: Readonly<LifeInputs>): void;
  /** Plays a clip once, over his loop, fading in over `fadeMs`. */
  playOnce(clip: string, fadeMs: number): void;
  /** Where he was last drawn (interpolated; a gag's slide, `setSlideM`, is apart), for Papa's gaze. */
  readonly pose: Readonly<BabyPose>;
  /** The way his drawn body faces, in radians: it springs, his head and his gaze do not wait for it. */
  readonly bodyYawRad: number;
  /** His breath's pitch now, in degrees; 0 under reduced motion. */
  readonly breathDeg: number;
  /** His brows' drawn tilt now, in degrees, positive inner ends up (story 7.10). */
  readonly browTiltDeg: number;
  /** The clip the player sees. */
  readonly clipName: string | null;
  /** His acting one-shot under way (story 7.12): the sit-down or a clap, else null. */
  readonly actingClip: string | null;
  /** Scales his body, from the point his feet are at (the squash); the shadow stays. Allocates nothing. */
  setSquash(xz: number, y: number): void;
  /** Lowers his eyelids: 0 is open, 1 is shut. Clamped. Allocates nothing. */
  setEyelids(amount01: number): void;
  /** Stops his clips and starts them over (a restart, a stopped loop). */
  resetAnimation(): void;
  /**
   * Lifts the body `heightM` above the floor (the « lift the baby » pose); the shadow stays on the
   * floor. It adds to the carried lift instead of replacing it. Allocates nothing.
   */
  setLiftM(heightM: number): void;
  /**
   * Offsets the whole view (body and shadow) from the sim position by (`xM`, `zM`) on the floor
   * plane, and lowered by `dropM` (default 0): the stairs gag's slide. It holds until set again, across `update`s. (0, 0) puts the baby
   * back. Allocates nothing.
   */
  setSlideM(xM: number, zM: number, dropM?: number): void;
  /** Frees the rig and what the view made; the shared materials belong to the scene. */
  dispose(): void;
}

/**
 * The baby as a rigged `.glb` with a blob shadow under him. His `head` bone is the gaze, written here
 * every frame (no clip has a track on it: `neck` carries the head's gestures). `baby` is the group his
 * body turns, lifts and squashes on, above the rig (D7). The centre of his mass sits at `radiusM` above
 * his feet, as the sphere's did, so that the carried height holds; the mesh is authored at real size (D8).
 */
export function createBabyView(
  scene: Object3D,
  blobs: BlobKit,
  radiusM: number,
  rig: CharacterRig,
  motion: Pick<CharacterMotionConfig, 'clips'>,
  laidHeightM: number = BABY_CARRIED_HEIGHT_M,
): BabyView {
  const bodyRadiusM = Math.max(radiusM, BABY_MIN_RADIUS_M);
  const body = new Group();
  body.name = 'baby';
  body.add(rig.root);
  const headBone = rig.node('head');
  const eyelids = rig.node('eyelids');
  eyelids.scale.y = EYELIDS_OPEN_SCALE;

  const shadow = blobs.createMesh('blob_baby');
  shadow.scale.set(blobSizeM(bodyRadiusM * 2), 1, blobSizeM(bodyRadiusM * 2));

  const group = new Group();
  group.name = 'baby_group';
  group.add(body, shadow);
  scene.add(group);
  const pose: BabyPose = { xM: 0, zM: 0, yawRad: 0 };
  /** Whether the body spring has been put on his gaze yet (his first frame, or after a restart). */
  let isBodyPlaced = false;
  const bodySpring = createSpring(0);
  // The life layer (story 7.8): the loop's passage and the breath on his torso.
  const spine = rig.node('spine');
  let loopClip: string | null = null;
  let isLoopTravelling = false;
  // His acting (story 7.12): the one-shot it plays, the stop he has sat in, the claps' window.
  let actingClip: string | null = null;
  /** The `enteredAt` of the stop he has been seated in (D7): a guard, a cry or reduced motion seats him for good. */
  let seatedStopAt: number | null = null;
  /** The step clock of the last frame that read the claps' slots, or null after a restart (D8). */
  let lastSlotSimMs: number | null = null;
  const clapSlot = createIdleSlot();
  /** Cuts his acting one-shot (D9): the loop fades in over `startMs` into a travelling loop, `otherMs` otherwise. */
  const cutActingNow = (fades: Readonly<FadesConfig>, isIntoTravelling: boolean): void => {
    if (actingClip !== null && rig.oneShotName === actingClip) {
      rig.cutOnce(isIntoTravelling ? fades.startMs : fades.otherMs);
    }
    actingClip = null;
  };
  const breath = createBreathState();
  let breathNowDeg = 0;
  const offsetEuler = new Euler(0, 0, 0, 'XYZ');
  const offset = new Quaternion();
  // The brows (story 7.10): written last, from rests read once. His lids are the duel's (`setEyelids`).
  const brows = browBonesOf(rig);
  const browState = createBrowState();
  let browScaleNowPct = 100;
  let slideXM = 0;
  let slideZM = 0;
  /** How much lower than the floor the baby sits at the bottom of the stairs (story 3.15). */
  let dropM = 0;
  /** The hop of the response choreography (`setLiftM`) and the lift of the carry, summed in `placeY`. */
  let hopM = 0;
  let carriedLiftM = 0;
  const placeY = (): void => {
    body.position.y = hopM + carriedLiftM - dropM;
  };

  return {
    update(baby, alpha, papa, layDownPct = 0) {
      babyPoseAt(baby, alpha, pose);
      let wantedLiftM = 0;
      // Carried up the stairs (story 3.15) he rides in Papa's arms like a carried baby, with no lay-down.
      if (baby.state === 'carried' || baby.state === 'carriedUp') {
        if (papa !== undefined) {
          interpolateXZ(papa.prevXM, papa.prevZM, papa.xM, papa.zM, alpha, pose);
        }
        // In front of Papa, along the way he faces (the baby's gaze follows Papa's heading).
        pose.xM += baby.gazeX * BABY_CARRIED_FORWARD_M;
        pose.zM += baby.gazeZ * BABY_CARRIED_FORWARD_M;
        // The lowering of the bomb drop: linear from the chest to the mattress. Motion-essential, so
        // it stays under reduced motion: it is what the release is aimed at.
        const heightM =
          BABY_CARRIED_HEIGHT_M +
          (laidHeightM - BABY_CARRIED_HEIGHT_M) * (baby.state === 'carried' ? layDownPct / 100 : 0);
        // Never under his resting height: a `laidHeightM` below his radius would sink him into the floor.
        wantedLiftM = Math.max(0, heightM - bodyRadiusM);
      }
      group.position.set(pose.xM + slideXM, 0, pose.zM + slideZM);
      if (!isBodyPlaced) {
        isBodyPlaced = true;
        resetSpring(bodySpring, pose.yawRad);
        body.rotation.y = pose.yawRad;
      }
      if (wantedLiftM !== carriedLiftM) {
        carriedLiftM = wantedLiftM;
        placeY();
      }
    },
    animate(baby, dtMs, life) {
      const { characters } = life;
      const { fades } = characters;
      const isReduced = life.isMotionReduced;
      const isGuarded = life.isSignalOnly;
      // His rest (story 7.12, D7): stopped, he pauses on all fours, then sits; a guard, a cry or reduced motion
      // seats him at once and for the rest of that stop.
      const isRest = isBabyRestShown(baby, isGuarded, isReduced);
      if (baby.state === 'babble' && !isRest) seatedStopAt = baby.enteredAt;
      const isPaused =
        isRest &&
        seatedStopAt !== baby.enteredAt &&
        isBabyPaused(baby, life.simMs, characters.babySit);
      // The loop, and the passage it is (D4).
      const clip = babyClipOf(baby, isPaused);
      const isTravelling = isBabyTravelling(baby);
      const timeScale = clipTimeScaleOf(clip, stepSpeedMpsOf(baby), motion.clips);
      if (clip !== loopClip) {
        const fromClip = loopClip;
        const fadeMs = fadeMsOf(isLoopTravelling, isTravelling, 'loop', fades);
        // The sim set him off, or he cries, or he is picked up: his acting is cut in this frame, before
        // `rig.play` could wait for it (D7, D9), so his drawn position never trails the sim's.
        cutActingNow(fades, isTravelling);
        loopClip = clip;
        isLoopTravelling = isTravelling;
        rig.play(clip, timeScale, fadeMs);
        // The sit-down: from his pause into his sitting loop (or straight from a crawl with no pause), his rest
        // shown; never the passage a guard, a cry's end or reduced motion makes.
        if (
          isRest &&
          clip === SIT_CLIP &&
          (fromClip === PAUSE_CLIP || (fromClip !== null && TRAVELLING_LOOPS.includes(fromClip))) &&
          rig.oneShotName === null
        ) {
          rig.playOnce(SIT_DOWN_CLIP, fades.otherMs);
          actingClip = SIT_DOWN_CLIP;
        }
        if (isRest && clip === SIT_CLIP) seatedStopAt = baby.enteredAt;
      } else {
        rig.play(clip, timeScale, fades.otherMs);
      }
      // An acting one-shot handed back, or replaced by an event's (a laugh, a stir), is forgotten; the guard and
      // reduced motion cut one in the frame they begin (D9).
      if (actingClip !== null && rig.oneShotName !== actingClip) actingClip = null;
      if (actingClip !== null && (isGuarded || isReduced)) cutActingNow(fades, isTravelling);
      // His claps (D8), on Papa's model: each slot is seen by the one frame whose step clock first reaches it; a
      // slot he is not free for shows nothing, and the next comes on time. The first frame after a restart starts none.
      if (lastSlotSimMs === null || life.simMs < lastSlotSimMs) {
        lastSlotSimMs = life.simMs;
      } else if (dtMs > 0 && life.simMs > lastSlotSimMs) {
        idleSlotAt(
          life.levelSeed,
          BABY_IDLE_SALT,
          baby.enteredAt,
          life.simMs,
          characters.babyIdles,
          IDLE_CLIPS.length,
          clapSlot,
        );
        if (
          clapSlot.index >= 0 &&
          clapSlot.startAt > lastSlotSimMs &&
          clip === SIT_CLIP &&
          isBabyClapEligible(
            baby,
            life.simMs,
            characters.babySit,
            isGuarded,
            isReduced,
            rig.oneShotName !== null,
          )
        ) {
          const clap = IDLE_CLIPS[clapSlot.variant] as string;
          rig.playOnce(clap, fades.otherMs);
          actingClip = clap;
        }
        lastSlotSimMs = life.simMs;
      }
      if (!isBodyPlaced) {
        isBodyPlaced = true;
        resetSpring(bodySpring, pose.yawRad);
      }
      const { turn } = characters;
      const bodyYawRad = stepAngleSpring(
        bodySpring,
        pose.yawRad,
        dtMs,
        turn.reachMs,
        isReduced ? 1 : turn.dampingRatio,
        turn.overshootMaxDeg * DEG_TO_RAD,
      );
      body.rotation.y = bodyYawRad;
      // The gaze never waits: the head makes up for whatever the body has not turned yet, swing included.
      headBone.rotation.y = wrapAngleRad(pose.yawRad - bodyYawRad);
      rig.update(dtMs, characters.fades.returnMs);
      // His breath over the clip (D3, D7): the same period as Papa's, never held.
      const breathFactor = stepBreath(
        breath,
        dtMs,
        breathPeriodMsOf(characters.breath, life.isAlert),
        false,
        isReduced,
      );
      breathNowDeg = breathFactor * characters.breath.babyAmplitudeDeg;
      offsetEuler.set(breathNowDeg * DEG_TO_RAD, 0, 0);
      spine.quaternion.multiply(offset.setFromEuler(offsetEuler));
      // His brows on his expression, last (D2, D9, D14).
      const face = characters.expressions.baby;
      stepBrows(
        browState,
        life.babyExpression === 'neutral' ? REST_BROW_POSE : face.poses[life.babyExpression],
        dtMs,
        characters.expressions.reachMs,
      );
      browScaleNowPct = face.browScalePct;
      writeBrowBones(brows, browState.drawn, browScaleNowPct);
    },
    playOnce(clip, fadeMs) {
      rig.playOnce(clip, fadeMs);
    },
    get pose() {
      return pose;
    },
    get bodyYawRad() {
      return isBodyPlaced ? bodySpring.drawn : pose.yawRad;
    },
    get breathDeg() {
      return breathNowDeg;
    },
    get browTiltDeg() {
      return browState.drawn.tiltDeg;
    },
    get clipName() {
      return rig.clipName;
    },
    get actingClip() {
      return actingClip;
    },
    setSquash(xz, y) {
      body.scale.set(xz, y, xz);
    },
    setEyelids(amount01) {
      eyelids.scale.y = Math.max(EYELIDS_OPEN_SCALE, Math.min(1, amount01));
    },
    resetAnimation() {
      rig.reset();
      body.scale.set(1, 1, 1);
      eyelids.scale.y = EYELIDS_OPEN_SCALE;
      // A restart starts at rest (story 7.8): the body back on his gaze at the next frame.
      isBodyPlaced = false;
      loopClip = null;
      isLoopTravelling = false;
      // His acting starts over (story 7.12): no one-shot, no stop seated, no slot seen.
      actingClip = null;
      seatedStopAt = null;
      lastSlotSimMs = null;
      resetBreath(breath);
      breathNowDeg = 0;
      // The brows at rest now; the next frame snaps them on his expression (D9).
      unplaceBrows(browState);
      writeBrowBones(brows, browState.drawn, browScaleNowPct);
    },
    setLiftM(heightM) {
      hopM = heightM;
      placeY();
    },
    setSlideM(xM, zM, nextDropM = 0) {
      // Moves the group now (the slide is set after the frame's `update`), as `update` will next frame.
      group.position.x += xM - slideXM;
      group.position.z += zM - slideZM;
      slideXM = xM;
      slideZM = zM;
      if (nextDropM !== dropM) {
        dropM = nextDropM;
        placeY();
      }
    },
    dispose() {
      rig.dispose();
      scene.remove(group);
    },
  };
}
