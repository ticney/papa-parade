import type { PropSlice } from '@sim';
import { BoxGeometry, Group, Mesh, MeshToonMaterial, Quaternion } from 'three';
import { describe, expect, it } from 'vitest';
import { createBlobKit } from '../blobShadow.ts';
import { BROKEN_SCALE_Y, createPropView, type PropPose3D, propPoseAt } from './propView.ts';

function propAt(overrides: Partial<PropSlice> = {}): PropSlice {
  return {
    id: 'mug_01',
    kind: 'mug',
    xM: 1,
    yM: 0.5,
    zM: -1,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
    prevXM: 0,
    prevYM: 0.7,
    prevZM: -1,
    prevQx: 0,
    prevQy: 0,
    prevQz: 0,
    prevQw: 1,
    isOnFloor: false,
    isBroken: false,
    lastImpactAt: null,
    ...overrides,
  };
}

const newPose = (): PropPose3D => ({ xM: 0, yM: 0, zM: 0, quaternion: new Quaternion() });

/** A quarter turn about y, as a unit quaternion. */
const QUARTER_Y = { qy: Math.sin(Math.PI / 4), qw: Math.cos(Math.PI / 4) };

describe('propPoseAt', () => {
  it('lerps the position between the two steps', () => {
    const out = newPose();
    propPoseAt(propAt(), 0, out);
    expect([out.xM, out.yM, out.zM]).toEqual([0, 0.7, -1]);
    propAt();
    propPoseAt(propAt(), 0.5, out);
    expect(out.xM).toBeCloseTo(0.5, 12);
    expect(out.yM).toBeCloseTo(0.6, 12);
    propPoseAt(propAt(), 1, out);
    expect([out.xM, out.yM, out.zM]).toEqual([1, 0.5, -1]);
  });

  it('slerps the rotation: halfway between none and a quarter turn is an eighth', () => {
    const out = newPose();
    propPoseAt(propAt(QUARTER_Y), 0.5, out);
    const eighth = Math.PI / 8;
    expect(out.quaternion.y).toBeCloseTo(Math.sin(eighth), 9);
    expect(out.quaternion.w).toBeCloseTo(Math.cos(eighth), 9);
    expect(out.quaternion.length()).toBeCloseTo(1, 12);
    propPoseAt(propAt(QUARTER_Y), 0, out);
    expect(out.quaternion.w).toBeCloseTo(1, 12);
    propPoseAt(propAt(QUARTER_Y), 1, out);
    expect(out.quaternion.y).toBeCloseTo(QUARTER_Y.qy, 12);
  });

  it('keeps a prop at rest where it is, whatever alpha is', () => {
    const rest = propAt({ prevXM: 1, prevYM: 0.5, prevZM: -1 });
    const out = newPose();
    for (const alpha of [0, 0.37, 1]) {
      propPoseAt(rest, alpha, out);
      expect([out.xM, out.yM, out.zM]).toEqual([1, 0.5, -1]);
      expect(out.quaternion.w).toBeCloseTo(1, 12);
    }
  });

  it('writes into `out` and keeps its quaternion object', () => {
    const out = newPose();
    const quaternion = out.quaternion;
    propPoseAt(propAt(), 0.3, out);
    expect(out.quaternion).toBe(quaternion);
  });
});

describe('createPropView', () => {
  function build() {
    const material = new MeshToonMaterial();
    const geometry = new BoxGeometry(0.1, 0.1, 0.1);
    const template = new Group();
    template.name = 'PROP_mug_01';
    template.position.set(0.7, 0.5, -0.6);
    template.add(new Mesh(geometry, material));
    const blobs = createBlobKit();
    const view = createPropView('mug', template, blobs, { halfExtentsM: [0.05, 0.05, 0.05] });
    return { view, template, geometry, material };
  }

  it('is a clone of the template that shares its geometry and its material, hidden at first', () => {
    const { view, template, geometry, material } = build();
    const body = view.object.getObjectByName('prop_mug') as Group;
    expect(body).not.toBe(template);
    const mesh = body.children[0] as Mesh;
    expect(mesh.geometry).toBe(geometry);
    expect(mesh.material).toBe(material);
    expect(view.object.visible).toBe(false);
    expect(view.kind).toBe('mug');
  });

  it('places the body at the interpolated pose, and the shadow on the floor under it', () => {
    const { view } = build();
    view.update(propAt({ prevXM: 0, xM: 1, prevYM: 1, yM: 0.5, prevZM: -2, zM: -1 }), 0.5);
    const body = view.object.getObjectByName('prop_mug') as Group;
    const shadow = view.object.getObjectByName('blob_mug') as Mesh;
    expect(view.object.visible).toBe(true);
    expect(body.position.toArray()).toEqual([0.5, 0.75, -1.5]);
    expect(shadow.position.x).toBe(0.5);
    expect(shadow.position.z).toBe(-1.5);
    expect(shadow.position.y).toBeLessThan(0.01); // on the floor, not at the prop's height
  });

  it('turns the body with the prop and leaves the shadow flat', () => {
    const { view } = build();
    view.update(propAt({ ...QUARTER_Y }), 1);
    const body = view.object.getObjectByName('prop_mug') as Group;
    const shadow = view.object.getObjectByName('blob_mug') as Mesh;
    expect(body.quaternion.y).toBeCloseTo(QUARTER_Y.qy, 12);
    expect(shadow.quaternion.w).toBe(1);
  });

  it('squashes a broken prop and sets it back on the floor', () => {
    const { view } = build();
    const body = view.object.getObjectByName('prop_mug') as Group;
    view.update(propAt({ prevYM: 0.05, yM: 0.05, isBroken: false }), 1);
    expect(body.scale.y).toBe(1);
    expect(body.position.y).toBe(0.05);
    view.update(propAt({ prevYM: 0.05, yM: 0.05, isBroken: true }), 1);
    expect(body.scale.y).toBeCloseTo(BROKEN_SCALE_Y, 12);
    // The bottom stays where it was: 0.05 - 0.05 = 0.
    expect(body.position.y - 0.05 * BROKEN_SCALE_Y).toBeCloseTo(0, 12);
  });

  it('hide() hides it, the next update shows it again, and dispose takes it out of its parent', () => {
    const { view } = build();
    const parent = new Group();
    parent.add(view.object);
    view.update(propAt(), 0);
    view.hide();
    expect(view.object.visible).toBe(false);
    view.update(propAt(), 0);
    expect(view.object.visible).toBe(true);
    view.dispose();
    expect(parent.children).toEqual([]);
  });

  it('does not touch the template', () => {
    const { view, template } = build();
    view.update(propAt(), 0.5);
    expect(template.position.toArray()).toEqual([0.7, 0.5, -0.6]);
  });
});
