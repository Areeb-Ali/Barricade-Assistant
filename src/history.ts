import type { Book } from './engine/book';
import type { Move, Player } from './engine/rules';

/**
 * Finished games and learned lessons, kept in the browser's local storage
 * (per device). They can be moved between devices with export/import.
 */

/** `resigned` means the game was left unfinished, counted as the opponent resigning. */
export type Result = 'win' | 'loss' | 'resigned';

export interface GameRecord {
  id: string;
  startedAt: number;
  endedAt: number;
  first: Player;
  color?: 'red' | 'blue';
  moves: Move[];
  result: Result;
  /** Set once a lost game has been studied. */
  studied?: boolean;
  /** Lessons learned from this game. */
  lessons?: number;
}

export interface Backup {
  app: 'barricade-assistant';
  version: 1;
  exportedAt: number;
  history: GameRecord[];
  book: Book;
}

const MAX_GAMES = 300;

export const newGameId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Inserts or replaces a record (matched by id), newest first. */
export function upsertRecord(history: GameRecord[], record: GameRecord): GameRecord[] {
  const rest = history.filter((r) => r.id !== record.id);
  return [record, ...rest].sort((a, b) => b.endedAt - a.endedAt).slice(0, MAX_GAMES);
}

export function makeBackup(history: GameRecord[], book: Book): Backup {
  return { app: 'barricade-assistant', version: 1, exportedAt: Date.now(), history, book };
}

/** Merges a backup into the current data. Existing games win; lessons keep the larger gain. */
export function mergeBackup(
  history: GameRecord[],
  book: Book,
  backup: unknown,
): { history: GameRecord[]; book: Book; games: number; lessons: number } {
  const data = backup as Partial<Backup> | null;
  if (!data || data.app !== 'barricade-assistant' || !Array.isArray(data.history) || typeof data.book !== 'object') {
    throw new Error('This file is not a Barricade Assistant backup.');
  }
  const known = new Set(history.map((r) => r.id));
  let merged = history;
  let games = 0;
  for (const r of data.history) {
    if (r && typeof r.id === 'string' && Array.isArray(r.moves) && !known.has(r.id)) {
      merged = upsertRecord(merged, r);
      games++;
    }
  }
  const nextBook: Book = { ...book };
  let lessons = 0;
  for (const [key, lesson] of Object.entries(data.book ?? {})) {
    if (!lesson || typeof lesson.move !== 'number') continue;
    if (!nextBook[key] || nextBook[key].gain < lesson.gain) {
      nextBook[key] = lesson;
      lessons++;
    }
  }
  return { history: merged, book: nextBook, games, lessons };
}
