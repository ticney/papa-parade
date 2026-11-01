import type { BabySlice, PapaSlice } from '@sim';
import { Color, ConeGeometry, Group, IcosahedronGeometry, Mesh, type Object3D } from 'three';
import { type BlobKit, blobSizeM } from '../blobShadow.ts';
import { interpolateXZ, type PointXZ } from '../interpolate.ts';
import { PALETTE } from '../materials/palette.ts';
import type { ToonMaterialCache } from '../materials/toonMaterial.ts';

// Art constants (Geo tunes them here until the final art, E7), named with their units.
/** Subdivision of the icosphere: 1 is a 80-triangle ball, round enough from the iso camera. */
const BABY_BODY_DETAIL = 1;
/** Colour of the body: white keeps the baby apart from Papa, never a threat or signal colour. */
const BABY_COLOR = PALETTE.paper;
const BABY_GAZE_COLOR = PALETTE.ink;
/** The gaze marker (a small cone) is this long, as a share of the body radius, in percent. */
const BABY_GAZE_LENGTH_PCT = 55;
/** ...this wide at its base, as a share of the body radius, in percent. */
const BABY_GAZE_WIDTH_PCT = 40;
/** The marker sits at this height on the body, as a share of the radius above the centre, in percent. */
const BABY_GAZE_HEIGHT_PCT = 25;
/** Smallest body radius drawn, in metres: a feel with no radius still shows a (tiny) baby. */
const BABY_MIN_RADIUS_M = 0.01;
/** Radial segments of the gaze cone: a six-sided cone reads as a cone and costs 12 triangles. */
const BABY_GAZE_SEGMENTS = 6;

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
   * Moves the baby, turns its gaze marker and moves its shadow. While he is `carried` he is drawn
   * lifted to Papa's chest, a little in front of him, riding Papa's interpolated pose (`papa`; his
   * own, which equals Papa's, when none is given), on top of any `setLiftM` hop. `layDownPct` (0 to 100,
   * default 0) lowers a carried baby from Papa's chest to the laid height (story 4.8: the bomb drop).
   * Allocates nothing.
   */
  update(
    baby: Readonly<BabySlice>,
    alpha: number,
    papa?: Readonly<PapaSlice>,
    layDownPct?: number,
  ): void;
  /**
   * Lifts the body and its gaze marker `heightM` above the floor (the « lift the baby » pose); the
   * shadow stays on the floor. It adds to the carried lift instead of replacing it. Allocates nothing.
   */
  setLiftM(heightM: number): void;
  /**
   * Offsets the whole view (body, gaze marker and shadow) from the sim position by (`xM`, `zM`) on
   * the floor plane: the stairs gag's slide. It holds until set again, across `update`s. (0, 0)
   * puts the baby back. Allocates nothing.
   */
  setSlideM(xM: number, zM: number): void;
  /** Frees what the view made (its geometries); the shared materials belong to the scene. */
  dispose(): void;
}

/**
 * The baby as a provisional toon sphere with a gaze marker and a blob shadow under it (three draw
 * calls). The marker is on a group that turns toward the gaze; the shadow does not turn. No
 * outline yet (E7).
 */
export function createBabyView(
  scene: Object3D,
  toon: ToonMaterialCache,
  blobs: BlobKit,
  radiusM: number,
  laidHeightM: number = BABY_CARRIED_HEIGHT_M,
): BabyView {
  const bodyRadiusM = Math.max(radiusM, BABY_MIN_RADIUS_M);
  const bodyGeometry = new IcosahedronGeometry(bodyRadiusM, BABY_BODY_DETAIL);
  const body = new Mesh(bodyGeometry, toon.get(new Color(BABY_COLOR)));
  body.name = 'baby';

  // A cone points along +y: laid down so that its tip points along +z, the group's forward.
  const gazeLengthM = (bodyRadiusM * BABY_GAZE_LENGTH_PCT) / 100;
  const gazeGeometry = new ConeGeometry(
    (bodyRadiusM * BABY_GAZE_WIDTH_PCT) / 100,
    gazeLengthM,
    BABY_GAZE_SEGMENTS,
  );
  gazeGeometry.translate(0, gazeLengthM / 2, 0); // the base at the origin, the tip along +y
  gazeGeometry.rotateX(Math.PI / 2);
  const gaze = new Mesh(gazeGeometry, toon.get(new Color(BABY_GAZE_COLOR)));
  gaze.name = 'baby_gaze';
  // Its base is on the surface (at this height, where the sphere is a little narrower than at the
  // equator), its tip out in front.
  const gazeHeightM = (bodyRadiusM * BABY_GAZE_HEIGHT_PCT) / 100;
  gaze.position.set(0, gazeHeightM, Math.sqrt(bodyRadiusM ** 2 - gazeHeightM ** 2));
  const gazeGroup = new Group();
  gazeGroup.name = 'baby_gaze_group';
  gazeGroup.position.y = bodyRadiusM; // the centre of the body
  gazeGroup.add(gaze);

  const shadow = blobs.createMesh('blob_baby');
  shadow.scale.set(blobSizeM(bodyRadiusM * 2), 1, blobSizeM(bodyRadiusM * 2));

  const group = new Group();
  group.name = 'baby_group';
  body.position.y = bodyRadiusM; // resting on the floor
  group.add(body, gazeGroup, shadow);
  scene.add(group);
  const pose: BabyPose = { xM: 0, zM: 0, yawRad: 0 };
  let slideXM = 0;
  let slideZM = 0;
  /** The hop of the response choreography (`setLiftM`) and the lift of the carry, summed in `placeY`. */
  let hopM = 0;
  let carriedLiftM = 0;
  const placeY = (): void => {
    body.position.y = bodyRadiusM + hopM + carriedLiftM;
    gazeGroup.position.y = bodyRadiusM + hopM + carriedLiftM;
  };

  return {
    update(baby, alpha, papa, layDownPct = 0) {
      babyPoseAt(baby, alpha, pose);
      let wantedLiftM = 0;
      if (baby.state === 'carried') {
        if (papa !== undefined) {
          interpolateXZ(papa.prevXM, papa.prevZM, papa.xM, papa.zM, alpha, pose);
        }
        // In front of Papa, along the way he faces (the baby's gaze follows Papa's heading).
        pose.xM += baby.gazeX * BABY_CARRIED_FORWARD_M;
        pose.zM += baby.gazeZ * BABY_CARRIED_FORWARD_M;
        // The lowering of the bomb drop: linear from the chest to the mattress. Motion-essential, so
        // it stays under reduced motion: it is what the release is aimed at.
        const heightM =
          BABY_CARRIED_HEIGHT_M + (laidHeightM - BABY_CARRIED_HEIGHT_M) * (layDownPct / 100);
        wantedLiftM = heightM - bodyRadiusM;
      }
      group.position.set(pose.xM + slideXM, 0, pose.zM + slideZM);
      gazeGroup.rotation.y = pose.yawRad;
      if (wantedLiftM !== carriedLiftM) {
        carriedLiftM = wantedLiftM;
        placeY();
      }
    },
    setLiftM(heightM) {
      hopM = heightM;
      placeY();
    },
    setSlideM(xM, zM) {
      // Moves the group now (the slide is set after the frame's `update`), as `update` will next frame.
      group.position.x += xM - slideXM;
      group.position.z += zM - slideZM;
      slideXM = xM;
      slideZM = zM;
    },
    dispose() {
      bodyGeometry.dispose();
      gazeGeometry.dispose();
      scene.remove(group);
    },
  };
}
