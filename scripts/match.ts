/**
 * Engine-vs-engine match runner used to tune the evaluation.
 *
 *   npm run match -- <configA> <configB> [games=40] [ms-per-move=100] [seed=1]
 *
 * Each opening (a few random moves) is played twice with the sides swapped,
 * so neither config benefits from a lucky start.
 */
import { initialState, legalMoves, makeMove, winner, cloneState, isLegal, type Player } from '../src/engine/rules';
import { DEFAULT_WEIGHTS, search, type EvalWeights } from '../src/engine/search';

const concave = (values: number[]) => [0, ...values];

export const CONFIGS: Record<string, EvalWeights> = {
  default: DEFAULT_WEIGHTS,
  linear25: { ...DEFAULT_WEIGHTS, walls: Array.from({ length: 11 }, (_, n) => n * 25) },
  linear10: { ...DEFAULT_WEIGHTS, walls: Array.from({ length: 11 }, (_, n) => n * 10) },
  linear50: { ...DEFAULT_WEIGHTS, walls: Array.from({ length: 11 }, (_, n) => n * 50) },
  linear65: { ...DEFAULT_WEIGHTS, walls: Array.from({ length: 11 }, (_, n) => n * 65) },
  linear80: { ...DEFAULT_WEIGHTS, walls: Array.from({ length: 11 }, (_, n) => n * 80) },
  concave: { ...DEFAULT_WEIGHTS, walls: concave([70, 130, 180, 220, 255, 285, 310, 330, 345, 355]) },
  concave2: { ...DEFAULT_WEIGHTS, walls: concave([110, 200, 270, 325, 370, 405, 435, 460, 480, 495]) },
};

const [nameA = 'default', nameB = 'concave', gamesArg = '40', msArg = '100', seedArg = '1'] = process.argv.slice(2);
const games = Number(gamesArg);
const ms = Number(msArg);
let seed = Number(seedArg);
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

function opening() {
  const s = initialState((rnd() < 0.5 ? 0 : 1) as Player);
  const plies = 1 + Math.floor(rnd() * 4);
  for (let i = 0; i < plies; i++) {
    const moves = legalMoves(s);
    const pawns = moves.filter((m) => m < 81);
    const pool = rnd() < 0.8 ? pawns : moves;
    makeMove(s, pool[Math.floor(rnd() * pool.length)]);
  }
  return s;
}

/** Plays one game; `aPlays` is the player index config A controls. Returns the winner's config name or 'draw'. */
function play(start: ReturnType<typeof initialState>, aPlays: Player): string {
  const s = cloneState(start);
  for (let ply = 0; ply < 200; ply++) {
    const w = winner(s);
    if (w !== null) return w === aPlays ? nameA : nameB;
    const weights = s.turn === aPlays ? CONFIGS[nameA] : CONFIGS[nameB];
    const { move } = search(s, { timeMs: ms, weights });
    if (!isLegal(s, move)) throw new Error('illegal move from engine');
    makeMove(s, move);
  }
  return 'draw';
}

if (!CONFIGS[nameA] || !CONFIGS[nameB]) {
  console.error(`Unknown config. Available: ${Object.keys(CONFIGS).join(', ')}`);
  process.exit(1);
}

const score: Record<string, number> = { [nameA]: 0, [nameB]: 0, draw: 0 };
for (let g = 0; g < games / 2; g++) {
  const start = opening();
  for (const aPlays of [0, 1] as Player[]) {
    score[play(start, aPlays)]++;
  }
  process.stdout.write(`\r${(g + 1) * 2}/${games}  ${nameA} ${score[nameA]} - ${score[nameB]} ${nameB}  (draws ${score.draw})`);
}
const pct = (100 * (score[nameA] + score.draw / 2)) / games;
console.log(`\nResult: ${nameA} scored ${pct.toFixed(1)}% against ${nameB}`);
