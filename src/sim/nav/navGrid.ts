import type { LevelGeometry } from '@content/schemas/levelGeometry';
import { invariant } from '@shared/invariant';

/**
 * A level's walkable grid, seen by one agent: the raw walkability from the geometry, the cells
 * that agent's centre may stand in (after its clearance), the 4-neighbour regions of those, and the
 * scratch arrays of the A* search. Built once at `createSim`; it lives beside `World`, never in it.
 * Everything is stored in index order (`row * cols + col`) so that every result is deterministic.
 */
export interface NavGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cellM: number;
  /** x of the corner of cell (0, 0), in metres. */
  readonly originXM: number;
  /** z of the corner of cell (0, 0), in metres. */
  readonly originZM: number;
  /** Cells of clearance an agent needs around its centre: `ceil(clearanceM / cellM)`. */
  readonly clearanceCells: number;
  /** 1 where the geometry says walkable. */
  readonly walkable: Uint8Array;
  /** 1 where the agent's centre may stand: the cell and its whole clearance square are walkable. */
  readonly open: Uint8Array;
  /** 4-neighbour region of each open cell, numbered in order of first cell; -1 for a closed one. */
  readonly region: Int32Array;
  /** Reused by `findPath` so that a search allocates nothing; it is not part of the grid's contract. */
  readonly scratch: AStarScratch;
  /** The column of the cell holding `xM` (outside `[0, cols)` when `xM` is off the grid). */
  columnAt(xM: number): number;
  /** The row of the cell holding `zM` (outside `[0, rows)` when `zM` is off the grid). */
  rowAt(zM: number): number;
  /** Index of the cell holding the point, or -1 off the grid. */
  cellAt(xM: number, zM: number): number;
  /** Centre of cell `cell`, in metres. */
  centerXM(cell: number): number;
  centerZM(cell: number): number;
  /** Whether the cell (`col`, `row`) exists and is open. */
  isOpenCell(col: number, row: number): boolean;
  /** Whether the point is inside an open cell. */
  isOpenAt(xM: number, zM: number): boolean;
  /**
   * The open cell whose centre is the nearest to the point; ties go to the lowest index. With a
   * `region` >= 0 only the cells of that region count. -1 when there is none.
   */
  nearestOpenCell(xM: number, zM: number, region: number): number;
}

export interface AStarScratch {
  /** Best known cost from the start, valid where `seen` carries the current search id. */
  readonly cost: Float64Array;
  /** Priority (`cost + heuristic`) of the cells in the heap. */
  readonly priority: Float64Array;
  readonly parent: Int32Array;
  /** Position of a cell in `heap`, valid while `heapPos` >= 0. */
  readonly heapPos: Int32Array;
  readonly heap: Int32Array;
  /** Search id that last reached each cell; compared with `searchId` instead of clearing arrays. */
  readonly seen: Uint32Array;
  readonly closed: Uint32Array;
  /** The cells of the last path, start to goal. */
  readonly cells: number[];
  searchId: number;
}

/**
 * Builds the grid of `geometry` for an agent whose centre must stay `clearanceM` away from every
 * blocked cell and from the edge of the grid (outside the grid is blocked).
 */
export function createNavGrid(geometry: LevelGeometry, clearanceM: number): NavGrid {
  invariant(
    Number.isFinite(clearanceM) && clearanceM >= 0,
    `createNavGrid: clearanceM must be a finite number >= 0 (${clearanceM})`,
  );
  const { nav, cellM } = geometry;
  const { cols } = nav;
  const rows = nav.rowCount;
  const [originXM, originZM] = nav.originM;
  const total = cols * rows;
  // The small slack keeps 0.25 / 0.25 at one cell whatever the rounding of the division.
  // `max` also turns the -0 of `ceil(-1e-9)` into 0: nothing in the sim may depend on a sign of zero.
  const clearanceCells = Math.max(0, Math.ceil(clearanceM / cellM - 1e-9));

  const walkable = new Uint8Array(total);
  for (let r = 0; r < rows; r++) {
    const text = nav.rows[r] as string;
    for (let c = 0; c < cols; c++) walkable[r * cols + c] = text.charCodeAt(c) === 49 ? 1 : 0; // '1'
  }

  const isWalkable = (c: number, r: number): boolean =>
    c >= 0 && c < cols && r >= 0 && r < rows && walkable[r * cols + c] === 1;

  const open = new Uint8Array(total);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let isClear = true;
      for (let dr = -clearanceCells; isClear && dr <= clearanceCells; dr++) {
        for (let dc = -clearanceCells; dc <= clearanceCells; dc++) {
          if (!isWalkable(c + dc, r + dr)) {
            isClear = false;
            break;
          }
        }
      }
      open[r * cols + c] = isClear ? 1 : 0;
    }
  }

  // 4-neighbour flood fill, iterative, labels in order of the first cell of each region.
  const region = new Int32Array(total).fill(-1);
  const queue = new Int32Array(total);
  let regionCount = 0;
  for (let start = 0; start < total; start++) {
    if (open[start] !== 1 || region[start] !== -1) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    region[start] = regionCount;
    while (head < tail) {
      const cell = queue[head++] as number;
      const c = cell % cols;
      const r = (cell - c) / cols;
      if (c > 0 && open[cell - 1] === 1 && region[cell - 1] === -1) {
        region[cell - 1] = regionCount;
        queue[tail++] = cell - 1;
      }
      if (c < cols - 1 && open[cell + 1] === 1 && region[cell + 1] === -1) {
        region[cell + 1] = regionCount;
        queue[tail++] = cell + 1;
      }
      if (r > 0 && open[cell - cols] === 1 && region[cell - cols] === -1) {
        region[cell - cols] = regionCount;
        queue[tail++] = cell - cols;
      }
      if (r < rows - 1 && open[cell + cols] === 1 && region[cell + cols] === -1) {
        region[cell + cols] = regionCount;
        queue[tail++] = cell + cols;
      }
    }
    regionCount++;
  }

  const scratch: AStarScratch = {
    cost: new Float64Array(total),
    priority: new Float64Array(total),
    parent: new Int32Array(total),
    heapPos: new Int32Array(total),
    heap: new Int32Array(total),
    seen: new Uint32Array(total),
    closed: new Uint32Array(total),
    cells: [],
    searchId: 0,
  };

  const columnAt = (xM: number): number => Math.floor((xM - originXM) / cellM);
  const rowAt = (zM: number): number => Math.floor((zM - originZM) / cellM);
  const isOpenCell = (col: number, row: number): boolean =>
    col >= 0 && col < cols && row >= 0 && row < rows && open[row * cols + col] === 1;

  return {
    cols,
    rows,
    cellM,
    originXM,
    originZM,
    clearanceCells,
    walkable,
    open,
    region,
    scratch,
    columnAt,
    rowAt,
    cellAt(xM, zM) {
      const col = columnAt(xM);
      const row = rowAt(zM);
      return col >= 0 && col < cols && row >= 0 && row < rows ? row * cols + col : -1;
    },
    centerXM: (cell) => originXM + ((cell % cols) + 0.5) * cellM,
    centerZM: (cell) => originZM + (Math.floor(cell / cols) + 0.5) * cellM,
    isOpenCell,
    isOpenAt: (xM, zM) => isOpenCell(columnAt(xM), rowAt(zM)),
    nearestOpenCell(xM, zM, wantedRegion) {
      let best = -1;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let cell = 0; cell < total; cell++) {
        if (open[cell] !== 1) continue;
        if (wantedRegion >= 0 && region[cell] !== wantedRegion) continue;
        const c = cell % cols;
        const r = (cell - c) / cols;
        const dx = originXM + (c + 0.5) * cellM - xM;
        const dz = originZM + (r + 0.5) * cellM - zM;
        const distance = dx * dx + dz * dz;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = cell;
        }
      }
      return best;
    },
  };
}
