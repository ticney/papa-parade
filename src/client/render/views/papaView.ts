import { ISO_YAW_DEG } from '@shared/constants';
import type { BabySlice, PapaSlice } from '@sim';
import { BoxGeometry, Color, Group, Mesh, type Object3D } from 'three';
import { type BlobKit, blobSizeM } from '../blobShadow.ts';
import { interpolateXZ, type PointXZ } from '../interpolate.ts';
import { PALETTE } from '../materials/palette.ts';
import type { ToonMaterialCache } from '../materials/toonMaterial.ts';
import { papaClipOf } from './characterClips.ts';
import {
  busyCycleAt,
  type ClipFacings,
  clipTimeScaleOf,
  papaFacingYawRad,
  stepSpeedMpsOf,
  type TravelClips,
  turnToward,
} from './characterMotion.ts';
import { type CharacterRig, EYELIDS_OPEN_SCALE } from './characterRig.ts';

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

/** The three parts of Papa's look, each on its own (story 7.2, D2; story 3.7 will drive them). */
export interface PapaLook {
  readonly hasMashOnCheek: boolean;
  readonly hasHairOnEnd: boolean;
  readonly isShirtInsideOut: boolean;
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

/** What the view reads from the feedback table (`feedback.json › characters`). */
export interface CharacterMotionConfig {
  readonly turnRateDegPerSec: number;
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
   * Plays the loop the world says now, turns his body toward the facing of the clip the player sees (the
   * camera, away from the baby) or else his heading, and advances his mixer by `dtMs` of sim time; a
   * `dtMs` of 0 holds him. Allocates nothing once the clips have played once.
   */
  animate(papa: Readonly<PapaSlice>, baby: Readonly<BabySlice>, dtMs: number): void;
  /** Plays a clip once, over his loop. */
  playOnce(clip: string): void;
  /** The clip the player sees. */
  readonly clipName: string | null;
  /** His mixer's clock, in sim ms. */
  readonly mixerTimeMs: number;
  /** Scales his body, feet on the floor (the squash); the shadow stays. Allocates nothing. */
  setSquash(xz: number, y: number): void;
  /** Stops his clips and starts them over (a restart, a stopped loop). */
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
   * A handset at the side of his head while he is on the phone, and a bla-bla bubble beside it that
   * wobbles on `clockMs` (sim ms). Under reduced motion the bubble is shown, held at its rest transform.
   * Allocates nothing.
   */
  setOnPhone(isOnPhone: boolean, clockMs: number, isMotionReduced: boolean): void;
  /** The way his drawn body faces, in radians (0 faces +z, positive toward +x): it turns, the sim's heading does not. */
  readonly bodyYawRad: number;
  /** How far the steam leans now, in degrees; 0 while it is hidden or held. */
  readonly steamSwayDeg: number;
  /** How far the bla-bla bubble tilts now, in degrees; 0 while it is hidden or held. */
  readonly blablaTiltDeg: number;
  /**
   * Papa is out of the room (the toilet, story 4.3): the whole of him, blob shadow included, is
   * hidden, and drawn again with the next call that says he is back. Allocates nothing.
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
  // The bubble leaves the turning body for the group, which never turns, and stands beside his head on
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
  let bodyYawRad: number | null = null;
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
      if (bodyYawRad === null) {
        bodyYawRad = pose.yawRad;
        body.rotation.y = bodyYawRad;
      }
    },
    animate(papa, baby, dtMs) {
      const clip = papaClipOf(papa, baby);
      rig.play(clip, clipTimeScaleOf(clip, stepSpeedMpsOf(papa), motion.clips));
      // The clip the player sees (a one-shot over his loop) decides where he faces; his heading is the sim's.
      const wantedYawRad =
        papaFacingYawRad(papa, baby, rig.clipName, motion.clipFacing) ?? pose.yawRad;
      bodyYawRad = turnToward(
        bodyYawRad ?? wantedYawRad,
        wantedYawRad,
        motion.turnRateDegPerSec,
        dtMs,
      );
      body.rotation.y = bodyYawRad;
      rig.update(dtMs);
    },
    playOnce(clip) {
      rig.playOnce(clip);
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
      return bodyYawRad ?? pose.yawRad;
    },
    get steamSwayDeg() {
      return steamSwayNowDeg;
    },
    get blablaTiltDeg() {
      return blablaTiltNowDeg;
    },
    setAway(isAway) {
      group.visible = !isAway;
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
