import { useEffect, useRef, useState } from 'react';
import type { Finding } from '../engine/study';
import type { StudyMessage, StudyRequest } from '../engine/study.worker';
import type { GameRecord } from '../history';

/** Think time per position when studying a lost game (much deeper than during play). */
export const STUDY_MS = 3000;

export interface StudyStatus {
  gameId: string;
  done: number;
  total: number;
}

/**
 * Studies lost games one at a time in a background worker: the first loss in
 * `history` that has not been studied yet is picked up automatically.
 */
export function useStudy(
  history: GameRecord[],
  onStudied: (gameId: string, findings: Finding[]) => void,
): StudyStatus | null {
  const [status, setStatus] = useState<StudyStatus | null>(null);
  const callback = useRef(onStudied);
  callback.current = onStudied;

  const next = history.find((r) => r.result === 'loss' && !r.studied);
  const nextId = next?.id ?? null;
  const nextLength = next?.moves.length ?? 0;

  useEffect(() => {
    if (!next) {
      setStatus(null);
      return;
    }
    const worker = new Worker(new URL('../engine/study.worker.ts', import.meta.url), { type: 'module' });
    const gameId = next.id;
    setStatus({ gameId, done: 0, total: 0 });
    worker.onmessage = (e: MessageEvent<StudyMessage>) => {
      if (e.data.type === 'progress') {
        setStatus({ gameId, done: e.data.done, total: e.data.total });
      } else {
        worker.terminate();
        setStatus(null);
        callback.current(gameId, e.data.findings);
      }
    };
    worker.onerror = () => {
      worker.terminate();
      setStatus(null);
    };
    const request: StudyRequest = { first: next.first, moves: next.moves, timeMs: STUDY_MS };
    worker.postMessage(request);
    return () => worker.terminate();
    // Restart only when a different game (or a changed one) is up next.
  }, [nextId, nextLength]);

  return status;
}
