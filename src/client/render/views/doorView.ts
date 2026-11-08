import type { FeedbackTable } from '@content/schemas/feedback';
import { BoxGeometry, Color, Group, Mesh } from 'three';
import { PALETTE } from '../materials/palette.ts';
import type { ToonMaterialCache } from '../materials/toonMaterial.ts';

/** The door's numbers (`feedback.json › door`): how long it takes to swing open, how far, and its size. */
export type DoorLook = FeedbackTable['door'];

/** The door's colour, a code-made panel that story 7.3 leaves as it is: plain paper, so that a closed door reads against the wall. */
const DOOR_COLOR = PALETTE.paper;

/** A unit step on the floor plane: `x` and `z` of a direction. */
export interface PlanarDir {
  readonly x: number;
  readonly z: number;
}

/** Where the door stands and which way it swings. */
export interface DoorPlacement {
  /** The hinge's floor point, in metres. */
  readonly hingeXM: number;
  readonly hingeZM: number;
  /** The unit direction of the closed panel, from the hinge along the wall. */
  readonly tangent: PlanarDir;
  /** The unit direction into the room, perpendicular to the wall: the way the door opens. */
  readonly inward: PlanarDir;
}

/**
 * Where a door at `(anchorXM, anchorZM)` stands in a room with bounds `[minXM, minZM]`-`[maxXM,
 * maxZM]`: parallel to the nearest wall of the bounds (D7), centred on the anchor, hinged at the end
 * it starts from (the one opposite the tangent) and swinging into the room. Pure.
 */
export function doorPlacementOf(
  anchorXM: number,
  anchorZM: number,
  minXM: number,
  minZM: number,
  maxXM: number,
  maxZM: number,
  widthM: number,
): DoorPlacement {
  const gaps = [
    { gapM: anchorXM - minXM, normal: { x: 1, z: 0 } },
    { gapM: maxXM - anchorXM, normal: { x: -1, z: 0 } },
    { gapM: anchorZM - minZM, normal: { x: 0, z: 1 } },
    { gapM: maxZM - anchorZM, normal: { x: 0, z: -1 } },
  ];
  let nearest = gaps[0] as (typeof gaps)[number];
  for (const candidate of gaps) if (candidate.gapM < nearest.gapM) nearest = candidate;
  const inward = nearest.normal;
  // The tangent is the inward direction turned a quarter: (0, 1) -> (1, 0), (1, 0) -> (0, -1) ...
  // so that the pair is the same handedness on every wall. The `+ 0`s turn a `-0` into `0`.
  const tangent: PlanarDir = { x: inward.z, z: -inward.x + 0 };
  return {
    hingeXM: anchorXM - (tangent.x * widthM) / 2,
    hingeZM: anchorZM - (tangent.z * widthM) / 2,
    tangent: { x: tangent.x + 0, z: tangent.z + 0 },
    inward,
  };
}

/**
 * How far the door is open at the render's sim clock `clockMs`, in degrees: shut until the rush
 * starts (`finalRushAt` null, or still ahead), then a smooth swing over `openMs` to `openAngleDeg`, and open
 * from then on (through `photo`, and `ended` after a `mamaWoke` in the rush). `isMotionReduced`
 * jumps it open at the rush's start. Mama come home early (`isBurstOpen`, story 3.16 D7) bursts it
 * open at once: the end photo is taken in the very step that ends the level, so a swing would never
 * show, and there is no rush to count from. Pure: a pause or a slow-mo holds it, since the clock does.
 */
export function doorOpenAngleDegAt(
  finalRushAt: number | null,
  clockMs: number,
  look: Pick<DoorLook, 'openMs' | 'openAngleDeg'>,
  isMotionReduced: boolean,
  isBurstOpen = false,
): number {
  if (isBurstOpen) return look.openAngleDeg;
  if (finalRushAt === null || clockMs < finalRushAt) return 0;
  if (isMotionReduced) return look.openAngleDeg;
  const progress = Math.min(1, Math.max(0, (clockMs - finalRushAt) / look.openMs));
  // Smoothstep: the door starts slowly, as a hand turning a key would.
  return look.openAngleDeg * progress * progress * (3 - 2 * progress);
}

/**
 * The yaw (`Object3D.rotation.y`, radians) of a panel hinged at the placement and opened by
 * `angleDeg`: its direction turns from the tangent towards the inward normal. Pure.
 */
export function doorYawRadAt(placement: DoorPlacement, angleDeg: number): number {
  const angle = (angleDeg * Math.PI) / 180;
  const { tangent, inward } = placement;
  const dirX = tangent.x * Math.cos(angle) + inward.x * Math.sin(angle);
  const dirZ = tangent.z * Math.cos(angle) + inward.z * Math.sin(angle);
  // three.js turns +x towards -z for a positive yaw: (cos y, 0, -sin y) is the panel's direction.
  // `+ 0`: no `-0`, which a `toEqual` tells from `0`.
  return Math.atan2(-dirZ, dirX) + 0;
}

export interface DoorView {
  /**
   * Draws the door at the render's sim clock; allocates nothing. `isBurstOpen` is a Mama come home
   * early (`world.flow.endReason === 'mamaHome'`, story 3.16): open at once, no swing.
   */
  update(
    finalRushAt: number | null,
    clockMs: number,
    isMotionReduced: boolean,
    isBurstOpen?: boolean,
  ): void;
  /** How open the door was last drawn, in degrees (the debug `fx()`). */
  readonly openAngleDeg: number;
  /** The panel's group, for the scene's tests. */
  readonly object: Group;
}

/**
 * The closed door panel (story 3.5, D7): a hinged box standing at the level's `ANCHOR_door`, parallel
 * to the nearest wall, one draw call. The scene's model has a `door_frame` and no panel; E7 replaces this
 * with a modelled door. The geometry and the material belong to the scene (disposed with it).
 */
export function createDoorView(
  parent: Group,
  toon: ToonMaterialCache,
  look: DoorLook,
  placement: DoorPlacement,
): DoorView {
  const hinge = new Group();
  hinge.name = 'door_panel';
  hinge.position.set(placement.hingeXM, 0, placement.hingeZM);
  const panel = new Mesh(
    new BoxGeometry(look.widthM, look.heightM, look.thicknessM),
    toon.get(new Color(DOOR_COLOR)),
  );
  // The box is centred: half its width along the panel, half its height up. Its thickness is across the wall.
  panel.position.set(look.widthM / 2, look.heightM / 2, 0);
  hinge.add(panel);
  hinge.rotation.y = doorYawRadAt(placement, 0);
  parent.add(hinge);
  let drawnAngleDeg = 0;
  return {
    object: hinge,
    get openAngleDeg() {
      return drawnAngleDeg;
    },
    update(finalRushAt, clockMs, isMotionReduced, isBurstOpen = false) {
      const angleDeg = doorOpenAngleDegAt(finalRushAt, clockMs, look, isMotionReduced, isBurstOpen);
      if (angleDeg === drawnAngleDeg) return;
      drawnAngleDeg = angleDeg;
      hinge.rotation.y = doorYawRadAt(placement, angleDeg);
    },
  };
}
