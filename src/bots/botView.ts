import { THREAT_MARKER_OFFSET_M } from '@shared/constants';
import { roomOf } from '@shared/followCamera';
import { surfaceFor } from '@shared/surface';
import type { BotMarkerTarget, BotOptions, BotView, VisibilityCounters } from './bot.ts';

/** A fresh set of zeroed counters. */
export function createVisibilityCounters(): VisibilityCounters {
  return {
    telegraphs: 0,
    seenOffscreen: 0,
    cappedMs: 0,
    neverSeen: 0,
    seenLate: 0,
    seenLateDelayMs: 0,
  };
}

/** What `botViewOf` reads of a level, structurally typed (a bot may not import `@content`): a loaded level fits. */
export interface BotViewSource {
  /** `level.level.camera`. */
  readonly camera: 'fixed' | 'follow';
  /** The level's geometry: its bounds and anchors. */
  readonly geometry: {
    readonly boundsMinM: readonly [number, number, number];
    readonly boundsMaxM: readonly [number, number, number];
    readonly anchors: readonly {
      readonly id: string;
      readonly positionM: readonly [number, number, number];
    }[];
  };
  /** The level's threat defs (`level.threats`): only the target is read. */
  readonly threats: Readonly<Record<string, { readonly target: BotMarkerTarget }>>;
  /** `feel.baby.bodyRadiusM`. */
  readonly babyBodyRadiusM: number;
  /** `content/bots.json › human.view`. */
  readonly screen: BotOptions['human']['view'];
}

/**
 * The `view` of a `BotSetup` (story 9.8): `null` in a fixed-camera level (the bots there draw and send
 * what they always did), the follow level's room, screen and marker points otherwise. The one builder
 * the CLI, the browser's autoplay and the tests share, so a browser game is the CLI's game.
 */
export function botViewOf(source: BotViewSource): BotView | null {
  if (source.camera !== 'follow') return null;
  const { screen } = source;
  const anchors: Record<string, readonly [number, number, number]> = {};
  for (const anchor of source.geometry.anchors) anchors[anchor.id] = anchor.positionM;
  const targets: Record<string, BotMarkerTarget> = {};
  for (const [defId, def] of Object.entries(source.threats)) targets[defId] = def.target;
  return {
    room: roomOf(source.geometry),
    screen: {
      widthPx: screen.widthPx,
      heightPx: screen.heightPx,
      isCompact: surfaceFor(screen.widthPx, screen.heightPx) === 'compact',
      hudBottomPx: screen.hudBottomPx,
    },
    bubbleReadMs: screen.bubbleReadMs,
    anchors,
    targets,
    babyMarkerYM: source.babyBodyRadiusM * 2 + THREAT_MARKER_OFFSET_M,
  };
}
