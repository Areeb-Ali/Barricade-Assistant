import { describe, expect, it } from 'vitest';
import { lookupLesson, mirrorMove, mirrorState, positionKey, type Book } from './book';
import { cellAt, initialState, isLegal, isWall, makeMove, replay, wallMove, winner } from './rules';
import { studyGame } from './study';

describe('lesson book', () => {
  it('mirrors moves and positions left to right', () => {
    expect(mirrorMove(cellAt(3, 0))).toBe(cellAt(3, 8));
    expect(mirrorMove(wallMove('h', 2, 0))).toBe(wallMove('h', 2, 7));
    expect(mirrorMove(wallMove('v', 5, 6))).toBe(wallMove('v', 5, 1));
    const s = replay(0, [cellAt(7, 4), wallMove('h', 3, 1), cellAt(7, 3)]);
    expect(positionKey(mirrorState(mirrorState(s)))).toBe(positionKey(s));
  });

  it('finds lessons for the exact position and for its mirror image', () => {
    const s = replay(0, [cellAt(7, 4), cellAt(1, 4), cellAt(7, 3), wallMove('v', 1, 5)]);
    const book: Book = { [positionKey(s)]: { move: cellAt(6, 3), gain: 100, learnedAt: 0, gameId: 'g' } };
    expect(lookupLesson(book, s)?.move).toBe(cellAt(6, 3));

    const mirrored = mirrorState(s);
    expect(lookupLesson(book, mirrored)?.move).toBe(cellAt(6, 5));
    expect(lookupLesson(book, initialState())).toBeNull();
  });
});

describe('studying a lost game', () => {
  it('finds better moves in a game lost by never using walls', () => {
    // The opponent moves first and runs straight down; we waste a move stepping
    // sideways and then run straight up without using walls. The opponent wins.
    const moves: number[] = [];
    const s = initialState(1);
    let ourMoves = 0;
    while (winner(s) === null) {
      const next = s.turn === 1 ? s.pawns[1] + 9 : ourMoves++ === 0 ? s.pawns[0] - 1 : s.pawns[0] - 9;
      expect(isLegal(s, next)).toBe(true);
      moves.push(next);
      makeMove(s, next);
    }
    expect(winner(s)).toBe(1);

    const findings = studyGame(1, moves, 80);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => isWall(f.better))).toBe(true);
    for (const f of findings) expect(f.better).not.toBe(f.played);
  }, 30_000);
});
