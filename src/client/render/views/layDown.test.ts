import { asSimMs } from '@shared/time';
import type { BabySlice, World } from '@sim';
import { type Mesh, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { createTestBaby } from '../../../../tests/support/testCharacters.ts';
import { createBlobKit } from '../blobShadow.ts';
import { layDownPctAt } from '../levelScene.ts';
import { createOutlineKit } from '../materials/outlineHull.ts';
import { createToonMaterialCache } from '../materials/toonMaterial.ts';
import { BABY_CARRIED_HEIGHT_M, createBabyView, layDownProgressPct } from './babyView.ts';
import { createCharacterRig } from './characterRig.ts';

const TOON_TONES = [96, 178, 255];

// The descent of the bomb drop on screen (story 4.8): the carried baby is lowered linearly from Papa's
// chest to the laid height, from the telegraph to the final pose, on the render's sim clock.

const threat = (state: string, enteredAt = 1000, windowOpenAt = 3600) => ({
  state,
  enteredAt,
  windowOpenAt,
});

describe('layDownProgressPct (story 4.8)', () => {
  it('goes from 0 at the telegraph to 100 at the final pose, linearly', () => {
    expect(layDownProgressPct(threat('telegraph'), 1000)).toBe(0);
    expect(layDownProgressPct(threat('telegraph'), 2300)).toBeCloseTo(50, 10);
    expect(layDownProgressPct(threat('telegraph'), 3600)).toBe(100);
    const quarter = layDownProgressPct(threat('telegraph'), 1000 + 2600 / 4);
    expect(quarter).toBeCloseTo(25, 10);
  });

  it('is clamped: a clock before the telegraph or past the pose stays in range', () => {
    expect(layDownProgressPct(threat('telegraph'), 0)).toBe(0);
    expect(layDownProgressPct(threat('telegraph'), 99_999)).toBe(100);
  });

  it('is 100 in windowOpen, whatever the clock says', () => {
    expect(layDownProgressPct(threat('windowOpen'), 0)).toBe(100);
    expect(layDownProgressPct(threat('windowOpen'), 99_999)).toBe(100);
  });

  it('is 0 for a threat that is not running: a gag or a retreat sends him back up at once', () => {
    for (const state of ['idle', 'gag', 'resolved', 'hidden']) {
      expect(layDownProgressPct(threat(state), 2300), state).toBe(0);
    }
  });

  it('is 100 for a telegraph that has no length, rather than a division by zero', () => {
    expect(layDownProgressPct(threat('telegraph', 1000, 1000), 1000)).toBe(100);
  });
});

describe('layDownPctAt (story 4.8)', () => {
  const worldWith = (threats: { defId: string; state: string }[]): World =>
    ({
      threats: threats.map((entry, id) => ({
        id,
        ...entry,
        enteredAt: asSimMs(1000),
        windowOpenAt: asSimMs(3600),
      })),
    }) as unknown as World;

  it('reads the running threat of a listed def and ignores the others', () => {
    const world = worldWith([
      { defId: 'outlet', state: 'telegraph' },
      { defId: 'bomb_drop_lay', state: 'telegraph' },
    ]);
    expect(layDownPctAt(world, 2300, ['bomb_drop_lay'])).toBeCloseTo(50, 10);
    expect(layDownPctAt(world, 2300, [])).toBe(0);
    expect(layDownPctAt(world, 2300, ['another'])).toBe(0);
  });

  it('is 0 while the threat rests, and 100 once the pose has come', () => {
    expect(
      layDownPctAt(worldWith([{ defId: 'bomb_drop_lay', state: 'idle' }]), 2300, ['bomb_drop_lay']),
    ).toBe(0);
    expect(
      layDownPctAt(worldWith([{ defId: 'bomb_drop_lay', state: 'windowOpen' }]), 0, [
        'bomb_drop_lay',
      ]),
    ).toBe(100);
  });
});

describe('the carried baby lowered onto the mattress (story 4.8)', () => {
  const radiusM = 0.2;
  const laidHeightM = 0.3;
  const carried = (): BabySlice =>
    ({
      state: 'carried',
      enteredAt: asSimMs(0),
      xM: 0,
      zM: 0,
      prevXM: 0,
      prevZM: 0,
      headingX: 0,
      headingZ: 1,
      gazeX: 0,
      gazeZ: 1,
    }) as unknown as BabySlice;
  const MOTION = { clips: [] };
  const viewOf = (scene: Scene, laid?: number) =>
    createBabyView(
      scene,
      createBlobKit(),
      radiusM,
      createCharacterRig(
        createTestBaby(),
        createToonMaterialCache(TOON_TONES),
        createOutlineKit({ widthM: 0.025, skipMaterials: ['art_ink'] }),
      ),
      MOTION,
      laid,
    );
  const build = () => {
    const scene = new Scene();
    const view = viewOf(scene, laidHeightM);
    const body = scene.getObjectByName('baby') as Mesh;
    return { view, body };
  };
  // The group stands on his feet: the height of his centre, what the descent aims at, is a radius above.
  const centreOf = (body: Mesh): number => body.position.y + radiusM;

  it('carries him at Papa’s chest with no lowering, and lays him at the laid height at 100', () => {
    const { view, body } = build();
    view.update(carried(), 1, undefined, 0);
    expect(centreOf(body)).toBeCloseTo(BABY_CARRIED_HEIGHT_M, 12);
    view.update(carried(), 1, undefined, 100);
    expect(centreOf(body)).toBeCloseTo(laidHeightM, 12);
  });

  it('goes down linearly and comes back up at once', () => {
    const { view, body } = build();
    view.update(carried(), 1, undefined, 50);
    expect(centreOf(body)).toBeCloseTo((BABY_CARRIED_HEIGHT_M + laidHeightM) / 2, 12);
    view.update(carried(), 1, undefined, 0);
    expect(centreOf(body)).toBeCloseTo(BABY_CARRIED_HEIGHT_M, 12);
  });

  it('never lowers him under the floor, whatever the laid height', () => {
    const scene = new Scene();
    const view = viewOf(scene, radiusM / 2);
    const body = scene.getObjectByName('baby') as Mesh;
    view.update(carried(), 1, undefined, 100);
    expect(centreOf(body)).toBeCloseTo(radiusM, 12);
  });

  it('does not lower a baby who is not in the arms', () => {
    const { view, body } = build();
    view.update({ ...carried(), state: 'babble' }, 1, undefined, 100);
    expect(centreOf(body)).toBe(radiusM);
  });

  it('keeps the default of an older caller: no lowering without a laid height', () => {
    const scene = new Scene();
    const view = viewOf(scene);
    const body = scene.getObjectByName('baby') as Mesh;
    view.update(carried(), 1, undefined, 100);
    expect(centreOf(body)).toBeCloseTo(BABY_CARRIED_HEIGHT_M, 12);
  });
});
