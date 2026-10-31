import { positionKey } from './book';
import { cloneState, initialState, makeMove, winner, type Move, type Player } from './rules';
import { search } from './search';

/** A move in a finished game that a deeper search would have played differently. */
export interface Finding {
  /** Index of the mistaken move in the game's move list. */
  index: number;
  key: string;
  played: Move;
  better: Move;
  /** Estimated improvement of `better` over `played` (centi-steps; mate-sized when it avoids a loss). */
  gain: number;
}

/** Only differences of at least this much are worth remembering. */
export const MIN_GAIN = 60;

/**
 * Replays a game and re-searches every position where player 0 ("you") was
 * to move, with a much longer think time than during play. Wherever the deep
 * search finds a clearly better move than the one played, that becomes a
 * finding.
 */
export function studyGame(
  first: Player,
  moves: readonly Move[],
  timeMs: number,
  onProgress?: (done: number, total: number) => void,
): Finding[] {
  const s = initialState(first);
  const positions: number[] = [];
  for (let i = 0; i < moves.length; i++) {
    if (s.turn === 0) positions.push(i);
    makeMove(s, moves[i]);
  }

  const findings: Finding[] = [];
  const replayed = initialState(first);
  let done = 0;
  onProgress?.(0, positions.length);
  for (let i = 0; i < moves.length; i++) {
    if (replayed.turn === 0) {
      const played = moves[i];
      const best = search(replayed, { timeMs });
      if (best.move !== played) {
        const after = cloneState(replayed);
        makeMove(after, played);
        if (winner(after) === null) {
          const playedScore = -search(after, { timeMs }).score;
          const gain = best.score - playedScore;
          if (gain >= MIN_GAIN) {
            findings.push({ index: i, key: positionKey(replayed), played, better: best.move, gain });
          }
        }
      }
      onProgress?.(++done, positions.length);
    }
    makeMove(replayed, moves[i]);
  }
  return findings;
}
