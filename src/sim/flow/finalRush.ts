/** What `finalRushProblems` reads of a level's `finalRush` (the schema's shape, without zod). */
export interface FinalRushShape {
  readonly spillAnchor: string;
}

/** What `finalRushProblems` reads of `feel.endOfLevel`. */
export interface EndOfLevelShape {
  readonly finalRushMs: number;
  readonly doorSpillCount: number;
}

/** What `finalRushProblems` reads of the room: its anchors and its props, and which kinds can break. */
export interface FinalRushRoom {
  readonly anchors: readonly { readonly id: string; readonly positionM: readonly number[] }[];
  readonly props: readonly {
    readonly id: string;
    readonly kind: string;
    readonly centerM: readonly number[];
  }[];
  /** `feel.physics.kinds`: a kind that does not break is the only one the door knocks over. */
  readonly kinds: Readonly<Record<string, { readonly breakable: boolean }>>;
  /** `feel.gags.tableObjectFall.propReachDistM`: how far from the anchor a prop still counts as « on the table ». */
  readonly propReachDistM: number;
}

/**
 * What is wrong with a level's `finalRush`, each as a sentence that follows « finalRush: »: `simLevelOf`
 * and `content:check` both call it, so they refuse the same things with the same words (story 3.5).
 * The level must outlast the rush, the spill anchor must be an anchor of the level's geometry, and
 * (AC 30) the room must hold at least `doorSpillCount` props the door can knock over: a kind that cannot
 * break, within `propReachDistM` of the anchor. Pure: no zod and no `@content` runtime import.
 */
export function finalRushProblems(
  finalRush: FinalRushShape,
  durationMs: number,
  endOfLevel: EndOfLevelShape,
  room: FinalRushRoom,
): string[] {
  const problems: string[] = [];
  if (durationMs <= endOfLevel.finalRushMs) {
    problems.push(
      `the level lasts ${durationMs} ms, which is not above the ${endOfLevel.finalRushMs} ms of the rush (feel.endOfLevel.finalRushMs)`,
    );
  }
  const anchor = room.anchors.find((candidate) => candidate.id === finalRush.spillAnchor);
  if (anchor === undefined) {
    problems.push(`the spill anchor "${finalRush.spillAnchor}" is not an anchor of the level`);
    return problems;
  }
  let spillable = 0;
  for (const prop of room.props) {
    const kind = Object.hasOwn(room.kinds, prop.kind) ? room.kinds[prop.kind] : undefined;
    if (kind === undefined || kind.breakable) continue;
    const dxM = (prop.centerM[0] ?? 0) - (anchor.positionM[0] ?? 0);
    const dzM = (prop.centerM[2] ?? 0) - (anchor.positionM[2] ?? 0);
    if (Math.sqrt(dxM * dxM + dzM * dzM) <= room.propReachDistM) spillable++;
  }
  if (spillable < endOfLevel.doorSpillCount) {
    problems.push(
      `the door spills ${endOfLevel.doorSpillCount} props (feel.endOfLevel.doorSpillCount), but only ${spillable} unbreakable prop(s) stand within ${room.propReachDistM} m of "${finalRush.spillAnchor}"`,
    );
  }
  return problems;
}

/**
 * How long the level can be played with sequences: its `durationMs`, less the final rush when it has
 * one (no sequence can start in the rush, story 3.5). What `cycleProblems` is given, so a bedtime cycle
 * that would only fit by running into the rush is refused.
 */
export function playableMsOf(
  durationMs: number,
  finalRush: FinalRushShape | undefined,
  endOfLevel: EndOfLevelShape,
): number {
  return finalRush === undefined ? durationMs : durationMs - endOfLevel.finalRushMs;
}
