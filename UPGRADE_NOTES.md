# Barricade Assistant – solid-defence update

## Why it was losing (found by replaying your 40+ lost games)
The engine spent all of its walls early (0 walls left by about move 25) and built a big
lead (e.g. 7 steps vs 16). The opponent kept 5-8 walls, then used them late to trap the
pawn from both sides (block one way, win while you go the other). With 0 walls the engine
could not answer. Each wall in hand is worth far more than the old evaluation thought.

## Changes
- **Much higher wall value** (about 1.2 steps for the first wall, ~8.4 steps for a full hand,
  diminishing returns). The engine now keeps walls for defence and stops burning them early.
  In engine-vs-engine tests this alone beat the old engine about 79% of games.
- **Trap awareness (new):** at every search leaf the engine measures the most damage one
  opponent wall could do to your path (and the damage you could do back) and charges part
  of it (`threat` weight, 0.3). A "lead" that one wall can wipe out no longer looks safe.
- Kept: route-flexibility term, repetition-as-draw, incomplete-iteration safety.
- Default think time stays 8 s (2/4/8/15 s choices). Longer time = deeper trap detection.

## Honest limits
Heuristic engine, not a solver. Tests (vitest) and the production build could not be run
here (no npm install); the engine was type-checked and exercised with self-play matches.
Run `npm install && npm test && npm run build` once after unzipping.
Tune with: `npm run match -- default old 40 300`.

## Update 2
- **Fixed a real bug:** repeated positions were scored as a free draw (0), so a losing engine shuffled back and forth (your last game: row 4 col 3 <-> 4 <-> 5 for 30 moves while the opponent walked home). Repeats are now judged on the real board minus a penalty.
- **Opponent-route focus:** every step added to the opponent's route is now worth 1.25x a step of ours (`oppFocus`), together with the trap check from the last update.
- **Win chance bar** at the top of the page (green/yellow/red), from the engine's search score.
- Self-play (20 games, 0.2s) is roughly even with the previous build, so treat this as untested against your real opponent.
