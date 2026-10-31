import { SIZE, SLOTS, H_BASE, V_BASE, colOf, isLegal, isWall, rowOf, stateFrom, type Move, type State } from './rules';

/**
 * The "lesson book": positions from studied games mapped to the move that
 * should be played there. Positions are matched exactly, and also as their
 * left-right mirror image (the rules are symmetric), which doubles coverage.
 */

export interface Lesson {
  /** Move to play in this position. */
  move: Move;
  /** How much better than the move that was actually played (centi-steps). */
  gain: number;
  learnedAt: number;
  /** Id of the game the lesson came from. */
  gameId: string;
}

export type Book = Record<string, Lesson>;

function packBits(bits: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bits.length; i += 4) {
    out += ((bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3]).toString(16);
  }
  return out;
}

/** A compact string that identifies a position exactly (including side to move and walls in hand). */
export function positionKey(s: State): string {
  return `${s.turn}:${s.pawns[0]}:${s.pawns[1]}:${s.walls[0]}:${s.walls[1]}:${packBits(s.h)}:${packBits(s.v)}`;
}

export function mirrorMove(m: Move): Move {
  if (!isWall(m)) return rowOf(m) * SIZE + (SIZE - 1 - colOf(m));
  const base = m < V_BASE ? H_BASE : V_BASE;
  const slot = m - base;
  return base + ((slot / SLOTS) | 0) * SLOTS + (SLOTS - 1 - (slot % SLOTS));
}

export function mirrorState(s: State): State {
  const flip = (bits: Uint8Array) => {
    const out = new Uint8Array(bits.length);
    for (let i = 0; i < bits.length; i++) out[((i / SLOTS) | 0) * SLOTS + (SLOTS - 1 - (i % SLOTS))] = bits[i];
    return out;
  };
  return stateFrom({
    pawns: [mirrorMove(s.pawns[0]), mirrorMove(s.pawns[1])],
    walls: s.walls,
    h: flip(s.h),
    v: flip(s.v),
    turn: s.turn,
  });
}

/** Finds a lesson for `s` (directly or mirrored), translated to a legal move in `s`. */
export function lookupLesson(book: Book, s: State): Lesson | null {
  const direct = book[positionKey(s)];
  if (direct && isLegal(s, direct.move)) return direct;
  const mirrored = book[positionKey(mirrorState(s))];
  if (mirrored) {
    const move = mirrorMove(mirrored.move);
    if (isLegal(s, move)) return { ...mirrored, move };
  }
  return null;
}
