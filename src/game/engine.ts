import { GAME_CONFIG } from "./config";
import type {
  AttackAction,
  CoinSide,
  DefenderAction,
  Direction,
  TurnOutcome,
  TurnResult,
  VictoryCheck,
} from "./types";

// ==================== Turn Resolution ====================

/**
 * Resolves a turn where both players submitted their actions.
 * This is the core game logic — pure function, no side effects.
 */
export function resolveTurn(
  attackAction: AttackAction,
  defenderAction: DefenderAction
): TurnResult {
  const sameDirection =
    attackAction.direction === defenderAction.direction;

  if (defenderAction.type === "DODGE") {
    if (sameDirection) {
      // Dodge failed — defender chose the same direction as the attack
      return {
        outcome: "DODGE_FAIL",
        attackerDamage: 0,
        defenderDamage: GAME_CONFIG.ATTACK_DAMAGE,
      };
    }
    // Dodge succeeded — defender chose a different direction
    return {
      outcome: "DODGE_SUCCESS",
      attackerDamage: 0,
      defenderDamage: 0,
    };
  }

  // COUNTER
  if (sameDirection) {
    // Counter succeeded — defender matched the attack direction
    return {
      outcome: "COUNTER_SUCCESS",
      attackerDamage: GAME_CONFIG.COUNTER_DAMAGE,
      defenderDamage: 0,
    };
  }
  // Counter failed — defender guessed wrong
  return {
    outcome: "COUNTER_FAIL",
    attackerDamage: 0,
    defenderDamage: GAME_CONFIG.ATTACK_DAMAGE,
  };
}

// ==================== Timeout Resolution ====================

/**
 * Resolves a turn where at least one player did NOT submit an action before the deadline.
 *
 * - Only attacker timed out: no damage, turn wasted.
 * - Only defender timed out: no damage, turn wasted.
 * - Both timed out: both take PASSIVITY_DAMAGE.
 *
 * If both DID act, falls through to normal resolveTurn (should not happen in practice,
 * but handled defensively).
 */
export function resolveTimeout(
  attackerActed: boolean,
  defenderActed: boolean,
  attackAction: AttackAction | null,
  defenderAction: DefenderAction | null
): TurnResult {
  // Both acted — shouldn't reach here, but handle gracefully
  if (attackerActed && defenderActed && attackAction && defenderAction) {
    return resolveTurn(attackAction, defenderAction);
  }

  // Neither acted — passivity damage to both
  if (!attackerActed && !defenderActed) {
    return {
      outcome: "BOTH_TIMEOUT",
      attackerDamage: GAME_CONFIG.PASSIVITY_DAMAGE,
      defenderDamage: GAME_CONFIG.PASSIVITY_DAMAGE,
    };
  }

  // Only one acted — no damage, turn is wasted
  if (!attackerActed) {
    return {
      outcome: "ATTACKER_TIMEOUT",
      attackerDamage: 0,
      defenderDamage: 0,
    };
  }

  return {
    outcome: "DEFENDER_TIMEOUT",
    attackerDamage: 0,
    defenderDamage: 0,
  };
}

// ==================== Damage Application ====================

/**
 * Applies damage to a player's HP, clamping at 0.
 */
export function applyDamage(currentHp: number, damage: number): number {
  return Math.max(0, currentHp - damage);
}

// ==================== Victory Check ====================

/**
 * Checks whether the game is over based on current HP values.
 *
 * Returns:
 * - { gameOver: false } if both players are alive
 * - { gameOver: true, winner: "attacker" } if defender's HP <= 0
 * - { gameOver: true, winner: "defender" } if attacker's HP <= 0
 * - { gameOver: true, winner: null } if both are dead (simultaneous KO from passivity)
 */
export function checkVictory(
  attackerHp: number,
  defenderHp: number
): VictoryCheck {
  const attackerDead = attackerHp <= 0;
  const defenderDead = defenderHp <= 0;

  if (attackerDead && defenderDead) {
    return { gameOver: true, winner: null };
  }
  if (attackerDead) {
    return { gameOver: true, winner: "defender" };
  }
  if (defenderDead) {
    return { gameOver: true, winner: "attacker" };
  }
  return { gameOver: false };
}

// ==================== Coin Flip ====================

/**
 * Simulates a fair coin flip.
 * Accepts an optional random value for deterministic testing.
 */
export function flipCoin(randomValue?: number): CoinSide {
  const value = randomValue ?? Math.random();
  return value < 0.5 ? "HEADS" : "TAILS";
}

// ==================== Validation ====================

/**
 * Validates that a direction is one of the four allowed values.
 */
export function isValidDirection(direction: unknown): direction is Direction {
  return (
    typeof direction === "string" &&
    ["UP", "DOWN", "LEFT", "RIGHT"].includes(direction)
  );
}

/**
 * Validates an attacker action.
 */
export function isValidAttackAction(
  action: unknown
): action is AttackAction {
  if (typeof action !== "object" || action === null) return false;
  const a = action as Record<string, unknown>;
  return a.type === "ATTACK" && isValidDirection(a.direction);
}

/**
 * Validates a defender action.
 */
export function isValidDefenderAction(
  action: unknown
): action is DefenderAction {
  if (typeof action !== "object" || action === null) return false;
  const a = action as Record<string, unknown>;
  return (
    (a.type === "DODGE" || a.type === "COUNTER") &&
    isValidDirection(a.direction)
  );
}

/**
 * Validates a display name against the configured rules.
 */
export function isValidDisplayName(name: unknown): name is string {
  if (typeof name !== "string") return false;
  if (name.length < GAME_CONFIG.MIN_DISPLAY_NAME_LENGTH) return false;
  if (name.length > GAME_CONFIG.MAX_DISPLAY_NAME_LENGTH) return false;
  return GAME_CONFIG.DISPLAY_NAME_PATTERN.test(name);
}

// ==================== Leaderboard ====================

/**
 * Calculates leaderboard points awarded after a match.
 * Formula is configurable via GAME_CONFIG.LEADERBOARD.
 */
export function calculateLeaderboardPoints(result: {
  isWinner: boolean;
  currentStreak: number;
}): number {
  if (!result.isWinner) {
    return GAME_CONFIG.LEADERBOARD.LOSS_POINTS;
  }
  return (
    GAME_CONFIG.LEADERBOARD.BASE_WIN_POINTS +
    result.currentStreak * GAME_CONFIG.LEADERBOARD.STREAK_BONUS
  );
}
