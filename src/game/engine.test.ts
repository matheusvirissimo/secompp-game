import { describe, it, expect } from "vitest";
import {
  resolveTurn,
  resolveTimeout,
  applyDamage,
  checkVictory,
  flipCoin,
  isValidDirection,
  isValidAttackAction,
  isValidDefenderAction,
  isValidDisplayName,
  calculateLeaderboardPoints,
} from "./engine";
import { GAME_CONFIG } from "./config";
import type {
  AttackAction,
  DefenderAction,
  Direction,
  TurnOutcome,
} from "./types";
import { DIRECTIONS } from "./types";

// ==================== Helper Factories ====================

function attack(direction: Direction): AttackAction {
  return { type: "ATTACK", direction };
}

function dodge(direction: Direction): DefenderAction {
  return { type: "DODGE", direction };
}

function counter(direction: Direction): DefenderAction {
  return { type: "COUNTER", direction };
}

// ==================== resolveTurn ====================

describe("resolveTurn", () => {
  // ---------- ATTACK vs DODGE ----------

  describe("ATTACK vs DODGE", () => {
    describe("same direction → DODGE_FAIL (defender takes 1 damage)", () => {
      for (const dir of DIRECTIONS) {
        it(`ATTACK ${dir} vs DODGE ${dir}`, () => {
          const result = resolveTurn(attack(dir), dodge(dir));
          expect(result.outcome).toBe("DODGE_FAIL");
          expect(result.attackerDamage).toBe(0);
          expect(result.defenderDamage).toBe(GAME_CONFIG.ATTACK_DAMAGE);
        });
      }
    });

    describe("different direction → DODGE_SUCCESS (no damage)", () => {
      for (const atkDir of DIRECTIONS) {
        for (const defDir of DIRECTIONS) {
          if (atkDir === defDir) continue;
          it(`ATTACK ${atkDir} vs DODGE ${defDir}`, () => {
            const result = resolveTurn(attack(atkDir), dodge(defDir));
            expect(result.outcome).toBe("DODGE_SUCCESS");
            expect(result.attackerDamage).toBe(0);
            expect(result.defenderDamage).toBe(0);
          });
        }
      }
    });
  });

  // ---------- ATTACK vs COUNTER ----------

  describe("ATTACK vs COUNTER", () => {
    describe("same direction → COUNTER_SUCCESS (attacker takes 2 damage)", () => {
      for (const dir of DIRECTIONS) {
        it(`ATTACK ${dir} vs COUNTER ${dir}`, () => {
          const result = resolveTurn(attack(dir), counter(dir));
          expect(result.outcome).toBe("COUNTER_SUCCESS");
          expect(result.attackerDamage).toBe(GAME_CONFIG.COUNTER_DAMAGE);
          expect(result.defenderDamage).toBe(0);
        });
      }
    });

    describe("different direction → COUNTER_FAIL (defender takes 1 damage)", () => {
      for (const atkDir of DIRECTIONS) {
        for (const defDir of DIRECTIONS) {
          if (atkDir === defDir) continue;
          it(`ATTACK ${atkDir} vs COUNTER ${defDir}`, () => {
            const result = resolveTurn(attack(atkDir), counter(defDir));
            expect(result.outcome).toBe("COUNTER_FAIL");
            expect(result.attackerDamage).toBe(0);
            expect(result.defenderDamage).toBe(GAME_CONFIG.ATTACK_DAMAGE);
          });
        }
      }
    });
  });

  // ---------- Exhaustive: all 32 combinations ----------

  describe("exhaustive: all 32 combinations produce deterministic results", () => {
    const defenseTypes = ["DODGE", "COUNTER"] as const;

    for (const atkDir of DIRECTIONS) {
      for (const defType of defenseTypes) {
        for (const defDir of DIRECTIONS) {
          it(`ATTACK ${atkDir} vs ${defType} ${defDir}`, () => {
            const defAction: DefenderAction =
              defType === "DODGE" ? dodge(defDir) : counter(defDir);
            const result = resolveTurn(attack(atkDir), defAction);

            // Verify deterministic: calling again produces the same result
            const result2 = resolveTurn(attack(atkDir), defAction);
            expect(result).toEqual(result2);

            // Verify structure
            expect(result.attackerDamage).toBeGreaterThanOrEqual(0);
            expect(result.defenderDamage).toBeGreaterThanOrEqual(0);

            // Only one side should take damage (never both in normal play)
            expect(
              result.attackerDamage === 0 || result.defenderDamage === 0
            ).toBe(true);
          });
        }
      }
    }
  });

  // ---------- Damage values are correct ----------

  describe("damage values match config", () => {
    it("DODGE_FAIL deals exactly ATTACK_DAMAGE to defender", () => {
      const result = resolveTurn(attack("UP"), dodge("UP"));
      expect(result.defenderDamage).toBe(GAME_CONFIG.ATTACK_DAMAGE);
    });

    it("COUNTER_FAIL deals exactly ATTACK_DAMAGE to defender", () => {
      const result = resolveTurn(attack("UP"), counter("DOWN"));
      expect(result.defenderDamage).toBe(GAME_CONFIG.ATTACK_DAMAGE);
    });

    it("COUNTER_SUCCESS deals exactly COUNTER_DAMAGE to attacker", () => {
      const result = resolveTurn(attack("LEFT"), counter("LEFT"));
      expect(result.attackerDamage).toBe(GAME_CONFIG.COUNTER_DAMAGE);
    });

    it("DODGE_SUCCESS deals zero damage to both", () => {
      const result = resolveTurn(attack("UP"), dodge("DOWN"));
      expect(result.attackerDamage).toBe(0);
      expect(result.defenderDamage).toBe(0);
    });
  });
});

// ==================== resolveTimeout ====================

describe("resolveTimeout", () => {
  it("attacker timeout → no damage, ATTACKER_TIMEOUT", () => {
    const result = resolveTimeout(false, true, null, dodge("UP"));
    expect(result.outcome).toBe("ATTACKER_TIMEOUT");
    expect(result.attackerDamage).toBe(0);
    expect(result.defenderDamage).toBe(0);
  });

  it("defender timeout → no damage, DEFENDER_TIMEOUT", () => {
    const result = resolveTimeout(true, false, attack("UP"), null);
    expect(result.outcome).toBe("DEFENDER_TIMEOUT");
    expect(result.attackerDamage).toBe(0);
    expect(result.defenderDamage).toBe(0);
  });

  it("both timeout → passivity damage to both, BOTH_TIMEOUT", () => {
    const result = resolveTimeout(false, false, null, null);
    expect(result.outcome).toBe("BOTH_TIMEOUT");
    expect(result.attackerDamage).toBe(GAME_CONFIG.PASSIVITY_DAMAGE);
    expect(result.defenderDamage).toBe(GAME_CONFIG.PASSIVITY_DAMAGE);
  });

  it("both acted → falls through to normal resolution", () => {
    const result = resolveTimeout(
      true,
      true,
      attack("UP"),
      counter("UP")
    );
    expect(result.outcome).toBe("COUNTER_SUCCESS");
    expect(result.attackerDamage).toBe(GAME_CONFIG.COUNTER_DAMAGE);
  });

  it("attacker timeout with valid defender action → still no damage", () => {
    const result = resolveTimeout(false, true, null, counter("LEFT"));
    expect(result.outcome).toBe("ATTACKER_TIMEOUT");
    expect(result.attackerDamage).toBe(0);
    expect(result.defenderDamage).toBe(0);
  });
});

// ==================== applyDamage ====================

describe("applyDamage", () => {
  it("reduces HP by damage amount", () => {
    expect(applyDamage(3, 1)).toBe(2);
  });

  it("HP reaches exactly 0", () => {
    expect(applyDamage(1, 1)).toBe(0);
  });

  it("HP clamps to 0 when damage exceeds HP", () => {
    expect(applyDamage(1, 2)).toBe(0);
  });

  it("0 damage does not change HP", () => {
    expect(applyDamage(3, 0)).toBe(3);
  });

  it("HP already 0 stays at 0", () => {
    expect(applyDamage(0, 1)).toBe(0);
  });

  it("counter damage (2) applied to HP 3 leaves HP 1", () => {
    expect(applyDamage(3, GAME_CONFIG.COUNTER_DAMAGE)).toBe(1);
  });

  it("counter damage (2) applied to HP 2 leaves HP 0", () => {
    expect(applyDamage(2, GAME_CONFIG.COUNTER_DAMAGE)).toBe(0);
  });

  it("counter damage (2) applied to HP 1 clamps to 0", () => {
    expect(applyDamage(1, GAME_CONFIG.COUNTER_DAMAGE)).toBe(0);
  });
});

// ==================== checkVictory ====================

describe("checkVictory", () => {
  it("both alive → game not over", () => {
    const result = checkVictory(3, 3);
    expect(result.gameOver).toBe(false);
  });

  it("attacker at 1 HP, defender at 1 HP → game not over", () => {
    const result = checkVictory(1, 1);
    expect(result.gameOver).toBe(false);
  });

  it("attacker HP = 0 → defender wins", () => {
    const result = checkVictory(0, 3);
    expect(result.gameOver).toBe(true);
    if (result.gameOver) {
      expect(result.winner).toBe("defender");
    }
  });

  it("defender HP = 0 → attacker wins", () => {
    const result = checkVictory(3, 0);
    expect(result.gameOver).toBe(true);
    if (result.gameOver) {
      expect(result.winner).toBe("attacker");
    }
  });

  it("both HP = 0 → game over, no winner (null)", () => {
    const result = checkVictory(0, 0);
    expect(result.gameOver).toBe(true);
    if (result.gameOver) {
      expect(result.winner).toBeNull();
    }
  });

  it("attacker HP negative (clamped scenario) → defender wins", () => {
    const result = checkVictory(-1, 2);
    expect(result.gameOver).toBe(true);
    if (result.gameOver) {
      expect(result.winner).toBe("defender");
    }
  });

  it("defender HP negative (clamped scenario) → attacker wins", () => {
    const result = checkVictory(2, -1);
    expect(result.gameOver).toBe(true);
    if (result.gameOver) {
      expect(result.winner).toBe("attacker");
    }
  });
});

// ==================== flipCoin ====================

describe("flipCoin", () => {
  it("returns HEADS when random < 0.5", () => {
    expect(flipCoin(0)).toBe("HEADS");
    expect(flipCoin(0.1)).toBe("HEADS");
    expect(flipCoin(0.49)).toBe("HEADS");
  });

  it("returns TAILS when random >= 0.5", () => {
    expect(flipCoin(0.5)).toBe("TAILS");
    expect(flipCoin(0.7)).toBe("TAILS");
    expect(flipCoin(0.99)).toBe("TAILS");
  });

  it("returns a valid CoinSide without explicit random", () => {
    const result = flipCoin();
    expect(["HEADS", "TAILS"]).toContain(result);
  });
});

// ==================== Validation ====================

describe("isValidDirection", () => {
  it("accepts all valid directions", () => {
    expect(isValidDirection("UP")).toBe(true);
    expect(isValidDirection("DOWN")).toBe(true);
    expect(isValidDirection("LEFT")).toBe(true);
    expect(isValidDirection("RIGHT")).toBe(true);
  });

  it("rejects invalid directions", () => {
    expect(isValidDirection("DIAGONAL")).toBe(false);
    expect(isValidDirection("up")).toBe(false);
    expect(isValidDirection("")).toBe(false);
    expect(isValidDirection(null)).toBe(false);
    expect(isValidDirection(undefined)).toBe(false);
    expect(isValidDirection(42)).toBe(false);
  });
});

describe("isValidAttackAction", () => {
  it("accepts valid attack actions", () => {
    expect(isValidAttackAction({ type: "ATTACK", direction: "UP" })).toBe(true);
    expect(isValidAttackAction({ type: "ATTACK", direction: "LEFT" })).toBe(true);
  });

  it("rejects non-attack types", () => {
    expect(isValidAttackAction({ type: "DODGE", direction: "UP" })).toBe(false);
    expect(isValidAttackAction({ type: "COUNTER", direction: "UP" })).toBe(false);
  });

  it("rejects invalid structures", () => {
    expect(isValidAttackAction(null)).toBe(false);
    expect(isValidAttackAction(undefined)).toBe(false);
    expect(isValidAttackAction({})).toBe(false);
    expect(isValidAttackAction({ type: "ATTACK" })).toBe(false);
    expect(isValidAttackAction({ type: "ATTACK", direction: "INVALID" })).toBe(false);
    expect(isValidAttackAction("ATTACK UP")).toBe(false);
  });
});

describe("isValidDefenderAction", () => {
  it("accepts valid dodge actions", () => {
    expect(isValidDefenderAction({ type: "DODGE", direction: "DOWN" })).toBe(true);
  });

  it("accepts valid counter actions", () => {
    expect(isValidDefenderAction({ type: "COUNTER", direction: "RIGHT" })).toBe(true);
  });

  it("rejects attack actions", () => {
    expect(isValidDefenderAction({ type: "ATTACK", direction: "UP" })).toBe(false);
  });

  it("rejects invalid structures", () => {
    expect(isValidDefenderAction(null)).toBe(false);
    expect(isValidDefenderAction({ type: "DODGE" })).toBe(false);
    expect(isValidDefenderAction({ type: "COUNTER", direction: "INVALID" })).toBe(false);
  });
});

describe("isValidDisplayName", () => {
  it("accepts valid names", () => {
    expect(isValidDisplayName("Matheus")).toBe(true);
    expect(isValidDisplayName("Lucas 123")).toBe(true);
    expect(isValidDisplayName("José-Maria")).toBe(true);
    expect(isValidDisplayName("AB")).toBe(true); // min length
  });

  it("rejects names that are too short", () => {
    expect(isValidDisplayName("A")).toBe(false);
    expect(isValidDisplayName("")).toBe(false);
  });

  it("rejects names that are too long", () => {
    expect(isValidDisplayName("A".repeat(21))).toBe(false);
  });

  it("accepts names at max length", () => {
    expect(isValidDisplayName("A".repeat(20))).toBe(true);
  });

  it("rejects names with special characters", () => {
    expect(isValidDisplayName("test<script>")).toBe(false);
    expect(isValidDisplayName("user@hack")).toBe(false);
    expect(isValidDisplayName("name;DROP")).toBe(false);
    expect(isValidDisplayName("a\nb")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isValidDisplayName(null)).toBe(false);
    expect(isValidDisplayName(undefined)).toBe(false);
    expect(isValidDisplayName(123)).toBe(false);
  });

  it("accepts accented characters", () => {
    expect(isValidDisplayName("Café")).toBe(true);
    expect(isValidDisplayName("Ñoño")).toBe(true);
  });
});

// ==================== Leaderboard ====================

describe("calculateLeaderboardPoints", () => {
  it("winner with no streak gets BASE_WIN_POINTS", () => {
    const points = calculateLeaderboardPoints({
      isWinner: true,
      currentStreak: 0,
    });
    expect(points).toBe(GAME_CONFIG.LEADERBOARD.BASE_WIN_POINTS);
  });

  it("winner with streak gets bonus per streak win", () => {
    const points = calculateLeaderboardPoints({
      isWinner: true,
      currentStreak: 3,
    });
    expect(points).toBe(
      GAME_CONFIG.LEADERBOARD.BASE_WIN_POINTS +
        3 * GAME_CONFIG.LEADERBOARD.STREAK_BONUS
    );
  });

  it("loser gets LOSS_POINTS (0)", () => {
    const points = calculateLeaderboardPoints({
      isWinner: false,
      currentStreak: 0,
    });
    expect(points).toBe(GAME_CONFIG.LEADERBOARD.LOSS_POINTS);
  });

  it("loser with previous streak still gets 0", () => {
    const points = calculateLeaderboardPoints({
      isWinner: false,
      currentStreak: 5,
    });
    expect(points).toBe(GAME_CONFIG.LEADERBOARD.LOSS_POINTS);
  });
});

// ==================== Full Match Simulation ====================

describe("full match simulation", () => {
  it("simulates a complete match ending in attacker victory", () => {
    let attackerHp = GAME_CONFIG.INITIAL_HP; // 3
    let defenderHp = GAME_CONFIG.INITIAL_HP; // 3

    // Turn 1: Attack UP, Dodge UP → DODGE_FAIL, defender -1 HP
    let result = resolveTurn(attack("UP"), dodge("UP"));
    expect(result.outcome).toBe("DODGE_FAIL");
    defenderHp = applyDamage(defenderHp, result.defenderDamage);
    expect(defenderHp).toBe(2);
    expect(checkVictory(attackerHp, defenderHp).gameOver).toBe(false);

    // Turn 2: Attack LEFT, Counter RIGHT → COUNTER_FAIL, defender -1 HP
    result = resolveTurn(attack("LEFT"), counter("RIGHT"));
    expect(result.outcome).toBe("COUNTER_FAIL");
    defenderHp = applyDamage(defenderHp, result.defenderDamage);
    expect(defenderHp).toBe(1);
    expect(checkVictory(attackerHp, defenderHp).gameOver).toBe(false);

    // Turn 3: Attack DOWN, Dodge UP → DODGE_FAIL, defender -1 HP
    result = resolveTurn(attack("DOWN"), dodge("DOWN"));
    expect(result.outcome).toBe("DODGE_FAIL");
    defenderHp = applyDamage(defenderHp, result.defenderDamage);
    expect(defenderHp).toBe(0);

    const victory = checkVictory(attackerHp, defenderHp);
    expect(victory.gameOver).toBe(true);
    if (victory.gameOver) {
      expect(victory.winner).toBe("attacker");
    }
  });

  it("simulates a match where counter wins for defender", () => {
    let attackerHp = GAME_CONFIG.INITIAL_HP; // 3
    let defenderHp = GAME_CONFIG.INITIAL_HP; // 3

    // Turn 1: Attack UP, Counter UP → COUNTER_SUCCESS, attacker -2 HP
    let result = resolveTurn(attack("UP"), counter("UP"));
    expect(result.outcome).toBe("COUNTER_SUCCESS");
    attackerHp = applyDamage(attackerHp, result.attackerDamage);
    expect(attackerHp).toBe(1);
    expect(checkVictory(attackerHp, defenderHp).gameOver).toBe(false);

    // Turn 2: Attack RIGHT, Counter RIGHT → COUNTER_SUCCESS, attacker -2 HP → 0
    result = resolveTurn(attack("RIGHT"), counter("RIGHT"));
    expect(result.outcome).toBe("COUNTER_SUCCESS");
    attackerHp = applyDamage(attackerHp, result.attackerDamage);
    expect(attackerHp).toBe(0);

    const victory = checkVictory(attackerHp, defenderHp);
    expect(victory.gameOver).toBe(true);
    if (victory.gameOver) {
      expect(victory.winner).toBe("defender");
    }
  });

  it("simulates a match with mixed actions and timeouts", () => {
    let attackerHp = GAME_CONFIG.INITIAL_HP; // 3
    let defenderHp = GAME_CONFIG.INITIAL_HP; // 3

    // Turn 1: Attacker timeout → no damage
    let result = resolveTimeout(false, true, null, dodge("UP"));
    expect(result.outcome).toBe("ATTACKER_TIMEOUT");
    attackerHp = applyDamage(attackerHp, result.attackerDamage);
    defenderHp = applyDamage(defenderHp, result.defenderDamage);
    expect(attackerHp).toBe(3);
    expect(defenderHp).toBe(3);

    // Turn 2: Normal play, dodge succeeds
    result = resolveTurn(attack("UP"), dodge("LEFT"));
    expect(result.outcome).toBe("DODGE_SUCCESS");
    attackerHp = applyDamage(attackerHp, result.attackerDamage);
    defenderHp = applyDamage(defenderHp, result.defenderDamage);
    expect(attackerHp).toBe(3);
    expect(defenderHp).toBe(3);

    // Turn 3: Both timeout → passivity damage
    result = resolveTimeout(false, false, null, null);
    expect(result.outcome).toBe("BOTH_TIMEOUT");
    attackerHp = applyDamage(attackerHp, result.attackerDamage);
    defenderHp = applyDamage(defenderHp, result.defenderDamage);
    expect(attackerHp).toBe(2);
    expect(defenderHp).toBe(2);

    // Turn 4: Counter succeeds → attacker takes 2
    result = resolveTurn(attack("DOWN"), counter("DOWN"));
    expect(result.outcome).toBe("COUNTER_SUCCESS");
    attackerHp = applyDamage(attackerHp, result.attackerDamage);
    defenderHp = applyDamage(defenderHp, result.defenderDamage);
    expect(attackerHp).toBe(0);
    expect(defenderHp).toBe(2);

    const victory = checkVictory(attackerHp, defenderHp);
    expect(victory.gameOver).toBe(true);
    if (victory.gameOver) {
      expect(victory.winner).toBe("defender");
    }
  });

  it("simulates simultaneous KO from passivity damage", () => {
    let attackerHp = 1;
    let defenderHp = 1;

    const result = resolveTimeout(false, false, null, null);
    expect(result.outcome).toBe("BOTH_TIMEOUT");
    attackerHp = applyDamage(attackerHp, result.attackerDamage);
    defenderHp = applyDamage(defenderHp, result.defenderDamage);
    expect(attackerHp).toBe(0);
    expect(defenderHp).toBe(0);

    const victory = checkVictory(attackerHp, defenderHp);
    expect(victory.gameOver).toBe(true);
    if (victory.gameOver) {
      expect(victory.winner).toBeNull();
    }
  });
});

// ==================== Edge Cases ====================

describe("edge cases", () => {
  it("action on already finished match (HP=0) still resolves but victory check catches it", () => {
    // This tests that checkVictory correctly identifies game-over states
    // In the real match server, actions after FINISHED would be rejected
    const victory = checkVictory(0, 3);
    expect(victory.gameOver).toBe(true);
  });

  it("resolveTurn is idempotent — same inputs always produce same output", () => {
    for (const atkDir of DIRECTIONS) {
      for (const defDir of DIRECTIONS) {
        const r1 = resolveTurn(attack(atkDir), dodge(defDir));
        const r2 = resolveTurn(attack(atkDir), dodge(defDir));
        expect(r1).toEqual(r2);

        const r3 = resolveTurn(attack(atkDir), counter(defDir));
        const r4 = resolveTurn(attack(atkDir), counter(defDir));
        expect(r3).toEqual(r4);
      }
    }
  });

  it("no combination produces damage to both players (except BOTH_TIMEOUT)", () => {
    for (const atkDir of DIRECTIONS) {
      for (const defDir of DIRECTIONS) {
        const dodgeResult = resolveTurn(attack(atkDir), dodge(defDir));
        expect(
          dodgeResult.attackerDamage === 0 || dodgeResult.defenderDamage === 0
        ).toBe(true);

        const counterResult = resolveTurn(attack(atkDir), counter(defDir));
        expect(
          counterResult.attackerDamage === 0 ||
            counterResult.defenderDamage === 0
        ).toBe(true);
      }
    }
  });
});
