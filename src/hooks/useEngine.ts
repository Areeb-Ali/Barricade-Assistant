import { useEffect, useRef, useState } from 'react';
import type { State } from '../engine/rules';
import type { SearchInfo } from '../engine/search';
import type { SearchRequest, SearchResponse } from '../engine/worker';

export interface EngineState {
  info: SearchInfo | null;
  thinking: boolean;
}

/**
 * Runs the search in a Web Worker whenever `position` changes. Pass `null` to
 * stay idle. A running search is cancelled by terminating its worker.
 */
export function useEngine(position: State | null, timeMs: number): EngineState {
  const [engine, setEngine] = useState<EngineState>({ info: null, thinking: false });
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    if (!position) {
      setEngine({ info: null, thinking: false });
      return;
    }

    const worker = new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module' });
    setEngine({ info: null, thinking: true });

    worker.onmessage = (e: MessageEvent<SearchResponse>) => {
      if (e.data.id !== requestId.current) return;
      setEngine({ info: e.data.info, thinking: !e.data.done });
      if (e.data.done) worker.terminate();
    };
    worker.onerror = () => {
      if (id === requestId.current) setEngine((prev) => ({ ...prev, thinking: false }));
      worker.terminate();
    };

    const request: SearchRequest = {
      id,
      timeMs,
      state: {
        pawns: [position.pawns[0], position.pawns[1]],
        walls: [position.walls[0], position.walls[1]],
        h: Array.from(position.h),
        v: Array.from(position.v),
        turn: position.turn,
      },
    };
    worker.postMessage(request);

    return () => worker.terminate();
  }, [position, timeMs]);

  return engine;
}
