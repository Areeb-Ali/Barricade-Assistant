# Barricade Assistant – strategic update

## Changes in this build

- **Scarcity-aware wall valuation:** wall stock now uses a diminishing-returns curve. Spending a wall while holding 10 is relatively cheap; spending the final wall is substantially more expensive. This is intended to reduce early wall depletion and preserve late-game defensive options.
- **Stronger default thinking time:** new installs default to 8 seconds per move, with 2s / 4s / 8s / 15s choices. Existing installs that still have the old 2-second default are migrated to 8 seconds.
- **Route flexibility remains in evaluation:** positions with multiple shortest routes are preferred over equally short but fragile corridors.
- **Search safety remains:** incomplete iterative-deepening iterations are not allowed to replace the last fully completed result; repeated positions on the current search line are treated as draws.

## Important limitations

This is a heuristic engine, not a proof-solving engine. The wall reserve curve is a strategic adjustment and still needs match benchmarking against strong human/opponent play. Repetition detection covers the current search line, not a full external game's history. Automated tests and production build could not be run in this environment because npm dependency installation did not complete.
