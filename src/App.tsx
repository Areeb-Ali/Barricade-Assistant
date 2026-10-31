import { useEffect, useMemo, useRef, useState } from 'react';
import { Board, type InputMode } from './components/Board';
import { useEngine } from './hooks/useEngine';
import { moveName } from './engine/notation';
import {
  CELLS,
  WALLS_PER_PLAYER,
  distanceMap,
  isLegal,
  isWall,
  pawnMoves,
  replay,
  wallLegal,
  winner,
  type Move,
  type Player,
} from './engine/rules';
import { TEMPO, mateIn, type SearchInfo } from './engine/search';

type Color = 'red' | 'blue';

interface Game {
  first: Player;
  /** Your pawn colour; the opponent gets the other one. */
  color?: Color;
  moves: Move[];
  /** Indices of moves the app played for you automatically. */
  auto?: number[];
  /** Move index at which auto-play is paused so you can enter your own move. */
  manualAt?: number;
}

const GAME_KEY = 'barricade-assistant/game';
const THINK_KEY = 'barricade-assistant/think-ms';
const AUTO_KEY = 'barricade-assistant/auto-play';
const COLOR_KEY = 'barricade-assistant/color';
const THINK_OPTIONS = [1000, 2000, 4000, 8000];
const NAMES = ['You', 'Opponent'] as const;

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private mode); the app still works without it.
  }
}

function describeScore(info: SearchInfo): { text: string; tone: 'good' | 'bad' | 'even' } {
  const mate = mateIn(info.score);
  if (mate !== null) {
    const moves = Math.ceil(Math.abs(mate) / 2);
    return mate > 0
      ? { text: `Forced win in ${moves} move${moves === 1 ? '' : 's'}`, tone: 'good' }
      : { text: `Opponent can force a win in ${moves}`, tone: 'bad' };
  }
  // The engine credits the side to move with half a step; report the raw race.
  const steps = (info.score - TEMPO) / 100;
  if (Math.abs(steps) < 0.25) return { text: 'Even race', tone: 'even' };
  const label = `${Math.abs(steps).toFixed(1)} step${Math.abs(steps) >= 1.05 ? 's' : ''}`;
  return steps > 0 ? { text: `You are ahead by ${label}`, tone: 'good' } : { text: `You are behind by ${label}`, tone: 'bad' };
}

export default function App() {
  const [game, setGame] = useState<Game | null>(() => load<Game | null>(GAME_KEY, null));
  const [thinkMs, setThinkMs] = useState(() => load(THINK_KEY, 2000));
  const [autoPlay, setAutoPlay] = useState(() => load(AUTO_KEY, true));
  const [mode, setMode] = useState<InputMode>('move');
  const [pending, setPending] = useState<Move | null>(null);

  useEffect(() => save(GAME_KEY, game), [game]);
  useEffect(() => save(THINK_KEY, thinkMs), [thinkMs]);
  useEffect(() => save(AUTO_KEY, autoPlay), [autoPlay]);

  const state = useMemo(() => (game ? replay(game.first, game.moves) : null), [game]);
  const won = state ? winner(state) : null;
  const yourTurn = state !== null && won === null && state.turn === 0;
  const engine = useEngine(yourTurn ? state : null, thinkMs);

  // Auto-play: once the search for this exact position finishes, play its move.
  const manualTurn = game !== null && game.manualAt === game.moves.length;
  const autoMove =
    autoPlay && yourTurn && !manualTurn && !engine.thinking && engine.position === state && engine.info
      ? engine.info.move
      : null;
  const autoAt = game?.moves.length ?? 0;
  useEffect(() => {
    if (autoMove === null) return;
    setGame((g) =>
      g && g.moves.length === autoAt ? { ...g, moves: [...g.moves, autoMove], auto: [...(g.auto ?? []), autoAt] } : g,
    );
  }, [autoMove, autoAt]);

  // Whenever the move count changes (including auto-play), drop back to pawn input
  // so a leftover wall mode never swallows the next click.
  const moveCount = game?.moves.length ?? -1;
  useEffect(() => {
    setMode('move');
    setPending(null);
  }, [moveCount]);

  // Keyboard shortcuts for laptops: H / V toggle wall modes, Esc cancels, Ctrl+Z undoes.
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const distances = useMemo(() => {
    if (!state) return [0, 0];
    return ([0, 1] as const).map((p) => distanceMap(state, p, new Int16Array(CELLS))[state.pawns[p]]);
  }, [state]);

  const wallOwners = useMemo(() => {
    const owners = new Map<Move, Player>();
    game?.moves.forEach((m, i) => {
      if (isWall(m)) owners.set(m, ((game.first + i) % 2) as Player);
    });
    return owners;
  }, [game]);

  if (!game || !state) {
    return <Setup onStart={(first, color) => setGame({ first, color, moves: [] })} />;
  }

  const current = game;
  const lastMove = current.moves.length ? current.moves[current.moves.length - 1] : null;
  const lastWasAuto = lastMove !== null && (current.auto ?? []).includes(current.moves.length - 1);
  const playedForYou = won === null && !yourTurn && lastWasAuto ? lastMove : null;
  const suggestion = yourTurn && engine.info ? engine.info.move : playedForYou;
  const canWall = won === null && state.walls[state.turn] > 0;

  function play(m: Move) {
    if (!state || !isLegal(state, m)) return;
    setGame({ ...current, moves: [...current.moves, m] });
    setPending(null);
    setMode('move');
  }

  function undo() {
    const moves = current.moves.slice(0, -1);
    const auto = (current.auto ?? []).filter((i) => i < moves.length);
    // Landing on your own turn pauses auto-play so you can enter that move yourself.
    const yoursNext = (current.first + moves.length) % 2 === 0;
    setGame({ ...current, moves, auto, manualAt: yoursNext ? moves.length : current.manualAt });
    setPending(null);
  }

  function chooseMode(next: InputMode) {
    setMode(mode === next ? 'move' : next);
    setPending(null);
  }

  function onWallTap(m: Move, direct: boolean) {
    // An illegal spot is shown (in red, with a message) instead of silently ignored.
    if (!wallLegal(state!, m)) setPending(m);
    else if (direct || pending === m) play(m);
    else setPending(m);
  }

  keyHandler.current = (e) => {
    if (e.target instanceof HTMLInputElement || e.altKey || e.metaKey) return;
    const key = e.key.toLowerCase();
    if ((e.ctrlKey && key === 'z') || (!e.ctrlKey && key === 'backspace')) {
      if (current.moves.length > 0) undo();
    } else if (e.ctrlKey) {
      return;
    } else if (key === 'h' && canWall) chooseMode('h');
    else if (key === 'v' && canWall) chooseMode('v');
    else if (key === 'escape') chooseMode('move');
    else return;
    e.preventDefault();
  };

  return (
    <div className={`app color-${current.color ?? 'red'}`}>
      <header className="topbar">
        <h1>
          <span className="logo" aria-hidden="true" />
          Barricade Assistant
        </h1>
        <button className="ghost" onClick={() => setGame(null)}>
          New game
        </button>
      </header>

      <main className="layout">
        <section className="board-column">
          <div className="players">
            {([0, 1] as const).map((p) => (
              <PlayerCard
                key={p}
                player={p}
                active={won === null && state.turn === p}
                walls={state.walls[p]}
                distance={distances[p]}
              />
            ))}
          </div>

          <div className={`status ${won !== null ? (won === 0 ? 'win' : 'loss') : ''}`}>
            {won !== null
              ? won === 0
                ? 'You win! 🎉'
                : 'Opponent wins.'
              : yourTurn
                ? autoPlay && !manualTurn
                  ? 'Thinking… your move will be played automatically.'
                  : 'Your move. Play the suggestion or enter the move you actually played.'
                : playedForYou !== null
                  ? `Played for you: ${moveName(playedForYou)}. Copy it, then enter the opponent's reply.`
                  : "Opponent's move. Enter what they played."}
          </div>

          <Board
            state={state}
            mode={mode}
            interactive={won === null}
            targets={won === null ? pawnMoves(state, state.turn) : []}
            suggestion={suggestion}
            lastMove={lastMove}
            wallOwners={wallOwners}
            pending={pending}
            canPlaceWall={(m) => wallLegal(state, m)}
            onPawn={(cell) => play(cell)}
            onWallTap={onWallTap}
          />

          <div className="controls">
            <button
              className={`mode ${mode === 'h' ? 'on' : ''}`}
              disabled={!canWall}
              onClick={() => chooseMode('h')}
              aria-pressed={mode === 'h'}
            >
              <span className={`wall-icon h p${state.turn}`} /> Horizontal
            </button>
            <button
              className={`mode ${mode === 'v' ? 'on' : ''}`}
              disabled={!canWall}
              onClick={() => chooseMode('v')}
              aria-pressed={mode === 'v'}
            >
              <span className={`wall-icon v p${state.turn}`} /> Vertical
            </button>
            <button className="ghost" disabled={current.moves.length === 0} onClick={undo}>
              Undo
            </button>
          </div>

          <p className="shortcuts muted">
            Keys: <kbd>H</kbd> horizontal · <kbd>V</kbd> vertical · <kbd>Esc</kbd> cancel · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo
          </p>

          {mode !== 'move' && (
            <p className={`hint ${pending !== null && !wallLegal(state, pending) ? 'bad' : ''}`}>
              {pending === null
                ? 'Click or tap the gap where the wall goes (tap twice on touch screens). Esc cancels.'
                : wallLegal(state, pending)
                  ? `Wall ${moveName(pending)}: tap it again to place it.`
                  : `A wall can't go at ${moveName(pending)} (it overlaps, crosses or blocks a path). Try another gap, or press ${mode === 'h' ? 'Horizontal' : 'Vertical'} again to cancel.`}
            </p>
          )}
        </section>

        <aside className="side-column">
          {playedForYou !== null && (
            <section className="panel played">
              <h2>Played for you</h2>
              <div className="best">
                <span className="best-move">{moveName(playedForYou)}</span>
                <span className="best-kind">{isWall(playedForYou) ? 'Place wall' : 'Move pawn'}</span>
              </div>
              <p className="muted">Make this move in your game, then enter the opponent's reply.</p>
              <button className="secondary wide" onClick={undo}>
                I played something else
              </button>
            </section>
          )}

          <Analysis
            yourTurn={yourTurn}
            hidden={playedForYou !== null}
            gameOver={won !== null}
            info={engine.info}
            thinking={engine.thinking}
            onPlay={() => suggestion !== null && play(suggestion)}
          />

          <section className="panel">
            <h2>Settings</h2>
            <label className="switch-row">
              <span>
                <strong>Auto-play my moves</strong>
                <span className="muted small-block">
                  Plays the suggestion for you, so you only enter the opponent's moves.
                </span>
              </span>
              <input
                type="checkbox"
                className="switch"
                checked={autoPlay}
                onChange={(e) => setAutoPlay(e.target.checked)}
              />
            </label>
            <h3 className="sub">Think time</h3>
            <div className="segmented" role="radiogroup" aria-label="Think time">
              {THINK_OPTIONS.map((ms) => (
                <button
                  key={ms}
                  role="radio"
                  aria-checked={thinkMs === ms}
                  className={thinkMs === ms ? 'on' : ''}
                  onClick={() => setThinkMs(ms)}
                >
                  {ms / 1000}s
                </button>
              ))}
            </div>
            <p className="muted small">Longer is stronger. 2s is plenty against most opponents.</p>
          </section>

          <MoveList game={current} />
          <Rules />
        </aside>
      </main>
    </div>
  );
}

function Setup({ onStart }: { onStart: (first: Player, color: Color) => void }) {
  const [color, setColor] = useState<Color>(() => load<Color>(COLOR_KEY, 'red'));
  const other: Color = color === 'red' ? 'blue' : 'red';

  function start(first: Player) {
    save(COLOR_KEY, color);
    onStart(first, color);
  }

  return (
    <div className={`app color-${color}`}>
      <header className="topbar">
        <h1>
          <span className="logo" aria-hidden="true" />
          Barricade Assistant
        </h1>
      </header>
      <main className="setup">
        <section className="panel">
          <h2>New game</h2>
          <p>
            Mirror your game here. On your turn the engine finds the strongest move and, with
            auto-play on, plays it for you: just copy it into your game. On the opponent's turn,
            enter what they played. Did something different? Tap <em>I played something else</em>.
          </p>
          <h3>Your colour</h3>
          <div className="setup-buttons" role="radiogroup" aria-label="Your colour">
            {(['red', 'blue'] as const).map((c) => (
              <button
                key={c}
                role="radio"
                aria-checked={color === c}
                className={`color-pick ${c} ${color === c ? 'on' : ''}`}
                onClick={() => setColor(c)}
              >
                <span className="dot" /> {c === 'red' ? 'Red' : 'Blue'}
              </button>
            ))}
          </div>
          <p className="muted">
            You are <strong className="you-text">{color}</strong> (bottom). The opponent is{' '}
            <strong className="opp-text">{other}</strong> (top).
          </p>
          <h3>Who moves first?</h3>
          <div className="setup-buttons">
            <button className="primary" onClick={() => start(0)}>
              I move first
            </button>
            <button className="secondary" onClick={() => start(1)}>
              Opponent moves first
            </button>
          </div>
        </section>
        <Rules />
      </main>
    </div>
  );
}

function PlayerCard(props: { player: Player; active: boolean; walls: number; distance: number }) {
  const { player, active, walls, distance } = props;
  return (
    <div className={`player-card p${player} ${active ? 'active' : ''}`}>
      <div className="player-name">{NAMES[player]}</div>
      <div className="player-stats">
        <span className={`wall-chip p${player}`} />
        <strong>{walls}</strong>
        <span className="muted">/{WALLS_PER_PLAYER}</span>
        <span className="distance" title="Shortest path to goal">
          {distance} to go
        </span>
      </div>
    </div>
  );
}

function Analysis(props: {
  yourTurn: boolean;
  hidden: boolean;
  gameOver: boolean;
  info: SearchInfo | null;
  thinking: boolean;
  onPlay: () => void;
}) {
  const { yourTurn, hidden, gameOver, info, thinking, onPlay } = props;
  if (gameOver || hidden) return null;
  if (!yourTurn) {
    return (
      <section className="panel analysis idle">
        <h2>Suggestion</h2>
        <p className="muted">Waiting for the opponent's move. Tap a square or place a wall for them.</p>
      </section>
    );
  }
  const score = info ? describeScore(info) : null;
  return (
    <section className="panel analysis">
      <div className="analysis-head">
        <h2>Suggestion</h2>
        {thinking && <span className="spinner" aria-label="Thinking" />}
      </div>
      {info ? (
        <>
          <div className="best">
            <span className={`best-move ${isWall(info.move) ? 'is-wall' : ''}`}>{moveName(info.move)}</span>
            <span className="best-kind">{isWall(info.move) ? 'Place wall' : 'Move pawn'}</span>
          </div>
          <div className={`eval ${score!.tone}`}>{score!.text}</div>
          <button className="primary wide" onClick={onPlay}>
            Play suggestion
          </button>
          <div className="pv">
            {info.pv.map((m, i) => (
              <span key={i} className={`chip p${i % 2}`}>
                {moveName(m)}
              </span>
            ))}
          </div>
          <p className="muted small">
            Depth {info.depth} · {info.nodes.toLocaleString()} positions · {(info.elapsedMs / 1000).toFixed(1)}s
          </p>
        </>
      ) : (
        <p className="muted">Thinking…</p>
      )}
    </section>
  );
}

function MoveList({ game }: { game: Game }) {
  return (
    <section className="panel">
      <h2>Moves</h2>
      {game.moves.length === 0 ? (
        <p className="muted">No moves yet.</p>
      ) : (
        <ol className="moves">
          {game.moves.map((m, i) => {
            const p = (game.first + i) % 2;
            return (
              <li key={i} className={`chip p${p}`}>
                <span className="muted">{i + 1}.</span> {moveName(m)}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function Rules() {
  return (
    <details className="panel rules">
      <summary>Rules and notation</summary>
      <ul>
        <li>Each player starts in the middle of their edge and races to the opposite edge.</li>
        <li>On your turn, either move your pawn one square or place one of your 10 walls.</li>
        <li>Walls are two squares long and cannot overlap or cross another wall.</li>
        <li>A wall may never cut a player off completely from their goal.</li>
        <li>
          If the pawns are face to face, you may jump over the other pawn. If a wall or the edge is behind
          it, you may step diagonally instead.
        </li>
        <li>
          Squares are named <code>a1</code>–<code>i9</code> (files left to right, ranks bottom to top).
          Walls are named by the square at the lower-left of the 2×2 block they split, plus <code>h</code> or{' '}
          <code>v</code>, e.g. <code>d4h</code>.
        </li>
      </ul>
    </details>
  );
}
