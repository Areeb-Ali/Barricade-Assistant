# Barricade Assistant

A move-suggestion engine for **Barricade**, the 9×9 wall-and-race board game.
Mirror a game you are playing elsewhere move by move, and on every turn the
engine searches the position and tells you the strongest move to play.

Runs entirely in the browser: no server, no API keys, no LLM. Works offline once loaded.

**Live demo:** https://areeb-ali.github.io/Manual-Hack-Barricade/

<p align="center">
  <img src="docs/screenshot-desktop.png" alt="Barricade Assistant suggesting a wall placement on desktop" width="68%" />
  &nbsp;
  <img src="docs/screenshot-mobile.png" alt="Barricade Assistant on a phone" width="24%" />
</p>

## Features

- **Game-tree search engine**: iterative-deepening negamax with alpha-beta pruning,
  a Zobrist-hashed transposition table and history move ordering, running in a
  Web Worker so the UI stays responsive.
- **Shortest-path evaluation**: positions are scored by the race between both
  players' shortest routes to goal, walls in hand, and exact race detection
  once a player has no walls left.
- **Full rules**: straight jumps, diagonal side-steps, wall overlap and crossing
  checks, and the "never fully block a player" rule.
- **Mobile-first UI**: tap a square to move, or pick Horizontal / Vertical and tap a gap
  to place a wall (tap twice on touch screens to confirm). Includes undo, the
  best line of play, configurable think time, and auto-save in local storage.

## How to use

1. Open the app and pick who moves first.
2. When it's **your** turn, the suggestion is highlighted in green on the board.
   Press **Play suggestion** (or play something else) and make the same move in your game.
3. When it's the **opponent's** turn, enter what they played: tap the square their
   pawn moved to, or choose Horizontal / Vertical and tap where their wall went.
4. Made a mistake? Press **Undo**.

You are always red (bottom, racing up). The opponent is always blue (top, racing down).

## Getting started

Requires Node.js 18 or later.

```bash
npm install
npm run dev       # start the dev server
npm test          # run the engine test suite
npm run build     # type-check and build to dist/
```

## Deploying

The app is a static Vite build with relative asset paths, so any static host works.

**GitHub Pages:** in *Settings → Pages*, set *Source* to **GitHub Actions**. The
[`deploy.yml`](.github/workflows/deploy.yml) workflow tests, builds and publishes on every push to `main`.

**Netlify:** choose *Add new site → Import an existing project* and pick this repository.
Build settings are read from `netlify.toml` (build command `npm run build`, publish
directory `dist`). Every push to `main` redeploys.

**Vercel:** import the repository at [vercel.com/new](https://vercel.com/new). The Vite
preset is detected automatically.

## Project structure

```
src/
  engine/
    rules.ts       board representation, move generation, legality, path finding
    search.ts      alpha-beta search, evaluation, transposition table
    notation.ts    move names (e2, d4h, …)
    worker.ts      Web Worker entry point for the search
  hooks/
    useEngine.ts   runs and cancels searches as the position changes
  components/
    Board.tsx      SVG board with pawn and wall input
  App.tsx          game state, panels, setup screen
```

## Notation

Squares are named `a1`–`i9`: files `a`–`i` from left to right, ranks `1`–`9` from
the bottom (your side) to the top. A wall is named by the square at the lower-left
of the 2×2 block it splits, followed by `h` (horizontal) or `v` (vertical). For
example, `e1h` is a horizontal wall just above squares `e1` and `f1`.

## License

[MIT](LICENSE)
