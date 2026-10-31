import { useRef, useState, type PointerEvent } from 'react';
import {
  SIZE,
  SLOTS,
  cellAt,
  colOf,
  decodeWall,
  isWall,
  rowOf,
  wallMove,
  type Move,
  type Player,
  type State,
} from '../engine/rules';

export type InputMode = 'move' | 'h' | 'v';

interface BoardProps {
  state: State;
  mode: InputMode;
  interactive: boolean;
  /** Legal pawn destinations for the side to move. */
  targets: Move[];
  suggestion: Move | null;
  lastMove: Move | null;
  wallOwners: Map<Move, Player>;
  pending: Move | null;
  canPlaceWall: (m: Move) => boolean;
  onPawn: (cell: number) => void;
  onWallTap: (m: Move, direct: boolean) => void;
}

const PITCH = 100;
const GAP = 6;
const CELL = PITCH - 2 * GAP;
const FILES = 'abcdefghi';
const PLAYER_CLASS = ['you', 'opp'] as const;

function wallRect(m: Move) {
  const { orientation, row, col } = decodeWall(m);
  return orientation === 'h'
    ? { x: col * PITCH + GAP, y: (row + 1) * PITCH - 7, width: 2 * PITCH - 2 * GAP, height: 14 }
    : { x: (col + 1) * PITCH - 7, y: row * PITCH + GAP, width: 14, height: 2 * PITCH - 2 * GAP };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function Board(props: BoardProps) {
  const { state, mode, interactive, targets, suggestion, lastMove, wallOwners, pending } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Move | null>(null);

  function toBoard(e: PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  }

  function slotAt(e: PointerEvent<SVGSVGElement>): Move | null {
    const p = toBoard(e);
    if (!p || mode === 'move') return null;
    const col = clamp(Math.round(p.x / PITCH) - 1, 0, SLOTS - 1);
    const row = clamp(Math.round(p.y / PITCH) - 1, 0, SLOTS - 1);
    return wallMove(mode, row, col);
  }

  function onPointerMove(e: PointerEvent<SVGSVGElement>) {
    if (!interactive || e.pointerType !== 'mouse') return;
    setHover(slotAt(e));
  }

  function onPointerUp(e: PointerEvent<SVGSVGElement>) {
    if (!interactive) return;
    if (mode === 'move') {
      const p = toBoard(e);
      if (!p) return;
      const col = Math.floor(p.x / PITCH);
      const row = Math.floor(p.y / PITCH);
      if (row >= 0 && row < SIZE && col >= 0 && col < SIZE) props.onPawn(cellAt(row, col));
      return;
    }
    // A click in the middle of a highlighted square is a pawn move even in wall mode;
    // walls are placed by clicking near the gaps between squares.
    const p = toBoard(e);
    if (p) {
      const col = Math.floor(p.x / PITCH);
      const row = Math.floor(p.y / PITCH);
      const fx = p.x - col * PITCH;
      const fy = p.y - row * PITCH;
      const central = fx > 25 && fx < 75 && fy > 25 && fy < 75;
      if (central && row >= 0 && row < SIZE && col >= 0 && col < SIZE && targets.includes(cellAt(row, col))) {
        props.onPawn(cellAt(row, col));
        return;
      }
    }
    const m = slotAt(e);
    if (m !== null) props.onWallTap(m, e.pointerType === 'mouse');
  }

  const preview = mode === 'move' ? null : (pending ?? hover);
  const placed: Move[] = [];
  wallOwners.forEach((_, m) => placed.push(m));

  return (
    <svg
      ref={svgRef}
      className={`board mode-${mode}`}
      viewBox="-34 -4 942 942"
      role="img"
      aria-label="Game board"
      onPointerMove={onPointerMove}
      onPointerLeave={() => setHover(null)}
      onPointerUp={onPointerUp}
    >
      {Array.from({ length: SIZE }, (_, r) => (
        <text key={`r${r}`} className="coord" x={-17} y={r * PITCH + PITCH / 2}>
          {SIZE - r}
        </text>
      ))}
      {Array.from({ length: SIZE }, (_, c) => (
        <text key={`c${c}`} className="coord" x={c * PITCH + PITCH / 2} y={922}>
          {FILES[c]}
        </text>
      ))}

      {Array.from({ length: SIZE * SIZE }, (_, cell) => {
        const r = rowOf(cell);
        const goal = r === 0 ? ' goal-you' : r === SIZE - 1 ? ' goal-opp' : '';
        return (
          <rect
            key={cell}
            className={`cell${goal}`}
            x={colOf(cell) * PITCH + GAP}
            y={r * PITCH + GAP}
            width={CELL}
            height={CELL}
            rx={12}
          />
        );
      })}

      {lastMove !== null && !isWall(lastMove) && (
        <rect
          className="last-move"
          x={colOf(lastMove) * PITCH + GAP}
          y={rowOf(lastMove) * PITCH + GAP}
          width={CELL}
          height={CELL}
          rx={12}
        />
      )}

      {interactive &&
        targets.map((cell) => (
          <rect
            key={`t${cell}`}
            className={`target${mode === 'move' ? '' : ' faint'}`}
            x={colOf(cell) * PITCH + GAP + 2}
            y={rowOf(cell) * PITCH + GAP + 2}
            width={CELL - 4}
            height={CELL - 4}
            rx={11}
          />
        ))}

      {suggestion !== null &&
        (isWall(suggestion) ? (
          <rect className="suggest-wall" rx={7} {...wallRect(suggestion)} />
        ) : (
          <circle
            className="suggest-pawn"
            cx={colOf(suggestion) * PITCH + PITCH / 2}
            cy={rowOf(suggestion) * PITCH + PITCH / 2}
            r={31}
          />
        ))}

      {placed.map((m) => (
        <rect
          key={`w${m}`}
          className={`wall ${PLAYER_CLASS[wallOwners.get(m)!]}${m === lastMove ? ' latest' : ''}`}
          rx={7}
          {...wallRect(m)}
        />
      ))}

      {preview !== null && (
        <rect
          className={`wall-preview ${props.canPlaceWall(preview) ? 'ok' : 'bad'}${pending === preview ? ' pending' : ''}`}
          rx={7}
          {...wallRect(preview)}
        />
      )}

      {state.pawns.map((cell, p) => (
        <circle
          key={`p${p}`}
          className={`pawn ${PLAYER_CLASS[p]}${state.turn === p ? ' to-move' : ''}`}
          cx={colOf(cell) * PITCH + PITCH / 2}
          cy={rowOf(cell) * PITCH + PITCH / 2}
          r={28}
        />
      ))}
    </svg>
  );
}
