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

## Update 3
- **Faster search:** principal-variation search + late-move reductions + a cheaper trap check. Same depth now takes 1.2x-2.8x less time (e.g. depth 5: 2.3 s vs 6.6 s in a busy middle-game).
- **Auto think time (new default):** 1.2 s in the first moves, 2.5-3.5 s normally, 5 s when someone is close to goal. Sized for a 5-minute game. Fixed 2/4/8/15 s still available.
- **Games are no longer lost:** the game is saved after every move (shown as "Unfinished / left" until it ends), so refresh/close/timeouts keep the record.
- Self-play against the previous build is about even (40-45%, 24 games each, noise is large), so the speed gain is real but extra strength is not proven.

## Update 4 (analysis of 19 games after v3)
- v3 results: 10 wins, 9 losses, 2 unfinished (about 50%, was about 25% before).
- 7 of 9 losses were games where the opponent moved first (one tempo ahead).
- You followed the engine's move in about 90% of moves. The losses at ply 7-9 where you chose a different wall than the engine cost ~3 steps each.
- Engine-played loss pattern: it spends all walls while far ahead (e.g. 7 vs 20 steps, 0 walls left) and the opponent's last 3-5 walls then stretch its route from 2 to 16 steps.
- Tried: stronger "compounding" trap penalty for the opponent's saved walls. It lost clearly in self-play (about 4-14), so it is OFF (`threatScale: 0`). Left in the code as a tuning option.
