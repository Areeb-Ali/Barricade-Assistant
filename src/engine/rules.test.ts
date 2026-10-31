import { describe, expect, it } from 'vitest';
import {
  cellAt,
  initialState,
  isLegal,
  legalMoves,
  makeMove,
  pawnMoves,
  replay,
  setWall,
  stateFrom,
  unmakeMove,
  wallMove,
  winner,
  type State,
} from './rules';
import { moveName } from './notation';

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);

function place(s: State, o: 'h' | 'v', row: number, col: number) {
  setWall(s, wallMove(o, row, col), 1);
}

describe('pawn movement', () => {
  it('starts with three moves from the bottom centre', () => {
    const s = initialState();
    expect(sorted(pawnMoves(s, 0))).toEqual(sorted([cellAt(7, 4), cellAt(8, 3), cellAt(8, 5)]));
  });

  it('jumps straight over an adjacent opponent', () => {
    const s = initialState();
    s.pawns = [cellAt(5, 4), cellAt(4, 4)];
    expect(pawnMoves(s, 0)).toContain(cellAt(3, 4));
    expect(pawnMoves(s, 0)).not.toContain(cellAt(4, 4));
  });

  it('side-steps diagonally when a wall is behind the opponent', () => {
    const s = initialState();
    s.pawns = [cellAt(5, 4), cellAt(4, 4)];
    place(s, 'h', 3, 4); // blocks rows 3/4 at columns 4 and 5
    expect(sorted(pawnMoves(s, 0))).toEqual(
      sorted([cellAt(4, 3), cellAt(4, 5), cellAt(6, 4), cellAt(5, 3), cellAt(5, 5)]),
    );
  });

  it('respects walls', () => {
    const s = initialState();
    place(s, 'h', 7, 3); // blocks rows 7/8 at columns 3 and 4
    expect(pawnMoves(s, 0)).not.toContain(cellAt(7, 4));
  });
});

describe('walls', () => {
  it('rejects overlapping and crossing walls', () => {
    const s = initialState();
    makeMove(s, wallMove('h', 4, 4));
    makeMove(s, cellAt(1, 4)); // opponent pawn move to pass the turn back
    expect(isLegal(s, wallMove('h', 4, 4))).toBe(false);
    expect(isLegal(s, wallMove('h', 4, 3))).toBe(false);
    expect(isLegal(s, wallMove('h', 4, 5))).toBe(false);
    expect(isLegal(s, wallMove('v', 4, 4))).toBe(false);
    expect(isLegal(s, wallMove('h', 4, 6))).toBe(true);
    expect(isLegal(s, wallMove('v', 3, 4))).toBe(true);
  });

  it('forbids walls that cut a player off from their goal', () => {
    const s = initialState();
    s.pawns[0] = cellAt(8, 0);
    // A vertical wall walls off column 0 on rows 7-8; a horizontal wall on top would seal it.
    place(s, 'v', 7, 0);
    expect(isLegal(s, wallMove('h', 6, 0))).toBe(false);
    expect(isLegal(s, wallMove('h', 5, 0))).toBe(true);
  });

  it('decrements wall stock and restores it on unmake', () => {
    const s = initialState();
    const m = wallMove('v', 2, 2);
    const undo = makeMove(s, m);
    expect(s.walls[0]).toBe(9);
    unmakeMove(s, m, undo);
    expect(s.walls[0]).toBe(10);
    expect(s.turn).toBe(0);
  });

  it('offers 128 walls plus pawn moves at the start', () => {
    expect(legalMoves(initialState()).length).toBe(3 + 128);
  });
});

describe('game flow', () => {
  it('detects a winner', () => {
    const s = initialState();
    s.pawns[0] = cellAt(0, 2);
    expect(winner(s)).toBe(0);
  });

  it('replays move lists', () => {
    const s = replay(1, [cellAt(1, 4), cellAt(7, 4)]);
    expect(s.pawns).toEqual([cellAt(7, 4), cellAt(1, 4)]);
    expect(s.turn).toBe(1);
  });

  it('names moves', () => {
    expect(moveName(cellAt(8, 4))).toBe('e1');
    expect(moveName(cellAt(0, 0))).toBe('a9');
    expect(moveName(wallMove('h', 7, 3))).toBe('d1h');
    expect(moveName(wallMove('v', 0, 0))).toBe('a8v');
  });
});

describe('edge table', () => {
  it('stays consistent with the wall arrays through make and unmake', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const s = initialState();
    const history: [number, number][] = [];
    for (let i = 0; i < 60 && winner(s) === null; i++) {
      const moves = legalMoves(s);
      const m = moves[(rnd() * moves.length) | 0];
      history.push([m, makeMove(s, m)]);
      expect(Array.from(s.edges)).toEqual(Array.from(stateFrom(s).edges));
    }
    while (history.length) {
      const [m, undo] = history.pop()!;
      unmakeMove(s, m, undo);
    }
    expect(Array.from(s.edges)).toEqual(Array.from(initialState().edges));
  });
});
