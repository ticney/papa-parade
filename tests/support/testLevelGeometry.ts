import { REQUIRED_ANCHOR_IDS } from '../../src/content/levelNodeNames.ts';
import type { LevelGeometry } from '../../src/content/schemas/levelGeometry.ts';

/** A tiny valid level geometry for tests: 1 m cells would do, 0.25 m keeps it like the real one. */
export function createTestLevelGeometry(id = 'test_room'): LevelGeometry {
  return {
    id,
    cellM: 0.25,
    boundsMinM: [-2, 0, -1.5],
    boundsMaxM: [2, 2.5, 1.5],
    colliders: [{ id: 'sofa', centerM: [0, 0.45, -1], halfExtentsM: [1, 0.45, 0.4] }],
    nav: {
      originM: [-2, -1.5],
      cols: 4,
      rowCount: 3,
      rows: ['1111', '1111', '1111'],
    },
    anchors: REQUIRED_ANCHOR_IDS.map((anchorId, index) => ({
      id: anchorId,
      positionM: [-1.5 + index * 0.3, 0, 0] as [number, number, number],
    })),
    zones: [
      { id: 'behind_sofa', kind: 'hidden', centerM: [0, 0.5, -1.4], halfExtentsM: [1, 0.5, 0.1] },
    ],
    props: [{ id: 'mug_01', kind: 'mug', centerM: [0, 0.7, 0], halfExtentsM: [0.05, 0.05, 0.05] }],
  };
}
