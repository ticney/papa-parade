import type { PropSlice } from '@sim';
import { Group, type Object3D, Quaternion } from 'three';
import { type BlobKit, blobSizeM } from '../blobShadow.ts';
import { interpolateXYZ, type PointXYZ } from '../interpolate.ts';

// Art constants (Geo tunes them here until the final art, E7), named with their units.
/** A broken prop is drawn squashed to this share of its height (1 = whole): the provisional « broken » look. */
export const BROKEN_SCALE_Y = 0.35;

/** Where a prop is drawn and how it is turned. */
export interface PropPose3D extends PointXYZ {
  quaternion: Quaternion;
}

// Reused by every call: `propPoseAt` is called per prop, per frame.
const fromQuaternion = new Quaternion();
const toQuaternion = new Quaternion();
const lerped: PointXYZ = { xM: 0, yM: 0, zM: 0 };
const prevPoint: PointXYZ = { xM: 0, yM: 0, zM: 0 };
const point: PointXYZ = { xM: 0, yM: 0, zM: 0 };

/**
 * A prop's pose `alpha` of the way from the last step to the next: the position interpolated
 * linearly and the rotation spherically, between the pose at the start of the last step and the
 * one at its end (the sim keeps both, so that the view can). Pure and allocation-free: it writes
 * `out` (whose `quaternion` the caller made once).
 */
export function propPoseAt(prop: Readonly<PropSlice>, alpha: number, out: PropPose3D): void {
  prevPoint.xM = prop.prevXM;
  prevPoint.yM = prop.prevYM;
  prevPoint.zM = prop.prevZM;
  point.xM = prop.xM;
  point.yM = prop.yM;
  point.zM = prop.zM;
  interpolateXYZ(prevPoint, point, alpha, lerped);
  out.xM = lerped.xM;
  out.yM = lerped.yM;
  out.zM = lerped.zM;
  fromQuaternion.set(prop.prevQx, prop.prevQy, prop.prevQz, prop.prevQw);
  toQuaternion.set(prop.qx, prop.qy, prop.qz, prop.qw);
  out.quaternion.slerpQuaternions(fromQuaternion, toQuaternion, alpha);
}

/** What a view needs of its prop's size: the box the shadow sits under, and the height it squashes from. */
export interface PropFootprint {
  /** Half the size of the prop's box along x, y and z, in metres. */
  halfExtentsM: readonly [number, number, number];
}

export interface PropView {
  /** The kind this view draws (`mug`): the pool it goes back to. */
  readonly kind: string;
  /** The group to add to the scene: the body and its blob shadow. Hidden until the first `update`. */
  readonly object: Group;
  /** Places the body at the interpolated pose, squashes it if the prop is broken, and moves its shadow. Allocates nothing. */
  update(prop: Readonly<PropSlice>, alpha: number): void;
  /** Hides the view (it goes back to its pool). */
  hide(): void;
  /** Takes the view out of the scene. The geometry and the materials are shared with the template: the scene frees them. */
  dispose(): void;
}

/**
 * A prop as a clone of `template` (the `.glb` node of its kind, sharing its geometry and its toon
 * material) with a blob shadow under it. Not instanced: a handful of props cost a handful of draw
 * calls, and instancing waits for about ten (story 1.15, D14). The shadow stays on the floor under
 * the prop and does not turn with it.
 */
export function createPropView(
  kind: string,
  template: Object3D,
  blobs: BlobKit,
  footprint: PropFootprint,
): PropView {
  const [hx, hy, hz] = footprint.halfExtentsM;
  const body = template.clone(true);
  body.name = `prop_${kind}`;
  const baseScaleY = body.scale.y;
  const shadow = blobs.createMesh(`blob_${kind}`);
  shadow.scale.set(blobSizeM(hx * 2), 1, blobSizeM(hz * 2));
  const floorLiftM = shadow.position.y; // the blob's own lift above the floor
  const object = new Group();
  object.name = `prop_view_${kind}`;
  object.add(body, shadow);
  object.visible = false;
  const pose: PropPose3D = { xM: 0, yM: 0, zM: 0, quaternion: new Quaternion() };
  // A broken prop is squashed around its centre; this brings it back down to where its bottom was.
  const brokenDropM = (1 - BROKEN_SCALE_Y) * hy;

  return {
    kind,
    object,
    update(prop, alpha) {
      propPoseAt(prop, alpha, pose);
      body.position.set(pose.xM, pose.yM - (prop.isBroken ? brokenDropM : 0), pose.zM);
      body.quaternion.copy(pose.quaternion);
      body.scale.y = prop.isBroken ? baseScaleY * BROKEN_SCALE_Y : baseScaleY;
      shadow.position.set(pose.xM, floorLiftM, pose.zM);
      object.visible = true;
    },
    hide() {
      object.visible = false;
    },
    dispose() {
      object.removeFromParent();
    },
  };
}
