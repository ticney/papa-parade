import type { FeedbackTable } from '@content/schemas/feedback';
import type { LevelGeometry } from '@content/schemas/levelGeometry';
import { log } from '@shared/log';
import type { World } from '@sim';
import { Color, type Object3D, Sprite, SpriteMaterial, type Texture } from 'three';
import { PALETTE } from '../materials/palette.ts';

const MS_PER_S = 1000;
const FULL_TURN_RAD = Math.PI * 2;
/** Drawn after the floor's blobs. */
const TINT_RENDER_ORDER = 2;

export interface DangerTint {
  /**
   * Shows a glow on the anchor of each threat of `anchorThreatDefIds` that is telegraphed or open, and
   * nothing elsewhere. Pulses on the sim clock (`clockMs`: a pause holds it); steady under reduced
   * motion. Reads a threat's `state`, `defId` and `anchorId`, nothing else. Allocates nothing.
   */
  update(world: Readonly<World>, clockMs: number, isMotionReduced: boolean): void;
  /** How many glows the last `update` left showing. */
  readonly shownCount: number;
  /** Hides every glow: the level is over and the loop no longer runs to end them. */
  reset(): void;
  /** Takes the sprites out and frees the material. The texture is the blob kit's. */
  dispose(): void;
}

/** The opacity of the glow at `clockMs`, 0 to 1. Pure. */
export function dangerTintOpacity(
  look: FeedbackTable['render']['dangerTint'],
  clockMs: number,
  isMotionReduced: boolean,
): number {
  const peak = look.peakOpacityPct / 100;
  if (isMotionReduced) return peak;
  const min = look.minOpacityPct / 100;
  const wave = 0.5 + 0.5 * Math.sin((clockMs / MS_PER_S) * look.pulseHz * FULL_TURN_RAD);
  return min + (peak - min) * wave;
}

/**
 * The reserved alert hue on the room's dangers (story 7.3, D5, D6): an unlit sprite on the real point
 * of each anchor, seen through the table that stands over it and through a gag's lights-out. Made up
 * front, one per anchor of the level (two threats on one anchor are one glow), and sharing one
 * material: they pulse together. Only threats aimed at an anchor: those on Papa and the baby have
 * their marker, and a hidden silence is a secret until found.
 */
export function createDangerTint(
  parent: Object3D,
  anchors: LevelGeometry['anchors'],
  look: FeedbackTable['render']['dangerTint'],
  texture: Texture,
  anchorThreatDefIds: readonly string[],
): DangerTint {
  const material = new SpriteMaterial({
    map: texture,
    color: new Color(PALETTE.alert),
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  const sprites: Sprite[] = [];
  const spriteOfAnchor = new Map<string, Sprite>();
  for (const anchor of anchors) {
    const sprite = new Sprite(material);
    sprite.name = `danger_tint_${anchor.id}`;
    sprite.position.set(anchor.positionM[0], anchor.positionM[1], anchor.positionM[2]);
    sprite.scale.set(look.radiusM * 2, look.radiusM * 2, 1);
    sprite.renderOrder = TINT_RENDER_ORDER;
    sprite.visible = false;
    parent.add(sprite);
    sprites.push(sprite);
    spriteOfAnchor.set(anchor.id, sprite);
  }
  const warned = new Set<string>();
  let shownCount = 0;

  const hideAll = (): void => {
    for (let i = 0; i < sprites.length; i++) (sprites[i] as Sprite).visible = false;
    shownCount = 0;
  };

  return {
    update(world, clockMs, isMotionReduced) {
      hideAll();
      for (let i = 0; i < world.threats.length; i++) {
        const threat = world.threats[i] as World['threats'][number];
        if (threat.state !== 'telegraph' && threat.state !== 'windowOpen') continue;
        if (!anchorThreatDefIds.includes(threat.defId)) continue;
        const sprite = spriteOfAnchor.get(threat.anchorId);
        if (sprite === undefined) {
          if (!warned.has(threat.anchorId)) {
            warned.add(threat.anchorId);
            log.warn('render', 'a threat stands on an anchor the level does not have: no tint', {
              anchorId: threat.anchorId,
            });
          }
          continue;
        }
        if (!sprite.visible) {
          sprite.visible = true;
          shownCount++;
        }
      }
      if (shownCount > 0) material.opacity = dangerTintOpacity(look, clockMs, isMotionReduced);
    },
    get shownCount() {
      return shownCount;
    },
    reset: hideAll,
    dispose() {
      for (const sprite of sprites) sprite.removeFromParent();
      material.dispose();
    },
  };
}
