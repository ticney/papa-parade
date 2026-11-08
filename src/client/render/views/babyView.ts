import type { BabySlice, PapaSlice } from '@sim';
import { Euler, Group, type Object3D, Quaternion } from 'three';
import { type BlobKit, blobSizeM } from '../blobShadow.ts';
import { interpolateXZ, type PointXZ } from '../interpolate.ts';
import { BABY_TRAVELLING, babyClipOf } from './characterClips.ts';
import { fadeMsOf } from './characterFades.ts';
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
import type { CharacterMotionConfig } from './papaView.ts';

/** The bone the baby's life layer writes over his clips (story 7.8, D3): the torso. His head is the gaze. */
export const BABY_LIFE_BONES = ['spine'] as const;
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
   * him. Allocates nothing once the clips have played once.
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
  /** The clip the player sees. */
  readonly clipName: string | null;
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
  const breath = createBreathState();
  let breathNowDeg = 0;
  const offsetEuler = new Euler(0, 0, 0, 'XYZ');
  const offset = new Quaternion();
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
      const isReduced = life.isMotionReduced;
      // The loop, and the passage it is (D4).
      const clip = babyClipOf(baby);
      const isTravelling = BABY_TRAVELLING[baby.state];
      let fadeMs = characters.fades.otherMs;
      if (clip !== loopClip) {
        fadeMs = fadeMsOf(isLoopTravelling, isTravelling, 'loop', characters.fades);
        loopClip = clip;
        isLoopTravelling = isTravelling;
      }
      rig.play(clip, clipTimeScaleOf(clip, stepSpeedMpsOf(baby), motion.clips), fadeMs);
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
    get clipName() {
      return rig.clipName;
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
      resetBreath(breath);
      breathNowDeg = 0;
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
