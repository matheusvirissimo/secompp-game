-- Jogadores registrados
CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    session_token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_players_session ON players(session_token);

-- Partidas finalizadas
CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    player_a_id TEXT NOT NULL,
    player_b_id TEXT NOT NULL,
    winner_id TEXT,
    loser_id TEXT,
    player_a_hp_final INTEGER NOT NULL DEFAULT 0,
    player_b_hp_final INTEGER NOT NULL DEFAULT 0,
    total_turns INTEGER NOT NULL DEFAULT 0,
    match_type TEXT NOT NULL DEFAULT 'public',
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (player_a_id) REFERENCES players(id),
    FOREIGN KEY (player_b_id) REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_matches_winner ON matches(winner_id);
CREATE INDEX IF NOT EXISTS idx_matches_finished ON matches(finished_at);

-- Leaderboard materializado
CREATE TABLE IF NOT EXISTS leaderboard (
    player_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    total_matches INTEGER NOT NULL DEFAULT 0,
    current_streak INTEGER NOT NULL DEFAULT 0,
    best_streak INTEGER NOT NULL DEFAULT 0,
    points INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_points ON leaderboard(points DESC);

-- Turnos (Histórico para análise de dados)
CREATE TABLE IF NOT EXISTS turns (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL,
    turn_number INTEGER NOT NULL,
    attacker_id TEXT NOT NULL,
    defender_id TEXT NOT NULL,
    attack_direction TEXT,
    defense_type TEXT,
    defense_direction TEXT,
    result TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (match_id) REFERENCES matches(id)
);
