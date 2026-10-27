import type { BabySlice } from '@sim';
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
  /** Moves the baby, turns its gaze marker and moves its shadow. Allocates nothing. */
  update(baby: Readonly<BabySlice>, alpha: number): void;
  /**
   * Lifts the body and its gaze marker `heightM` above the floor (the « lift the baby » pose); the
   * shadow stays on the floor. Allocates nothing.
   */
  setLiftM(heightM: number): void;
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

  return {
    update(baby, alpha) {
      babyPoseAt(baby, alpha, pose);
      group.position.set(pose.xM, 0, pose.zM);
      gazeGroup.rotation.y = pose.yawRad;
    },
    setLiftM(heightM) {
      body.position.y = bodyRadiusM + heightM;
      gazeGroup.position.y = bodyRadiusM + heightM;
    },
    dispose() {
      bodyGeometry.dispose();
      gazeGeometry.dispose();
      scene.remove(group);
    },
  };
}
