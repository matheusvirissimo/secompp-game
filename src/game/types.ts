// ==================== Directions ====================

export const DIRECTIONS = ["UP", "DOWN", "LEFT", "RIGHT"] as const;
export type Direction = (typeof DIRECTIONS)[number];

// ==================== Actions ====================

export type AttackAction = {
  readonly type: "ATTACK";
  readonly direction: Direction;
};

export type DodgeAction = {
  readonly type: "DODGE";
  readonly direction: Direction;
};

export type CounterAction = {
  readonly type: "COUNTER";
  readonly direction: Direction;
};

export type DefenderAction = DodgeAction | CounterAction;

// ==================== Turn Outcomes ====================

export type TurnOutcome =
  | "DODGE_SUCCESS" // Defender dodged successfully (different direction from attack)
  | "DODGE_FAIL" // Defender failed to dodge (same direction) → defender takes ATTACK_DAMAGE
  | "COUNTER_SUCCESS" // Defender countered successfully (same direction) → attacker takes COUNTER_DAMAGE
  | "COUNTER_FAIL" // Defender failed to counter (different direction) → defender takes ATTACK_DAMAGE
  | "ATTACKER_TIMEOUT" // Attacker didn't act in time → no damage, turn wasted
  | "DEFENDER_TIMEOUT" // Defender didn't act in time → no damage, turn wasted
  | "BOTH_TIMEOUT"; // Neither acted → both take PASSIVITY_DAMAGE

export type TurnResult = {
  readonly outcome: TurnOutcome;
  readonly attackerDamage: number;
  readonly defenderDamage: number;
};

// ==================== Victory ====================

export type VictoryCheck =
  | { readonly gameOver: false }
  | { readonly gameOver: true; readonly winner: "attacker" | "defender" | null };
// winner is null when both players die simultaneously (e.g., both at 1 HP + passivity damage)

// ==================== Coin Flip ====================

export const COIN_SIDES = ["HEADS", "TAILS"] as const;
export type CoinSide = (typeof COIN_SIDES)[number];

export type CoinFlipResult = {
  readonly result: CoinSide;
};

// ==================== Match State ====================

export type MatchPhase =
  | "WAITING" // Match created, waiting for second player
  | "READY" // Both connected, brief countdown
  | "COIN_FLIP" // Players choosing coin sides, deciding who attacks first
  | "PLAYING" // Turn active, awaiting actions
  | "RESOLVING" // Processing turn result (transient)
  | "WAITING_RECONNECT" // Player disconnected, waiting for reconnection
  | "FINISHED"; // Match over, result persisted

// ==================== Player State ====================

export type PlayerState = {
  readonly playerId: string;
  readonly displayName: string;
  hp: number;
};

// ==================== Match Finish Reason ====================

export type MatchFinishReason =
  | "HP_ZERO" // A player's HP reached 0
  | "FORFEIT" // A player forfeited
  | "DISCONNECT_TIMEOUT" // A player didn't reconnect in time
  | "INACTIVITY"; // Too many consecutive inactive turns
