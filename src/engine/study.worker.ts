import type { Move, Player } from './rules';
import { studyGame, type Finding } from './study';

export interface StudyRequest {
  first: Player;
  moves: Move[];
  timeMs: number;
}

export type StudyMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; findings: Finding[] };

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<StudyRequest>) => void) | null;
  postMessage(message: StudyMessage): void;
};

ctx.onmessage = (e) => {
  const { first, moves, timeMs } = e.data;
  const findings = studyGame(first, moves, timeMs, (done, total) => ctx.postMessage({ type: 'progress', done, total }));
  ctx.postMessage({ type: 'done', findings });
};
