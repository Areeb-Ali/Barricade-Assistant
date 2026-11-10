import { useRef, useState } from 'react';
import type { Book } from '../engine/book';
import { makeBackup, mergeBackup, type GameRecord } from '../history';
import type { StudyStatus } from '../hooks/useStudy';

interface GamesPanelProps {
  history: GameRecord[];
  book: Book;
  study: StudyStatus | null;
  onImport: (next: { history: GameRecord[]; book: Book }) => void;
}

const RESULT_LABEL = { win: 'Win', loss: 'Loss', resigned: 'Unfinished / left' } as const;
const SHOWN = 8;

function when(ts: number) {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function GamesPanel({ history, book, study, onImport }: GamesPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const wins = history.filter((r) => r.result !== 'loss').length;
  const losses = history.length - wins;
  const lessons = Object.keys(book).length;
  const shown = showAll ? history : history.slice(0, SHOWN);

  function exportData() {
    const blob = new Blob([JSON.stringify(makeBackup(history, book), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `barricade-assistant-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importData(file: File) {
    try {
      const merged = mergeBackup(history, book, JSON.parse(await file.text()));
      onImport(merged);
      setMessage(`Imported ${merged.games} game${merged.games === 1 ? '' : 's'} and ${merged.lessons} lesson${merged.lessons === 1 ? '' : 's'}.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not read that file.');
    }
  }

  return (
    <section className="panel games">
      <h2>Your games</h2>
      <div className="stats">
        <div>
          <strong>{wins}</strong>
          <span className="muted">wins</span>
        </div>
        <div>
          <strong>{losses}</strong>
          <span className="muted">losses</span>
        </div>
        <div>
          <strong>{lessons}</strong>
          <span className="muted">lessons</span>
        </div>
      </div>

      {study && (
        <div className="studying">
          <span className="spinner" aria-hidden="true" />
          <span>
            Studying a lost game… {study.total ? `${study.done}/${study.total} positions` : 'starting'}
          </span>
        </div>
      )}

      {history.length === 0 ? (
        <p className="muted small">
          Finished games are saved here. Lost games are studied automatically, and the better moves found are
          played next time the same position comes up.
        </p>
      ) : (
        <ul className="game-list">
          {shown.map((r) => (
            <li key={r.id}>
              <span className={`result ${r.result}`}>{RESULT_LABEL[r.result]}</span>
              <span className="muted">{when(r.endedAt)}</span>
              <span className="muted">{r.moves.length} moves</span>
              {r.result === 'loss' && (
                <span className="lesson-count">
                  {r.studied ? `${r.lessons ?? 0} lesson${r.lessons === 1 ? '' : 's'}` : study?.gameId === r.id ? 'studying' : 'queued'}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {history.length > SHOWN && (
        <button className="ghost link" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all ${history.length}`}
        </button>
      )}

      <div className="backup">
        <button onClick={exportData} disabled={history.length === 0 && lessons === 0}>
          Export backup
        </button>
        <button onClick={() => fileRef.current?.click()}>Import backup</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importData(file);
            e.target.value = '';
          }}
        />
      </div>
      {message && <p className="muted small">{message}</p>}
      <p className="muted small">Saved in this browser only. Use export/import to move it to another device.</p>
    </section>
  );
}
