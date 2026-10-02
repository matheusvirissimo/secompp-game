/**
 * Centralized game configuration.
 * All game constants are defined here to avoid magic numbers throughout the codebase.
 * These values can be adjusted without modifying game logic.
 */
export const GAME_CONFIG = {
  /** Starting health points for each player */
  INITIAL_HP: 3,

  /** Damage dealt by a successful attack (dodge fail or counter fail) */
  ATTACK_DAMAGE: 1,

  /** Damage dealt to attacker by a successful counter */
  COUNTER_DAMAGE: 2,

  /** Damage dealt to both players when neither acts (passivity penalty) */
  PASSIVITY_DAMAGE: 1,

  /** Duration of each turn in milliseconds */
  TURN_DURATION_MS: 20_000,

  /** Time remaining (ms) when the "time running out" warning appears */
  TURN_WARNING_MS: 5_000,

  /** Time allowed for a disconnected player to reconnect (ms) */
  RECONNECT_TIMEOUT_MS: 45_000,

  /** Number of consecutive turns with no action from EITHER player before match is aborted */
  MAX_CONSECUTIVE_INACTIVE_TURNS: 3,

  /** Maximum length of display name */
  MAX_DISPLAY_NAME_LENGTH: 20,

  /** Minimum length of display name */
  MIN_DISPLAY_NAME_LENGTH: 2,

  /** Allowed characters in display name */
  DISPLAY_NAME_PATTERN: /^[a-zA-Z0-9\u00C0-\u00FF _-]+$/,

  /** Duration of the ready countdown before the match starts (ms) */
  READY_COUNTDOWN_MS: 3_000,

  /** Leaderboard scoring configuration */
  LEADERBOARD: {
    /** Points awarded for a win */
    BASE_WIN_POINTS: 3,
    /** Additional points per consecutive win in the current streak */
    STREAK_BONUS: 1,
    /** Points awarded for a loss */
    LOSS_POINTS: 0,
  },
} as const;
