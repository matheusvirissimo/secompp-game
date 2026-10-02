import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getLeaderboard } from "../services/api";

interface LeaderboardEntry {
  player_id: string;
  display_name: string;
  wins: number;
  losses: number;
  total_matches: number;
  current_streak: number;
  best_streak: number;
  points: number;
}

export function Leaderboard() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getLeaderboard()
      .then((data) => {
        setEntries(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  return (
    <div className="page">
      <h1 className="home-title">Ranking Top 10</h1>

      {loading ? (
        <div className="waiting-spinner" />
      ) : (
        <div className="leaderboard-container" style={{ width: '100%', maxWidth: '600px', marginTop: '1rem' }}>
          {entries.length === 0 ? (
            <p className="status-text">Nenhuma partida registrada ainda.</p>
          ) : (
            <table className="leaderboard-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', background: 'var(--bg-light)', borderRadius: '8px', overflow: 'hidden' }}>
              <thead>
                <tr style={{ background: 'var(--primary)', color: 'white' }}>
                  <th style={{ padding: '0.75rem' }}>#</th>
                  <th style={{ padding: '0.75rem' }}>Jogador</th>
                  <th style={{ padding: '0.75rem' }}>Pontos</th>
                  <th style={{ padding: '0.75rem' }}>V/D</th>
                  <th style={{ padding: '0.75rem' }}>🔥 Streak</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => (
                  <tr key={entry.player_id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.75rem', fontWeight: 'bold' }}>{index + 1}</td>
                    <td style={{ padding: '0.75rem' }}>{entry.display_name}</td>
                    <td style={{ padding: '0.75rem', fontWeight: 'bold', color: 'var(--primary)' }}>{entry.points}</td>
                    <td style={{ padding: '0.75rem' }}>{entry.wins}/{entry.losses}</td>
                    <td style={{ padding: '0.75rem' }}>{entry.best_streak > 0 ? entry.best_streak : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <button 
        className="btn btn-secondary" 
        onClick={() => navigate("/")}
        style={{ marginTop: "2rem" }}
      >
        Voltar ao Início
      </button>
    </div>
  );
}
