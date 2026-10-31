import { stateFrom } from './rules';
import { search, type SearchInfo } from './search';

export interface SearchRequest {
  id: number;
  state: { pawns: [number, number]; walls: [number, number]; h: number[]; v: number[]; turn: 0 | 1 };
  timeMs: number;
}

export interface SearchResponse {
  id: number;
  done: boolean;
  info: SearchInfo;
}

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<SearchRequest>) => void) | null;
  postMessage(message: SearchResponse): void;
};

ctx.onmessage = (e) => {
  const { id, state, timeMs } = e.data;
  const root = stateFrom(state);
  const info = search(root, {
    timeMs,
    onIteration: (it) => ctx.postMessage({ id, done: false, info: it }),
  });
  ctx.postMessage({ id, done: true, info });
};
