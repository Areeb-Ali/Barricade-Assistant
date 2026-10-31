/**
 * Core rules for Barricade (a 9x9 wall-and-race game).
 *
 * Coordinates: cells are indexed `row * 9 + col`, row 0 is the top edge.
 * Player 0 ("you") starts at the bottom centre and races to row 0.
 * Player 1 ("opponent") starts at the top centre and races to row 8.
 *
 * Walls are two cells long and sit on the 8x8 grid of inner intersections.
 * A wall slot `(r, c)` (0..7, 0..7) is the intersection between rows r/r+1
 * and columns c/c+1:
 *   - a horizontal wall there blocks movement between rows r and r+1
 *     for columns c and c+1;
 *   - a vertical wall there blocks movement between columns c and c+1
 *     for rows r and r+1.
 *
 * Moves are encoded as small integers so the search can run allocation-free:
 *   0..80    pawn move to that cell
 *   81..144  horizontal wall in slot (m - 81)
 *   145..208 vertical wall in slot (m - 145)
 */

export const SIZE = 9;
export const SLOTS = 8;
export const CELLS = SIZE * SIZE;
export const WALLS_PER_PLAYER = 10;

export const H_BASE = CELLS;
export const V_BASE = H_BASE + SLOTS * SLOTS;
export const MOVE_SPACE = V_BASE + SLOTS * SLOTS;

export type Player = 0 | 1;
export type Orientation = 'h' | 'v';
export type Move = number;

export const GOAL_ROW: readonly [number, number] = [0, SIZE - 1];
export const START_CELL: readonly [number, number] = [(SIZE - 1) * SIZE + 4, 4];

export interface State {
  /** Cell index of each player's pawn. */
  pawns: [number, number];
  /** Walls each player still has in hand. */
  walls: [number, number];
  /** Horizontal walls by slot (1 = placed). */
  h: Uint8Array;
  /** Vertical walls by slot (1 = placed). */
  v: Uint8Array;
  /**
   * Per cell, a bitmask of blocked step directions (`1 << dir`), covering both
   * the board edge and walls. Derived from `h`/`v`; kept in sync by `setWall`.
   */
  edges: Uint8Array;
  /** Player to move. */
  turn: Player;
}

export const UP = 0;
export const DOWN = 1;
export const LEFT = 2;
export const RIGHT = 3;
const STEP = [-SIZE, SIZE, -1, 1];
const PERPENDICULAR = [
  [LEFT, RIGHT],
  [LEFT, RIGHT],
  [UP, DOWN],
  [UP, DOWN],
];

export const rowOf = (cell: number) => (cell / SIZE) | 0;
export const colOf = (cell: number) => cell % SIZE;
export const cellAt = (row: number, col: number) => row * SIZE + col;

export const isWall = (m: Move) => m >= H_BASE;
export const wallMove = (o: Orientation, row: number, col: number): Move =>
  (o === 'h' ? H_BASE : V_BASE) + row * SLOTS + col;

export function decodeWall(m: Move): { orientation: Orientation; row: number; col: number } {
  const horizontal = m < V_BASE;
  const slot = m - (horizontal ? H_BASE : V_BASE);
  return { orientation: horizontal ? 'h' : 'v', row: (slot / SLOTS) | 0, col: slot % SLOTS };
}

const BORDER_EDGES = Uint8Array.from({ length: CELLS }, (_, cell) => {
  const r = rowOf(cell);
  const c = colOf(cell);
  return (r === 0 ? 1 << UP : 0) | (r === SIZE - 1 ? 1 << DOWN : 0) | (c === 0 ? 1 << LEFT : 0) | (c === SIZE - 1 ? 1 << RIGHT : 0);
});

export function initialState(first: Player = 0): State {
  return {
    pawns: [START_CELL[0], START_CELL[1]],
    walls: [WALLS_PER_PLAYER, WALLS_PER_PLAYER],
    h: new Uint8Array(SLOTS * SLOTS),
    v: new Uint8Array(SLOTS * SLOTS),
    edges: BORDER_EDGES.slice(),
    turn: first,
  };
}

/** Builds a full state (including the edge table) from its plain parts. */
export function stateFrom(parts: {
  pawns: readonly number[];
  walls: readonly number[];
  h: ArrayLike<number>;
  v: ArrayLike<number>;
  turn: Player;
}): State {
  const s = initialState(parts.turn);
  s.pawns = [parts.pawns[0], parts.pawns[1]];
  s.walls = [parts.walls[0], parts.walls[1]];
  for (let i = 0; i < SLOTS * SLOTS; i++) {
    if (parts.h[i]) setWall(s, H_BASE + i, 1);
    if (parts.v[i]) setWall(s, V_BASE + i, 1);
  }
  return s;
}

export function cloneState(s: State): State {
  return {
    pawns: [s.pawns[0], s.pawns[1]],
    walls: [s.walls[0], s.walls[1]],
    h: s.h.slice(),
    v: s.v.slice(),
    edges: s.edges.slice(),
    turn: s.turn,
  };
}

/** Can a pawn step from `cell` one square in `dir`, ignoring other pawns? */
export function canStep(s: State, cell: number, dir: number): boolean {
  return (s.edges[cell] & (1 << dir)) === 0;
}

export const neighbour = (cell: number, dir: number) => cell + STEP[dir];

/**
 * Legal pawn destinations for player `p`, including straight jumps over an
 * adjacent opponent and diagonal side-steps when the straight jump is blocked.
 */
export function pawnMoves(s: State, p: Player, out: Move[] = []): Move[] {
  const me = s.pawns[p];
  const opp = s.pawns[p ^ 1];
  for (let dir = 0; dir < 4; dir++) {
    if (!canStep(s, me, dir)) continue;
    const next = me + STEP[dir];
    if (next !== opp) {
      out.push(next);
      continue;
    }
    if (canStep(s, opp, dir)) {
      out.push(opp + STEP[dir]);
    } else {
      for (const side of PERPENDICULAR[dir]) {
        if (canStep(s, opp, side)) out.push(opp + STEP[side]);
      }
    }
  }
  return out;
}

const bfsQueue = new Int16Array(CELLS);

/**
 * Fills `out` with each cell's shortest distance to player `p`'s goal row
 * (pawns are ignored). Unreachable cells are -1.
 */
export function distanceMap(s: State, p: Player, out: Int16Array): Int16Array {
  out.fill(-1);
  let head = 0;
  let tail = 0;
  const goal = GOAL_ROW[p] * SIZE;
  for (let c = 0; c < SIZE; c++) {
    out[goal + c] = 0;
    bfsQueue[tail++] = goal + c;
  }
  while (head < tail) {
    const cell = bfsQueue[head++];
    const d = out[cell] + 1;
    for (let dir = 0; dir < 4; dir++) {
      if (!canStep(s, cell, dir)) continue;
      const n = cell + STEP[dir];
      if (out[n] < 0) {
        out[n] = d;
        bfsQueue[tail++] = n;
      }
    }
  }
  return out;
}

const seen = new Uint8Array(CELLS);
const dfsStack = new Int16Array(CELLS);

/** Can player `p` still reach their goal row? (Early-exit flood fill.) */
export function hasPath(s: State, p: Player): boolean {
  seen.fill(0);
  const goal = GOAL_ROW[p];
  let top = 0;
  dfsStack[top++] = s.pawns[p];
  seen[s.pawns[p]] = 1;
  while (top > 0) {
    const cell = dfsStack[--top];
    if (rowOf(cell) === goal) return true;
    // Push the goal-ward step last so it is popped first; open boards exit fast.
    for (let k = 0; k < 4; k++) {
      const dir = k === 0 ? (p === 0 ? DOWN : UP) : k === 3 ? (p === 0 ? UP : DOWN) : k === 1 ? LEFT : RIGHT;
      if (!canStep(s, cell, dir)) continue;
      const n = cell + STEP[dir];
      if (!seen[n]) {
        seen[n] = 1;
        dfsStack[top++] = n;
      }
    }
  }
  return false;
}

/** Does a wall fit physically (no overlap or crossing), ignoring path rules? */
export function wallFits(s: State, m: Move): boolean {
  const horizontal = m < V_BASE;
  const slot = m - (horizontal ? H_BASE : V_BASE);
  if (s.h[slot] || s.v[slot]) return false;
  const r = (slot / SLOTS) | 0;
  const c = slot % SLOTS;
  if (horizontal) {
    return !((c > 0 && s.h[slot - 1]) || (c < SLOTS - 1 && s.h[slot + 1]));
  }
  return !((r > 0 && s.v[slot - SLOTS]) || (r < SLOTS - 1 && s.v[slot + SLOTS]));
}

/**
 * Places (`value` 1) or removes (0) a wall without any legality checks.
 * Walls never share an edge, so removal can simply clear the edge bits.
 */
export function setWall(s: State, m: Move, value: 0 | 1): void {
  const horizontal = m < V_BASE;
  const slot = m - (horizontal ? H_BASE : V_BASE);
  const r = (slot / SLOTS) | 0;
  const c = slot % SLOTS;
  const a = r * SIZE + c; // top-left cell of the 2x2 block the wall splits
  const e = s.edges;
  if (horizontal) {
    s.h[slot] = value;
    const down = 1 << DOWN;
    const up = 1 << UP;
    if (value) {
      e[a] |= down; e[a + 1] |= down; e[a + SIZE] |= up; e[a + SIZE + 1] |= up;
    } else {
      e[a] &= ~down; e[a + 1] &= ~down; e[a + SIZE] &= ~up; e[a + SIZE + 1] &= ~up;
    }
  } else {
    s.v[slot] = value;
    const right = 1 << RIGHT;
    const left = 1 << LEFT;
    if (value) {
      e[a] |= right; e[a + SIZE] |= right; e[a + 1] |= left; e[a + SIZE + 1] |= left;
    } else {
      e[a] &= ~right; e[a + SIZE] &= ~right; e[a + 1] &= ~left; e[a + SIZE + 1] &= ~left;
    }
  }
}

/** Full legality for a wall placed by the side to move. */
export function wallLegal(s: State, m: Move): boolean {
  if (s.walls[s.turn] === 0 || !wallFits(s, m)) return false;
  setWall(s, m, 1);
  const ok = hasPath(s, 0) && hasPath(s, 1);
  setWall(s, m, 0);
  return ok;
}

export function isLegal(s: State, m: Move): boolean {
  if (winner(s) !== null) return false;
  if (isWall(m)) return m < MOVE_SPACE && wallLegal(s, m);
  return pawnMoves(s, s.turn).includes(m);
}

export function legalMoves(s: State): Move[] {
  if (winner(s) !== null) return [];
  const moves = pawnMoves(s, s.turn);
  if (s.walls[s.turn] > 0) {
    for (let m = H_BASE; m < MOVE_SPACE; m++) {
      if (wallLegal(s, m)) moves.push(m);
    }
  }
  return moves;
}

/**
 * Applies `m` for the side to move (no legality check). Returns the token
 * needed by `unmakeMove` (the pawn's previous cell, or -1 for walls).
 */
export function makeMove(s: State, m: Move): number {
  const p = s.turn;
  let undo = -1;
  if (isWall(m)) {
    setWall(s, m, 1);
    s.walls[p]--;
  } else {
    undo = s.pawns[p];
    s.pawns[p] = m;
  }
  s.turn = (p ^ 1) as Player;
  return undo;
}

export function unmakeMove(s: State, m: Move, undo: number): void {
  const p = (s.turn ^ 1) as Player;
  s.turn = p;
  if (isWall(m)) {
    setWall(s, m, 0);
    s.walls[p]++;
  } else {
    s.pawns[p] = undo;
  }
}

export function winner(s: State): Player | null {
  if (rowOf(s.pawns[0]) === GOAL_ROW[0]) return 0;
  if (rowOf(s.pawns[1]) === GOAL_ROW[1]) return 1;
  return null;
}

/** Rebuilds a position from the starting player and a move list. */
export function replay(first: Player, moves: readonly Move[]): State {
  const s = initialState(first);
  for (const m of moves) makeMove(s, m);
  return s;
}
