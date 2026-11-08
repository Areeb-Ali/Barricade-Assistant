import { describe, expect, it } from 'vitest';
import { CELLS, cellAt, distanceMap, initialState, isLegal, isWall, makeMove, pawnMoves, winner } from './rules';
import { DEFAULT_WEIGHTS, evaluate, mateIn, search } from './search';

describe('search', () => {
  it('protects the last wall more than an early wall', () => {
    const w = DEFAULT_WEIGHTS.walls;
    expect(w[1] - w[0]).toBeGreaterThan(w[10] - w[9]);
  });

  it('prefers a position with more independent shortest routes', () => {
    const fragile = evaluate(5, 5, 5, 5, DEFAULT_WEIGHTS, 1, 1);
    const flexible = evaluate(5, 5, 5, 5, DEFAULT_WEIGHTS, 4, 1);
    expect(flexible).toBeGreaterThan(fragile);
  });

  it('keeps a legal fallback if the time budget expires before depth one', () => {
    const s = initialState(0);
    const r = search(s, { timeMs: 0 });
    expect(isLegal(s, r.move)).toBe(true);
    expect(r.depth).toBe(0);
  });

  it('takes an immediate win', () => {
    const s = initialState(0);
    s.pawns = [cellAt(1, 0), cellAt(7, 8)];
    const r = search(s, { timeMs: 500 });
    expect(r.move).toBe(cellAt(0, 0));
    expect(mateIn(r.score)).toBe(1);
  });

  it('blocks an opponent who is one step from winning', () => {
    const s = initialState(0);
    // Opponent (goal row 8) is on row 7; we are far from our goal.
    s.pawns = [cellAt(8, 0), cellAt(7, 6)];
    const r = search(s, { timeMs: 1000 });
    expect(isWall(r.move)).toBe(true);
    makeMove(s, r.move);
    const g = distanceMap(s, 1, new Int16Array(CELLS));
    expect(g[s.pawns[1]]).toBeGreaterThan(1);
  });

  it('beats a greedy shortest-path runner that moves first', () => {
    const s = initialState(1);
    const g = new Int16Array(CELLS);
    for (let turn = 0; turn < 200 && winner(s) === null; turn++) {
      if (s.turn === 1) {
        distanceMap(s, 1, g);
        const steps = pawnMoves(s, 1).sort((a, b) => g[a] - g[b]);
        makeMove(s, steps[0]);
      } else {
        const r = search(s, { timeMs: 60 });
        expect(isLegal(s, r.move)).toBe(true);
        makeMove(s, r.move);
      }
    }
    expect(winner(s)).toBe(0);
  }, 30_000);

  it('always returns a legal move and a principal variation', () => {
    const s = initialState(1);
    const r = search(s, { timeMs: 300 });
    expect(isLegal(s, r.move)).toBe(true);
    expect(r.pv[0]).toBe(r.move);
    expect(r.depth).toBeGreaterThan(0);
  });
});
