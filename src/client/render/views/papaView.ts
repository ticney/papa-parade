import type { PapaSlice } from '@sim';
import { BoxGeometry, Color, ConeGeometry, Group, Mesh, type Object3D } from 'three';
import { type BlobKit, blobSizeM } from '../blobShadow.ts';
import { interpolateXZ, type PointXZ } from '../interpolate.ts';
import { PALETTE } from '../materials/palette.ts';
import type { ToonMaterialCache } from '../materials/toonMaterial.ts';

// Art constants (Geo tunes them here until the final art, E7), named with their units.
/** Papa's provisional cube is this tall, in metres. Its width is `2 × papaRadiusM`, from the feel. */
export const PAPA_HEIGHT_M = 0.9;
/** Never `parry`, `dodge` or `alert`: those colours belong to threats and signals. */
const PAPA_COLOR = PALETTE.primary;
/** Papa's hair, shown by the outlet gag: spikes of this height when fully on end, in metres. */
export const PAPA_HAIR_HEIGHT_M = 0.35;
/** ...each this wide at its base, as a share of Papa's width, in percent. */
const PAPA_HAIR_WIDTH_PCT = 18;
/** ...radial segments of a spike: a four-sided cone reads as a spike and costs 8 triangles. */
const PAPA_HAIR_SEGMENTS = 4;
/** Where the spikes stand on top of the cube, as shares of half his width in x and z, in percent. */
const PAPA_HAIR_SPOTS_PCT: readonly (readonly [number, number])[] = [
  [0, 0],
  [55, 55],
  [-55, 55],
  [55, -55],
  [-55, -55],
];
const PAPA_HAIR_COLOR = PALETTE.ink;

// The micro-sleep and the coffee (story 1.19, provisional until E7). Diegetic: 3D, never a DOM overlay.
/** The eyelids: an ink band that lowers over the top of the cube's front face, this tall when closed, in metres. */
const PAPA_EYELIDS_BAND_M = 0.3;
/** ...starting this far below the top of the cube, in metres. */
const PAPA_EYELIDS_TOP_GAP_M = 0.12;
const PAPA_EYELIDS_COLOR = PALETTE.ink;
/** The « Z » of a sleeping Papa floats this far above his head, in metres... */
const PAPA_Z_HEIGHT_M = 0.45;
/** ...bobs by this much, in metres... */
const PAPA_Z_BOB_M = 0.06;
/** ...once per this long, in sim ms. */
const PAPA_Z_BOB_PERIOD_MS = 1200;
/** Each bar of the « Z » is this long, in metres, and this thick. */
const PAPA_Z_SIZE_M = 0.2;
const PAPA_Z_THICKNESS_M = 0.04;
/** The mug in Papa's hand: a small cube this big, in metres, held to his right and in front. */
const PAPA_MUG_SIZE_M = 0.14;
const PAPA_MUG_COLOR = PALETTE.paper;

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

export interface PapaView {
  /** Where Papa was last drawn (interpolated): what a marker that follows him reads. */
  readonly pose: Readonly<PapaPose>;
  /** Moves the cube and its shadow. Allocates nothing. */
  update(papa: Readonly<PapaSlice>, alpha: number): void;
  /**
   * Lowers the ink eyelids over his face: 0 is open (hidden), 1 is shut. Clamped. Allocates nothing.
   */
  setEyelids(amount01: number): void;
  /**
   * A sleeping Papa: eyelids shut and a « Z » floating above his head, bobbing on `clockMs` (sim
   * ms). Off, it hides the « Z » and leaves the eyelids to `setEyelids`. Allocates nothing.
   */
  setAsleep(isAsleep: boolean, clockMs: number): void;
  /** A small mug at his hand while he drinks. Allocates nothing. */
  setDrinking(isDrinking: boolean): void;
  /**
   * Stands Papa's hair on end: 0 is flat (the spikes are hidden), 1 is fully up. A value outside
   * 0..1 is clamped. Allocates nothing.
   */
  setHair(amount01: number): void;
  /** Frees what the view made (its geometry); the shared materials belong to the scene. */
  dispose(): void;
}

/**
 * Papa as a provisional toon cube with a blob shadow under him (two draw calls). The blob does not
 * turn: it follows his position only. No outline yet (E7, or with the baby in story 1.8).
 */
export function createPapaView(
  scene: Object3D,
  toon: ToonMaterialCache,
  blobs: BlobKit,
  radiusM: number,
): PapaView {
  const widthM = Math.max(radiusM * 2, 0.01);
  const geometry = new BoxGeometry(widthM, PAPA_HEIGHT_M, widthM);
  const cube = new Mesh(geometry, toon.get(new Color(PAPA_COLOR)));
  cube.name = 'papa';
  cube.position.y = PAPA_HEIGHT_M / 2; // standing on the floor
  const shadow = blobs.createMesh('blob_papa');
  shadow.scale.set(blobSizeM(widthM), 1, blobSizeM(widthM));
  // The hair: a few ink spikes on top of the cube, one shared geometry, hidden until a gag raises it.
  const hairGeometry = new ConeGeometry(
    (widthM * PAPA_HAIR_WIDTH_PCT) / 100,
    PAPA_HAIR_HEIGHT_M,
    PAPA_HAIR_SEGMENTS,
  );
  hairGeometry.translate(0, PAPA_HAIR_HEIGHT_M / 2, 0); // the base at the origin, the tip along +y
  const hairMaterial = toon.get(new Color(PAPA_HAIR_COLOR));
  const hair = new Group();
  hair.name = 'papa_hair';
  hair.position.y = PAPA_HEIGHT_M;
  hair.visible = false;
  for (const [xPct, zPct] of PAPA_HAIR_SPOTS_PCT) {
    const spike = new Mesh(hairGeometry, hairMaterial);
    spike.name = 'papa_hair_spike';
    spike.position.set((widthM / 2) * (xPct / 100), 0, (widthM / 2) * (zPct / 100));
    hair.add(spike);
  }
  // The eyelids hang from just under the top of the cube and lower by scaling down from there.
  const eyelidsGeometry = new BoxGeometry(widthM * 1.04, PAPA_EYELIDS_BAND_M, widthM * 0.08);
  eyelidsGeometry.translate(0, -PAPA_EYELIDS_BAND_M / 2, 0);
  const eyelids = new Mesh(eyelidsGeometry, toon.get(new Color(PAPA_EYELIDS_COLOR)));
  eyelids.name = 'papa_eyelids';
  eyelids.position.set(0, PAPA_HEIGHT_M / 2 - PAPA_EYELIDS_TOP_GAP_M, widthM / 2);
  eyelids.visible = false;
  cube.add(eyelids);
  // The « Z »: two bars and a diagonal, in ink, above the head.
  const zBarGeometry = new BoxGeometry(PAPA_Z_SIZE_M, PAPA_Z_THICKNESS_M, PAPA_Z_THICKNESS_M);
  const zDiagonalGeometry = new BoxGeometry(
    PAPA_Z_SIZE_M * Math.SQRT2,
    PAPA_Z_THICKNESS_M,
    PAPA_Z_THICKNESS_M,
  );
  const zMaterial = toon.get(new Color(PAPA_EYELIDS_COLOR));
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
  // The mug, held out to his right and in front of him; it turns with the cube.
  const mugGeometry = new BoxGeometry(PAPA_MUG_SIZE_M, PAPA_MUG_SIZE_M, PAPA_MUG_SIZE_M);
  const mug = new Mesh(mugGeometry, toon.get(new Color(PAPA_MUG_COLOR)));
  mug.name = 'papa_mug';
  mug.position.set(widthM * 0.7, 0, widthM * 0.6);
  mug.visible = false;
  cube.add(mug);
  const group = new Group();
  group.name = 'papa_group';
  group.add(cube, shadow, hair, zSign);
  scene.add(group);
  const pose: PapaPose = { xM: 0, zM: 0, yawRad: 0 };

  let asleepAmount = 0;
  let wantedEyelids = 0;
  const applyEyelids = (): void => {
    const amount = Math.max(wantedEyelids, asleepAmount);
    const isOpen = amount <= 0;
    eyelids.visible = !isOpen;
    eyelids.scale.y = isOpen ? 1 : amount;
  };

  return {
    get pose() {
      return pose;
    },
    update(papa, alpha) {
      papaPoseAt(papa, alpha, pose);
      // The group sits on the floor under him; only the cube turns (a round shadow looks the same
      // from every side).
      group.position.set(pose.xM, 0, pose.zM);
      cube.rotation.y = pose.yawRad;
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
    setDrinking(isDrinking) {
      mug.visible = isDrinking;
    },
    setHair(amount01) {
      const amount = Math.min(1, Math.max(0, amount01));
      hair.visible = amount > 0;
      hair.scale.y = amount > 0 ? amount : 1;
    },
    dispose() {
      geometry.dispose();
      hairGeometry.dispose();
      eyelidsGeometry.dispose();
      zBarGeometry.dispose();
      zDiagonalGeometry.dispose();
      mugGeometry.dispose();
      scene.remove(group);
    },
  };
}
