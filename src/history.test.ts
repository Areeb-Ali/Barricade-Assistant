import { describe, expect, it } from 'vitest';
import { makeBackup, mergeBackup, upsertRecord, type GameRecord } from './history';

const record = (id: string, endedAt: number, result: GameRecord['result'] = 'win'): GameRecord => ({
  id,
  startedAt: endedAt - 1000,
  endedAt,
  first: 0,
  moves: [67],
  result,
});

describe('game history', () => {
  it('replaces records by id and keeps the newest first', () => {
    let h = upsertRecord([], record('a', 1));
    h = upsertRecord(h, record('b', 2));
    h = upsertRecord(h, { ...record('a', 3), result: 'loss' });
    expect(h.map((r) => [r.id, r.result])).toEqual([
      ['a', 'loss'],
      ['b', 'win'],
    ]);
  });

  it('round-trips a backup and merges without duplicates', () => {
    const lesson = { move: 140, gain: 200, learnedAt: 1, gameId: 'a' };
    const backup = JSON.parse(JSON.stringify(makeBackup([record('a', 1), record('b', 2)], { k1: lesson })));
    const merged = mergeBackup([record('b', 2)], { k1: { ...lesson, gain: 50 }, k2: lesson }, backup);
    expect(merged.games).toBe(1);
    expect(merged.history.map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(merged.book.k1.gain).toBe(200);
    expect(merged.book.k2).toBeDefined();
  });

  it('rejects files that are not backups', () => {
    expect(() => mergeBackup([], {}, { hello: 'world' })).toThrow(/not a Barricade Assistant backup/);
  });
});
