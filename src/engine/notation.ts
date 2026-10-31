import { SIZE, colOf, decodeWall, isWall, rowOf, type Move } from './rules';

const FILES = 'abcdefghi';

/** Algebraic cell name: files a–i left to right, ranks 1–9 bottom to top. */
export function cellName(cell: number): string {
  return `${FILES[colOf(cell)]}${SIZE - rowOf(cell)}`;
}

/**
 * Human-readable move. Pawn moves are the destination cell (`e2`); walls are
 * named by the cell at the lower-left of the 2x2 block they split, plus their
 * orientation (`d4h`, `e7v`).
 */
export function moveName(m: Move): string {
  if (!isWall(m)) return cellName(m);
  const { orientation, row, col } = decodeWall(m);
  return `${FILES[col]}${SIZE - 1 - row}${orientation}`;
}
