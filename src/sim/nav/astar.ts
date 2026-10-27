import type { NavGrid } from './navGrid.ts';

/** Cost of a diagonal step; a straight step costs 1. */
const DIAGONAL_COST = Math.SQRT2;

/** Octile distance in step costs: the exact cost of the cheapest path on an empty grid. */
function heuristic(grid: NavGrid, cell: number, goalCol: number, goalRow: number): number {
  const col = cell % grid.cols;
  const dc = Math.abs(col - goalCol);
  const dr = Math.abs((cell - col) / grid.cols - goalRow);
  return dc < dr ? dc * DIAGONAL_COST + (dr - dc) : dr * DIAGONAL_COST + (dc - dr);
}

/**
 * Finds the cheapest path over open cells, 8 neighbours, never cutting a corner (a diagonal step
 * needs both cells beside it open). On success writes the cell indices from `fromCell` to `toCell`
 * into `out` (replacing its content) and returns true. It returns false, with `out` cleared, when
 * either cell is closed or they are in different regions; nothing throws.
 *
 * Deterministic: the open list is a binary heap ordered by priority, then by heuristic, then by
 * cell index, and the neighbours are tried in a fixed order. The search allocates nothing: it
 * reuses the arrays of `grid.scratch`.
 */
export function findPath(grid: NavGrid, fromCell: number, toCell: number, out: number[]): boolean {
  out.length = 0;
  const total = grid.cols * grid.rows;
  if (fromCell < 0 || fromCell >= total || toCell < 0 || toCell >= total) return false;
  if (grid.open[fromCell] !== 1 || grid.open[toCell] !== 1) return false;
  if (grid.region[fromCell] !== grid.region[toCell]) return false;
  if (fromCell === toCell) {
    out.push(fromCell);
    return true;
  }

  const { cols, rows, open } = grid;
  const { cost, priority, parent, heapPos, heap, seen, closed } = grid.scratch;
  const searchId = ++grid.scratch.searchId;
  const goalCol = toCell % cols;
  const goalRow = (toCell - goalCol) / cols;
  let heapSize = 0;

  const isBefore = (a: number, b: number): boolean => {
    const pa = priority[a] as number;
    const pb = priority[b] as number;
    if (pa !== pb) return pa < pb;
    const ha = heuristic(grid, a, goalCol, goalRow);
    const hb = heuristic(grid, b, goalCol, goalRow);
    if (ha !== hb) return ha < hb;
    return a < b;
  };
  const place = (cell: number, position: number): void => {
    heap[position] = cell;
    heapPos[cell] = position;
  };
  const siftUp = (cell: number, from: number): void => {
    let position = from;
    while (position > 0) {
      const above = (position - 1) >> 1;
      const other = heap[above] as number;
      if (!isBefore(cell, other)) break;
      place(other, position);
      position = above;
    }
    place(cell, position);
  };
  const siftDown = (cell: number, from: number): void => {
    let position = from;
    for (;;) {
      let child = position * 2 + 1;
      if (child >= heapSize) break;
      if (child + 1 < heapSize && isBefore(heap[child + 1] as number, heap[child] as number)) {
        child++;
      }
      const other = heap[child] as number;
      if (!isBefore(other, cell)) break;
      place(other, position);
      position = child;
    }
    place(cell, position);
  };

  // `cell` was reached at cost `g` from `from`: keep it if that is the best so far.
  const reach = (cell: number, from: number, g: number): void => {
    if (closed[cell] === searchId) return;
    if (seen[cell] === searchId) {
      if (g >= (cost[cell] as number)) return;
      cost[cell] = g;
      parent[cell] = from;
      priority[cell] = g + heuristic(grid, cell, goalCol, goalRow);
      siftUp(cell, heapPos[cell] as number);
      return;
    }
    seen[cell] = searchId;
    cost[cell] = g;
    parent[cell] = from;
    priority[cell] = g + heuristic(grid, cell, goalCol, goalRow);
    heapSize++;
    siftUp(cell, heapSize - 1);
  };

  seen[fromCell] = searchId;
  cost[fromCell] = 0;
  parent[fromCell] = -1;
  priority[fromCell] = heuristic(grid, fromCell, goalCol, goalRow);
  heapSize = 1;
  place(fromCell, 0);

  while (heapSize > 0) {
    const cell = heap[0] as number;
    heapSize--;
    if (heapSize > 0) siftDown(heap[heapSize] as number, 0);
    closed[cell] = searchId;
    if (cell === toCell) {
      let at = toCell;
      while (at !== -1) {
        out.push(at);
        at = parent[at] as number;
      }
      out.reverse();
      return true;
    }

    const col = cell % cols;
    const row = (cell - col) / cols;
    const g = cost[cell] as number;
    const hasWest = col > 0 && open[cell - 1] === 1;
    const hasEast = col < cols - 1 && open[cell + 1] === 1;
    const hasNorth = row > 0 && open[cell - cols] === 1;
    const hasSouth = row < rows - 1 && open[cell + cols] === 1;
    // Fixed order: north row, the cell's own row, south row; west to east.
    if (hasNorth && hasWest && open[cell - cols - 1] === 1)
      reach(cell - cols - 1, cell, g + DIAGONAL_COST);
    if (hasNorth) reach(cell - cols, cell, g + 1);
    if (hasNorth && hasEast && open[cell - cols + 1] === 1)
      reach(cell - cols + 1, cell, g + DIAGONAL_COST);
    if (hasWest) reach(cell - 1, cell, g + 1);
    if (hasEast) reach(cell + 1, cell, g + 1);
    if (hasSouth && hasWest && open[cell + cols - 1] === 1)
      reach(cell + cols - 1, cell, g + DIAGONAL_COST);
    if (hasSouth) reach(cell + cols, cell, g + 1);
    if (hasSouth && hasEast && open[cell + cols + 1] === 1)
      reach(cell + cols + 1, cell, g + DIAGONAL_COST);
  }
  out.length = 0;
  return false;
}
