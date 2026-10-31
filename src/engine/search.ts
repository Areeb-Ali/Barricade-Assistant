import {
  CELLS,
  DOWN,
  GOAL_ROW,
  H_BASE,
  LEFT,
  MOVE_SPACE,
  SLOTS,
  UP,
  V_BASE,
  canStep,
  cloneState,
  colOf,
  distanceMap,
  hasPath,
  isLegal,
  isWall,
  legalMoves,
  makeMove,
  neighbour,
  pawnMoves,
  rowOf,
  unmakeMove,
  wallFits,
  winner,
  type Move,
  type Player,
  type State,
} from './rules';

/**
 * Iterative-deepening negamax with alpha-beta pruning, a transposition table
 * and history-ordered wall candidates.
 *
 * Evaluation is the classic shortest-path race: how many more steps the
 * opponent needs than we do, plus a small bonus for walls kept in hand.
 * Inside the tree, wall moves are limited to walls that cut an edge on one of
 * the opponent's shortest paths (the only walls that can slow them down
 * immediately); at the root every legal move is considered.
 */

export const MATE = 1_000_000;
const MATE_BOUND = MATE - 1_000;
const INF = MATE + 1;
const MAX_PLY = 64;
const TT_LIMIT = 1_500_000;

export interface EvalWeights {
  /** Score per step of shortest-path advantage. */
  step: number;
  /** Value of holding 0..10 walls (index = walls in hand). */
  walls: readonly number[];
  /** Bonus for a race that can no longer be stopped by walls. */
  race: number;
}

/**
 * Tuned with `npm run match`: valuing each wall in hand at half a step scored
 * ~67% against both 0.25 steps per wall and a diminishing-returns curve.
 */
export const DEFAULT_WEIGHTS: EvalWeights = {
  step: 100,
  walls: Array.from({ length: 11 }, (_, n) => n * 50),
  race: 3_000,
};
/** The side to move is effectively half a step ahead in the race. */
export const TEMPO = 50;

export interface SearchInfo {
  /** Best move found for the side to move. */
  move: Move;
  /** Score from the side to move's point of view (centi-steps, or mate). */
  score: number;
  /** Deepest fully searched depth, in plies. */
  depth: number;
  nodes: number;
  /** Principal variation, starting with `move`. */
  pv: Move[];
  elapsedMs: number;
}

export interface SearchOptions {
  timeMs: number;
  maxDepth?: number;
  onIteration?: (info: SearchInfo) => void;
  weights?: EvalWeights;
}

/** Plies until mate for a mate score, otherwise null. */
export function mateIn(score: number): number | null {
  if (score >= MATE_BOUND) return MATE - score;
  if (score <= -MATE_BOUND) return -(MATE + score);
  return null;
}

/** Static evaluation from the side to move's perspective. */
export function evaluate(
  dMe: number,
  dOpp: number,
  wallsMe: number,
  wallsOpp: number,
  w: EvalWeights = DEFAULT_WEIGHTS,
): number {
  let score = (dOpp - dMe) * w.step + w.walls[wallsMe] - w.walls[wallsOpp] + TEMPO;
  // Pure races: whoever cannot be blocked any more and is not behind wins.
  // We move first, so we win ties.
  if (wallsOpp === 0 && dMe <= dOpp) score += w.race;
  else if (wallsMe === 0 && dOpp < dMe) score -= w.race;
  return score;
}

// ---------------------------------------------------------------- hashing

const Z_PAWN = 0;
const Z_H = Z_PAWN + 2 * CELLS;
const Z_V = Z_H + SLOTS * SLOTS;
const Z_WALLS = Z_V + SLOTS * SLOTS;
const Z_TURN = Z_WALLS + 2 * 11;
const Z_SIZE = Z_TURN + 1;

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

const rand = mulberry32(0x5eed);
const Z1 = Uint32Array.from({ length: Z_SIZE }, rand);
const Z2 = Uint32Array.from({ length: Z_SIZE }, rand);

function fullHash(s: State): [number, number] {
  let h1 = 0;
  let h2 = 0;
  const xor = (i: number) => {
    h1 ^= Z1[i];
    h2 ^= Z2[i];
  };
  xor(Z_PAWN + s.pawns[0]);
  xor(Z_PAWN + CELLS + s.pawns[1]);
  xor(Z_WALLS + s.walls[0]);
  xor(Z_WALLS + 11 + s.walls[1]);
  for (let i = 0; i < SLOTS * SLOTS; i++) {
    if (s.h[i]) xor(Z_H + i);
    if (s.v[i]) xor(Z_V + i);
  }
  if (s.turn === 1) xor(Z_TURN);
  return [h1, h2];
}

const hashKey = (h1: number, h2: number) => (h1 >>> 0) * 2_097_152 + (h2 >>> 11);

// ---------------------------------------------------------------- search

const EXACT = 0;
const LOWER = 1;
const UPPER = 2;

interface TTEntry {
  depth: number;
  score: number;
  flag: number;
  move: Move;
}

const ABORT = Symbol('abort');

class Searcher {
  private readonly s: State;
  private h1: number;
  private h2: number;
  private readonly deadline: number;
  nodes = 0;

  private readonly tt = new Map<number, TTEntry>();
  private readonly history = new Int32Array(MOVE_SPACE);
  private readonly dist: [Int16Array, Int16Array][] = [];
  private readonly moves: Int16Array[] = [];
  private readonly order: Float64Array[] = [];
  private readonly pawnBuf: Move[] = [];
  private readonly wallMark = new Int32Array(MOVE_SPACE);
  private readonly cellMark = new Int32Array(CELLS);
  private readonly cellStack = new Int16Array(CELLS);
  private stamp = 0;

  constructor(
    root: State,
    deadline: number,
    private readonly weights: EvalWeights,
  ) {
    this.s = cloneState(root);
    [this.h1, this.h2] = fullHash(this.s);
    this.deadline = deadline;
    for (let i = 0; i < MAX_PLY; i++) {
      this.dist.push([new Int16Array(CELLS), new Int16Array(CELLS)]);
      this.moves.push(new Int16Array(MOVE_SPACE));
      this.order.push(new Float64Array(MOVE_SPACE));
    }
  }

  private xor(i: number) {
    this.h1 ^= Z1[i];
    this.h2 ^= Z2[i];
  }

  private make(m: Move): number {
    const s = this.s;
    const p = s.turn;
    if (isWall(m)) {
      this.xor(m < V_BASE ? Z_H + m - H_BASE : Z_V + m - V_BASE);
      this.xor(Z_WALLS + p * 11 + s.walls[p]);
      this.xor(Z_WALLS + p * 11 + s.walls[p] - 1);
    } else {
      this.xor(Z_PAWN + p * CELLS + s.pawns[p]);
      this.xor(Z_PAWN + p * CELLS + m);
    }
    this.xor(Z_TURN);
    return makeMove(s, m);
  }

  private unmake(m: Move, undo: number) {
    unmakeMove(this.s, m, undo);
    const s = this.s;
    const p = s.turn;
    if (isWall(m)) {
      this.xor(m < V_BASE ? Z_H + m - H_BASE : Z_V + m - V_BASE);
      this.xor(Z_WALLS + p * 11 + s.walls[p]);
      this.xor(Z_WALLS + p * 11 + s.walls[p] - 1);
    } else {
      this.xor(Z_PAWN + p * CELLS + s.pawns[p]);
      this.xor(Z_PAWN + p * CELLS + m);
    }
    this.xor(Z_TURN);
  }

  private addWallCandidate(ply: number, count: number, m: Move, ttMove: Move): number {
    if (this.wallMark[m] === this.stamp || !wallFits(this.s, m)) return count;
    this.wallMark[m] = this.stamp;
    this.moves[ply][count] = m;
    this.order[ply][count] = m === ttMove ? 1e12 : this.history[m];
    return count + 1;
  }

  /** Walls that cut an edge on some shortest path of `opp` (distance map `g`). */
  private addPathWalls(ply: number, count: number, opp: Player, g: Int16Array, ttMove: Move): number {
    const stack = this.cellStack;
    let top = 0;
    stack[top++] = this.s.pawns[opp];
    this.cellMark[this.s.pawns[opp]] = this.stamp;
    while (top > 0) {
      const a = stack[--top];
      const ga = g[a];
      if (ga === 0) continue;
      const r = rowOf(a);
      const c = colOf(a);
      for (let dir = 0; dir < 4; dir++) {
        if (!canStep(this.s, a, dir)) continue;
        const b = neighbour(a, dir);
        if (g[b] !== ga - 1) continue;
        if (dir === UP || dir === DOWN) {
          const wr = dir === UP ? r - 1 : r;
          if (c > 0) count = this.addWallCandidate(ply, count, H_BASE + wr * SLOTS + c - 1, ttMove);
          if (c < SLOTS) count = this.addWallCandidate(ply, count, H_BASE + wr * SLOTS + c, ttMove);
        } else {
          const wc = dir === LEFT ? c - 1 : c;
          if (r > 0) count = this.addWallCandidate(ply, count, V_BASE + (r - 1) * SLOTS + wc, ttMove);
          if (r < SLOTS) count = this.addWallCandidate(ply, count, V_BASE + r * SLOTS + wc, ttMove);
        }
        if (this.cellMark[b] !== this.stamp) {
          this.cellMark[b] = this.stamp;
          stack[top++] = b;
        }
      }
    }
    return count;
  }

  private generate(ply: number, gMe: Int16Array, gOpp: Int16Array, ttMove: Move): number {
    const s = this.s;
    const me = s.turn;
    const moves = this.moves[ply];
    const order = this.order[ply];
    const here = gMe[s.pawns[me]];
    let count = 0;

    this.pawnBuf.length = 0;
    for (const m of pawnMoves(s, me, this.pawnBuf)) {
      moves[count] = m;
      // Advancing steps first, then walls (by history), then retreats.
      order[count] = m === ttMove ? 1e12 : gMe[m] < here ? 1e9 - gMe[m] : -1e9 - gMe[m];
      count++;
    }
    if (s.walls[me] > 0) {
      this.stamp++;
      count = this.addPathWalls(ply, count, (me ^ 1) as Player, gOpp, ttMove);
    }
    return count;
  }

  private pick(ply: number, from: number, count: number): Move {
    const moves = this.moves[ply];
    const order = this.order[ply];
    let best = from;
    for (let i = from + 1; i < count; i++) if (order[i] > order[best]) best = i;
    if (best !== from) {
      const m = moves[best];
      moves[best] = moves[from];
      moves[from] = m;
      const o = order[best];
      order[best] = order[from];
      order[from] = o;
    }
    return moves[from];
  }

  private negamax(depth: number, alpha: number, beta: number, ply: number): number {
    if ((++this.nodes & 1023) === 0 && performance.now() > this.deadline) throw ABORT;
    const s = this.s;
    const me = s.turn;
    const opp = (me ^ 1) as Player;
    if (rowOf(s.pawns[opp]) === GOAL_ROW[opp]) return -MATE + ply;

    const [gMe, gOpp] = this.dist[ply];
    distanceMap(s, me, gMe);
    distanceMap(s, opp, gOpp);
    if (depth <= 0 || ply >= MAX_PLY - 1) {
      return evaluate(gMe[s.pawns[me]], gOpp[s.pawns[opp]], s.walls[me], s.walls[opp], this.weights);
    }

    const key = hashKey(this.h1, this.h2);
    const entry = this.tt.get(key);
    let ttMove = -1;
    if (entry) {
      ttMove = entry.move;
      if (entry.depth >= depth) {
        const sc = fromTT(entry.score, ply);
        if (entry.flag === EXACT) return sc;
        if (entry.flag === LOWER && sc >= beta) return sc;
        if (entry.flag === UPPER && sc <= alpha) return sc;
      }
    }

    const alphaOrig = alpha;
    const count = this.generate(ply, gMe, gOpp, ttMove);
    let best = -INF;
    let bestMove = -1;
    for (let i = 0; i < count; i++) {
      const m = this.pick(ply, i, count);
      const undo = this.make(m);
      if (isWall(m) && !(hasPath(s, 0) && hasPath(s, 1))) {
        this.unmake(m, undo);
        continue;
      }
      const score = -this.negamax(depth - 1, -beta, -alpha, ply + 1);
      this.unmake(m, undo);
      if (score > best) {
        best = score;
        bestMove = m;
      }
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        if (isWall(m)) this.history[m] += depth * depth;
        break;
      }
    }

    if (this.tt.size > TT_LIMIT) this.tt.clear();
    const flag = best <= alphaOrig ? UPPER : best >= beta ? LOWER : EXACT;
    this.tt.set(key, { depth, score: toTT(best, ply), flag, move: bestMove });
    return best;
  }

  /** Searches every root move at `depth`, recording the best in `partial`. */
  searchRoot(rootMoves: Move[], depth: number, scores: Map<Move, number>, partial: { move: Move; score: number }) {
    let alpha = -INF;
    partial.move = -1;
    partial.score = -INF;
    for (const m of rootMoves) {
      const undo = this.make(m);
      const score = -this.negamax(depth - 1, -INF, -alpha, 1);
      this.unmake(m, undo);
      scores.set(m, score);
      if (score > partial.score) {
        partial.score = score;
        partial.move = m;
      }
      if (score > alpha) alpha = score;
    }
    const [h1, h2] = fullHash(this.s);
    this.tt.set(hashKey(h1, h2), { depth, score: partial.score, flag: EXACT, move: partial.move });
  }

  principalVariation(root: State, first: Move, maxLength: number): Move[] {
    const s = cloneState(root);
    const pv: Move[] = [first];
    makeMove(s, first);
    while (pv.length < maxLength && winner(s) === null) {
      const [h1, h2] = fullHash(s);
      const entry = this.tt.get(hashKey(h1, h2));
      if (!entry || entry.move < 0 || !isLegal(s, entry.move)) break;
      pv.push(entry.move);
      makeMove(s, entry.move);
    }
    return pv;
  }
}

function toTT(score: number, ply: number) {
  if (score >= MATE_BOUND) return score + ply;
  if (score <= -MATE_BOUND) return score - ply;
  return score;
}

function fromTT(score: number, ply: number) {
  if (score >= MATE_BOUND) return score - ply;
  if (score <= -MATE_BOUND) return score + ply;
  return score;
}

/** Finds the best move for the side to move in `root`. */
export function search(root: State, options: SearchOptions): SearchInfo {
  const start = performance.now();
  const maxDepth = Math.min(options.maxDepth ?? MAX_PLY - 2, MAX_PLY - 2);
  const rootMoves = legalMoves(root);
  if (rootMoves.length === 0) throw new Error('No legal moves: the game is over.');

  // Prefer advancing pawn moves before the first iteration orders things.
  const g = distanceMap(root, root.turn, new Int16Array(CELLS));
  rootMoves.sort((a, b) => (isWall(a) ? 99 : g[a]) - (isWall(b) ? 99 : g[b]));

  const searcher = new Searcher(root, start + options.timeMs, options.weights ?? DEFAULT_WEIGHTS);
  const scores = new Map<Move, number>();
  const partial = { move: -1, score: -INF };
  let result: SearchInfo = {
    move: rootMoves[0],
    score: 0,
    depth: 0,
    nodes: 0,
    pv: [rootMoves[0]],
    elapsedMs: 0,
  };

  for (let depth = 1; depth <= maxDepth; depth++) {
    try {
      searcher.searchRoot(rootMoves, depth, scores, partial);
    } catch (e) {
      if (e !== ABORT) throw e;
      // The first root move searched is the previous best, so any move found
      // in an interrupted iteration is at least as good as what we had.
      if (partial.move >= 0) {
        result = {
          ...result,
          move: partial.move,
          score: partial.score,
          pv: searcher.principalVariation(root, partial.move, depth),
        };
      }
      break;
    }
    rootMoves.sort((a, b) => (scores.get(b) ?? -INF) - (scores.get(a) ?? -INF));
    result = {
      move: partial.move,
      score: partial.score,
      depth,
      nodes: searcher.nodes,
      pv: searcher.principalVariation(root, partial.move, depth),
      elapsedMs: performance.now() - start,
    };
    options.onIteration?.(result);
    if (Math.abs(partial.score) >= MATE_BOUND || rootMoves.length === 1) break;
    if (performance.now() - start > options.timeMs) break;
  }

  result.nodes = searcher.nodes;
  result.elapsedMs = performance.now() - start;
  return result;
}
