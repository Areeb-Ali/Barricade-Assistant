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
  setWall,
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
 * Evaluation combines shortest-path race distance, the number of independent
 * shortest routes, and walls kept in hand. Repeated positions on a search line
 * are treated as draws to prevent the engine from rewarding pawn shuffles.
 * Inside the tree, wall moves are limited to walls that cut an edge on one of
 * the opponent's shortest paths (the only walls that can slow them down
 * immediately); at the root every legal move is considered.
 */

export const MATE = 1_000_000;
const MATE_BOUND = MATE - 1_000;
const INF = MATE + 1;
const MAX_PLY = 64;
const TT_LIMIT = 1_500_000;
const REPEAT_PENALTY = 150;

export interface EvalWeights {
  /** Score per step of shortest-path advantage. */
  step: number;
  /** Value of holding 0..10 walls (index = walls in hand). */
  walls: readonly number[];
  /** Bonus for a race that can no longer be stopped by walls. */
  race: number;
  /**
   * Fraction of the opponent's best single-wall damage (in steps) that is
   * charged against us at a leaf. This is what makes the engine see traps and
   * double-traps coming instead of trusting a raw shortest-path lead.
   */
  threat: number;
  /** Multiplier on each step we add to the opponent's route (1 = same as our own steps). */
  oppFocus: number;
}

/**
 * Wall stock is deliberately valued with diminishing returns as stock grows:
 * spending from 10 to 9 is cheap, while spending the final wall is expensive.
 * This makes the engine preserve a late-game defensive reserve without
 * refusing to use walls when it has a healthy supply.
 */
export const DEFAULT_WEIGHTS: EvalWeights = {
  step: 100,
  walls: [0, 120, 240, 350, 450, 540, 620, 690, 750, 800, 840],
  race: 3_000,
  threat: 0.3,
  oppFocus: 1.25,
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

/** Rough chance (0..100) that the side to move wins, from a search score. */
export function winChance(score: number): number {
  const mate = mateIn(score);
  if (mate !== null) return mate > 0 ? 99 : 1;
  const p = 1 / (1 + Math.exp(-(score - TEMPO) / 300));
  return Math.min(99, Math.max(1, Math.round(p * 100)));
}

/** Static evaluation from the side to move's perspective. */
export function evaluate(
  dMe: number,
  dOpp: number,
  wallsMe: number,
  wallsOpp: number,
  w: EvalWeights = DEFAULT_WEIGHTS,
  pathsMe = 1,
  pathsOpp = 1,
  dmgOnMe = 0,
  dmgOnOpp = 0,
): number {
  // Keep route flexibility in the evaluation: two positions can have the same
  // shortest distance while one has a single fragile corridor and the other
  // has several independent ways forward.
  const routeValue = (n: number) => Math.min(8, Math.max(1, n)) * 12;
  let score =
    (dOpp * w.oppFocus - dMe) * w.step +
    w.walls[wallsMe] -
    w.walls[wallsOpp] +
    routeValue(pathsMe) -
    routeValue(pathsOpp) +
    TEMPO -
    // Opponent walls that could hurt us are charged; our own threats are credited
    // a bit less because the side to move gets to use them first.
    Math.round(dmgOnMe * w.threat * w.step) +
    Math.round(dmgOnOpp * w.threat * w.step * 0.5);
  // Pure races: whoever cannot be blocked any more and is not behind wins.
  // We move first, so we win ties.
  if (wallsOpp === 0 && dMe <= dOpp) score += w.race;
  else if (wallsMe === 0 && dOpp < dMe) score -= w.race;
  return score;
}



/** Counts shortest routes to the goal, capped to keep the evaluation bounded. */
function countShortestPaths(s: State, p: Player, g: Int16Array): number {
  const ways = new Uint8Array(CELLS);
  const goalStart = GOAL_ROW[p] * 9;
  for (let c = 0; c < 9; c++) ways[goalStart + c] = 1;

  const countFrom = (cell: number): number => {
    if (ways[cell]) return ways[cell];
    const distance = g[cell];
    if (distance < 0) return 0;
    let total = 0;
    for (let dir = 0; dir < 4; dir++) {
      if (!canStep(s, cell, dir)) continue;
      const next = neighbour(cell, dir);
      if (g[next] === distance - 1) {
        total += countFrom(next);
        if (total >= 8) {
          total = 8;
          break;
        }
      }
    }
    ways[cell] = total;
    return total;
  };

  return countFrom(s.pawns[p]);
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
  /** Hashes on the active search line; repeated positions are treated as draws. */
  private readonly pathKeys = new Float64Array(MAX_PLY);
  private stamp = 0;
  private readonly scratch = new Int16Array(CELLS);

  constructor(
    root: State,
    deadline: number,
    private readonly weights: EvalWeights,
  ) {
    this.s = cloneState(root);
    [this.h1, this.h2] = fullHash(this.s);
    this.pathKeys[0] = hashKey(this.h1, this.h2);
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

  /**
   * Largest increase in `victim`'s shortest distance that one legal wall from
   * `attacker` can cause (capped). 0 when the attacker has no walls.
   */
  private maxWallDamage(ply: number, victim: Player, attacker: Player, gV: Int16Array, base: number): number {
    const s = this.s;
    if (s.walls[attacker] === 0) return 0;
    this.stamp++;
    const count = this.addPathWalls(ply, 0, victim, gV, -1);
    const moves = this.moves[ply];
    let best = 0;
    for (let i = 0; i < count; i++) {
      const m = moves[i];
      setWall(s, m, 1);
      if (hasPath(s, 0) && hasPath(s, 1)) {
        distanceMap(s, victim, this.scratch);
        const d = this.scratch[s.pawns[victim]] - base;
        if (d > best) best = d;
      }
      setWall(s, m, 0);
    }
    return Math.min(best, 8);
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

    const key = hashKey(this.h1, this.h2);
    // Barricade permits reversible pawn shuffles. Treat a repeated position on
    // the current line as a draw instead of allowing the search to reward loops.
    let repeated = false;
    for (let i = 0; i < ply; i++) if (this.pathKeys[i] === key) repeated = true;
    this.pathKeys[ply] = key;

    const [gMe, gOpp] = this.dist[ply];
    distanceMap(s, me, gMe);
    distanceMap(s, opp, gOpp);
    if (repeated) {
      // A repeat is NOT a free draw: scoring it 0 made a losing engine shuffle
      // back and forth instead of walking its route. Judge it on the board
      // as it stands, minus a small penalty so progress is always preferred.
      return (
        evaluate(gMe[s.pawns[me]], gOpp[s.pawns[opp]], s.walls[me], s.walls[opp], this.weights) - REPEAT_PENALTY
      );
    }
    if (depth <= 0 || ply >= MAX_PLY - 1) {
      const dMe = gMe[s.pawns[me]];
      const dOpp = gOpp[s.pawns[opp]];
      const useThreat = this.weights.threat > 0 && dMe > 0 && dOpp > 0;
      return evaluate(
        dMe,
        dOpp,
        s.walls[me],
        s.walls[opp],
        this.weights,
        countShortestPaths(s, me, gMe),
        countShortestPaths(s, opp, gOpp),
        useThreat ? this.maxWallDamage(ply, me, opp, gMe, dMe) : 0,
        useThreat ? this.maxWallDamage(ply, opp, me, gOpp, dOpp) : 0,
      );
    }

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
      // Check at the root too: positions with many legal walls can otherwise
      // spend a long time finishing an iteration after the time budget expires.
      if (performance.now() > this.deadline) throw ABORT;
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
      // Never publish a move from an incomplete root iteration. Keep the best
      // move from the last fully completed depth (or the legal fallback).
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
