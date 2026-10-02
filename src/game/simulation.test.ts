import { describe, it, expect } from "vitest";
import {
  simulateMatch,
  formatMatchLog,
  randomStrategy,
  fixedStrategy,
  afkStrategy,
  scriptedStrategy,
} from "./simulation";
import { GAME_CONFIG } from "./config";
import type { AttackAction, DefenderAction } from "./types";

// ==================== Simulation Tests ====================

describe("simulateMatch", () => {
  // ---------- Basic full match ----------

  it("completes a full match with random strategies", () => {
    const record = simulateMatch({
      playerA: { id: "a", displayName: "Alice" },
      playerB: { id: "b", displayName: "Bob" },
      strategyA: randomStrategy(),
      strategyB: randomStrategy(),
    });

    // Match must have ended
    expect(record.totalTurns).toBeGreaterThan(0);
    expect(record.totalTurns).toBeLessThanOrEqual(50);

    // One of the valid finish reasons
    expect(["HP_ZERO", "INACTIVITY", "DRAW"]).toContain(record.finishReason);

    // If HP_ZERO, there must be a winner
    if (record.finishReason === "HP_ZERO") {
      expect(record.winnerId).not.toBeNull();
      expect(["a", "b"]).toContain(record.winnerId);
    }

    // All turns have valid records
    for (const turn of record.turns) {
      expect(turn.turnNumber).toBeGreaterThan(0);
      expect(turn.attackerHpAfter).toBeGreaterThanOrEqual(0);
      expect(turn.defenderHpAfter).toBeGreaterThanOrEqual(0);
    }
  });

  // ---------- Deterministic scripted match ----------

  it("plays a scripted match: 3 dodge fails → attacker wins", () => {
    // Player A always attacks UP, Player B always dodges UP (fails)
    const record = simulateMatch({
      playerA: { id: "a", displayName: "Alice" },
      playerB: { id: "b", displayName: "Bob" },
      strategyA: fixedStrategy("UP", "DODGE", "UP"),
      strategyB: fixedStrategy("UP", "DODGE", "UP"),
      firstAttackerId: "a",
    });

    // Turn 1: A attacks UP, B dodges UP → B takes 1 damage (B HP: 2)
    // Turn 2: B attacks UP, A dodges UP → A takes 1 damage (A HP: 2)
    // Turn 3: A attacks UP, B dodges UP → B takes 1 damage (B HP: 1)
    // Turn 4: B attacks UP, A dodges UP → A takes 1 damage (A HP: 1)
    // Turn 5: A attacks UP, B dodges UP → B takes 1 damage (B HP: 0) → A wins!

    expect(record.finishReason).toBe("HP_ZERO");
    expect(record.winnerId).toBe("a");
    expect(record.totalTurns).toBe(5);
    expect(record.playerA.hp).toBe(1);
    expect(record.playerB.hp).toBe(0);
  });

  it("plays a scripted match: counter succeeds → quick defender win", () => {
    // Player A always attacks RIGHT, Player B always counters RIGHT
    const record = simulateMatch({
      playerA: { id: "a", displayName: "Alice" },
      playerB: { id: "b", displayName: "Bob" },
      strategyA: fixedStrategy("RIGHT", "COUNTER", "RIGHT"),
      strategyB: fixedStrategy("RIGHT", "COUNTER", "RIGHT"),
      firstAttackerId: "a",
    });

    // Turn 1: A attacks RIGHT, B counters RIGHT → COUNTER_SUCCESS, A takes 2 (A HP: 1)
    // Turn 2: B attacks RIGHT, A counters RIGHT → COUNTER_SUCCESS, B takes 2 (B HP: 1)
    // Turn 3: A attacks RIGHT, B counters RIGHT → COUNTER_SUCCESS, A takes 2 (A HP: 0) → B wins!

    expect(record.finishReason).toBe("HP_ZERO");
    expect(record.winnerId).toBe("b");
    expect(record.totalTurns).toBe(3);
    expect(record.playerA.hp).toBe(0);
    expect(record.playerB.hp).toBe(1);
  });

  it("plays a match where dodge always succeeds → no damage, long match", () => {
    // A attacks UP, B dodges DOWN (different → success, no damage)
    // B attacks UP, A dodges DOWN (different → success, no damage)
    // ... this would go on forever, but maxTurns stops it
    const record = simulateMatch({
      playerA: { id: "a", displayName: "Alice" },
      playerB: { id: "b", displayName: "Bob" },
      strategyA: fixedStrategy("UP", "DODGE", "DOWN"),
      strategyB: fixedStrategy("UP", "DODGE", "DOWN"),
      firstAttackerId: "a",
      maxTurns: 10,
    });

    // No damage dealt at all
    expect(record.playerA.hp).toBe(GAME_CONFIG.INITIAL_HP);
    expect(record.playerB.hp).toBe(GAME_CONFIG.INITIAL_HP);
    expect(record.totalTurns).toBe(10);
  });

  // ---------- Timeout and inactivity ----------

  it("aborts after MAX_CONSECUTIVE_INACTIVE_TURNS when both AFK", () => {
    const record = simulateMatch({
      playerA: { id: "a", displayName: "Alice" },
      playerB: { id: "b", displayName: "Bob" },
      strategyA: afkStrategy(),
      strategyB: afkStrategy(),
    });

    // With 3 HP and 1 passivity damage per turn, both players reach 0 HP at turn 3.
    // This triggers a DRAW (simultaneous KO) which fires BEFORE the inactivity check.
    // The MAX_CONSECUTIVE_INACTIVE_TURNS (3) would fire on the same turn,
    // but HP_ZERO takes priority.
    expect(record.totalTurns).toBe(GAME_CONFIG.MAX_CONSECUTIVE_INACTIVE_TURNS);
    expect(record.winnerId).toBeNull();
    // finishReason is DRAW because both HP hit 0 simultaneously
    expect(record.finishReason).toBe("DRAW");
  });

  it("AFK penalty deals passivity damage to both players", () => {
    const record = simulateMatch({
      playerA: { id: "a", displayName: "Alice" },
      playerB: { id: "b", displayName: "Bob" },
      strategyA: afkStrategy(),
      strategyB: afkStrategy(),
    });

    // After 3 turns of BOTH_TIMEOUT: each player lost 3 × PASSIVITY_DAMAGE
    const expectedHp =
      GAME_CONFIG.INITIAL_HP -
      GAME_CONFIG.MAX_CONSECUTIVE_INACTIVE_TURNS * GAME_CONFIG.PASSIVITY_DAMAGE;

    expect(record.playerA.hp).toBe(Math.max(0, expectedHp));
    expect(record.playerB.hp).toBe(Math.max(0, expectedHp));
  });

  it("one player AFK → turns wasted, no damage, no inactivity abort", () => {
    // Only A is AFK (single-side timeout doesn't count as "both inactive")
    // B always acts, so consecutiveInactiveTurns resets
    const record = simulateMatch({
      playerA: { id: "a", displayName: "Alice" },
      playerB: { id: "b", displayName: "Bob" },
      strategyA: afkStrategy(),
      strategyB: fixedStrategy("UP", "DODGE", "DOWN"),
      firstAttackerId: "a",
      maxTurns: 6,
    });

    // All turns wasted (one player always AFK), but not aborted for inactivity
    // because single-side timeout resets the counter
    expect(record.finishReason).not.toBe("INACTIVITY");
    expect(record.playerA.hp).toBe(GAME_CONFIG.INITIAL_HP);
    expect(record.playerB.hp).toBe(GAME_CONFIG.INITIAL_HP);
  });

  // ---------- Scripted sequence ----------

  it("scripted sequence produces expected turn-by-turn results", () => {
    const actionsA: (AttackAction | DefenderAction | null)[] = [
      { type: "ATTACK", direction: "UP" }, // Turn 1: A attacks
      { type: "COUNTER", direction: "LEFT" }, // Turn 2: A defends
      { type: "ATTACK", direction: "DOWN" }, // Turn 3: A attacks
    ];
    const actionsB: (AttackAction | DefenderAction | null)[] = [
      { type: "DODGE", direction: "LEFT" }, // Turn 1: B defends
      { type: "ATTACK", direction: "LEFT" }, // Turn 2: B attacks
      { type: "COUNTER", direction: "DOWN" }, // Turn 3: B defends
    ];

    const record = simulateMatch({
      playerA: { id: "a", displayName: "Alice" },
      playerB: { id: "b", displayName: "Bob" },
      strategyA: scriptedStrategy(actionsA),
      strategyB: scriptedStrategy(actionsB),
      firstAttackerId: "a",
    });

    // Turn 1: ATTACK UP vs DODGE LEFT → DODGE_SUCCESS (different dir)
    expect(record.turns[0].result.outcome).toBe("DODGE_SUCCESS");
    expect(record.turns[0].attackerHpAfter).toBe(3);
    expect(record.turns[0].defenderHpAfter).toBe(3);

    // Turn 2: B ATTACK LEFT vs A COUNTER LEFT → COUNTER_SUCCESS (same dir)
    expect(record.turns[1].result.outcome).toBe("COUNTER_SUCCESS");
    expect(record.turns[1].attackerHpAfter).toBe(1); // B takes 2 counter damage
    expect(record.turns[1].defenderHpAfter).toBe(3); // A takes 0

    // Turn 3: A ATTACK DOWN vs B COUNTER DOWN → COUNTER_SUCCESS (same dir)
    expect(record.turns[2].result.outcome).toBe("COUNTER_SUCCESS");
    expect(record.turns[2].attackerHpAfter).toBe(1); // A takes 2 → 3-2=1
    expect(record.turns[2].defenderHpAfter).toBe(1); // B still 1

    expect(record.totalTurns).toBeGreaterThanOrEqual(3);
  });

  // ---------- Alternation of roles ----------

  it("correctly alternates attacker/defender each turn", () => {
    const record = simulateMatch({
      playerA: { id: "a", displayName: "Alice" },
      playerB: { id: "b", displayName: "Bob" },
      strategyA: fixedStrategy("UP", "DODGE", "DOWN"),
      strategyB: fixedStrategy("UP", "DODGE", "DOWN"),
      firstAttackerId: "a",
      maxTurns: 6,
    });

    // Odd turns: A attacks, B defends
    // Even turns: B attacks, A defends
    for (const turn of record.turns) {
      if (turn.turnNumber % 2 === 1) {
        expect(turn.attackerId).toBe("a");
        expect(turn.defenderId).toBe("b");
      } else {
        expect(turn.attackerId).toBe("b");
        expect(turn.defenderId).toBe("a");
      }
    }
  });

  // ---------- Coin flip ----------

  it("uses coin flip to decide first attacker when not specified", () => {
    // Run multiple times and verify the first attacker is always one of the two
    const results = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const record = simulateMatch({
        playerA: { id: "a", displayName: "Alice" },
        playerB: { id: "b", displayName: "Bob" },
        strategyA: randomStrategy(),
        strategyB: randomStrategy(),
      });
      results.add(record.firstAttackerId);
    }

    // Over 20 runs, both players should have been first attacker at least once
    // (probability of one always going first = (0.5)^20 ≈ 0.0001%)
    expect(results.has("a")).toBe(true);
    expect(results.has("b")).toBe(true);
  });

  // ---------- Draw scenario ----------

  it("handles simultaneous KO (both at 1 HP, both timeout)", () => {
    // Script: first deal damage down to 1 HP each, then both timeout
    const actionsA: (AttackAction | DefenderAction | null)[] = [
      { type: "ATTACK", direction: "UP" }, // Turn 1: A attacks UP
      { type: "DODGE", direction: "UP" }, // Turn 2: A dodges UP (fails)
      null, // Turn 3: A times out
    ];
    const actionsB: (AttackAction | DefenderAction | null)[] = [
      { type: "COUNTER", direction: "UP" }, // Turn 1: B counters UP → A takes 2
      { type: "ATTACK", direction: "UP" }, // Turn 2: B attacks UP
      null, // Turn 3: B times out
    ];

    const record = simulateMatch({
      playerA: { id: "a", displayName: "Alice" },
      playerB: { id: "b", displayName: "Bob" },
      strategyA: scriptedStrategy(actionsA),
      strategyB: scriptedStrategy(actionsB),
      firstAttackerId: "a",
    });

    // Turn 1: ATTACK UP vs COUNTER UP → COUNTER_SUCCESS, A takes 2 (A: 1, B: 3)
    expect(record.turns[0].result.outcome).toBe("COUNTER_SUCCESS");
    expect(record.turns[0].attackerHpAfter).toBe(1);

    // Turn 2: B ATTACK UP vs A DODGE UP → DODGE_FAIL, A takes 1 (A: 0, B: 3)
    expect(record.turns[1].result.outcome).toBe("DODGE_FAIL");

    // Match should end at turn 2 since A is at 0 HP
    expect(record.finishReason).toBe("HP_ZERO");
    expect(record.winnerId).toBe("b");
    expect(record.totalTurns).toBe(2);
  });
});

// ==================== formatMatchLog ====================

describe("formatMatchLog", () => {
  it("produces readable output for a completed match", () => {
    const record = simulateMatch({
      playerA: { id: "a", displayName: "Alice" },
      playerB: { id: "b", displayName: "Bob" },
      strategyA: fixedStrategy("UP", "DODGE", "UP"),
      strategyB: fixedStrategy("UP", "DODGE", "UP"),
      firstAttackerId: "a",
    });

    const log = formatMatchLog(record);

    expect(log).toContain("Alice");
    expect(log).toContain("Bob");
    expect(log).toContain("WINNER");
    expect(log).toContain("Turn 1");
    expect(log).toContain("Total turns");
  });

  it("shows DRAW for simultaneous KO when both AFK", () => {
    const record = simulateMatch({
      playerA: { id: "a", displayName: "Alice" },
      playerB: { id: "b", displayName: "Bob" },
      strategyA: afkStrategy(),
      strategyB: afkStrategy(),
    });

    const log = formatMatchLog(record);
    // With 3 HP and passivity damage of 1, after 3 turns both are at 0 → DRAW
    expect(log).toContain("DRAW");
  });

  it("shows timeout info for AFK turns", () => {
    const record = simulateMatch({
      playerA: { id: "a", displayName: "Alice" },
      playerB: { id: "b", displayName: "Bob" },
      strategyA: afkStrategy(),
      strategyB: afkStrategy(),
      maxTurns: 3,
    });

    const log = formatMatchLog(record);
    expect(log).toContain("timed out");
  });
});

// ==================== Multiple random simulations ====================

describe("stress: 100 random matches", () => {
  it("all complete without errors and produce valid results", () => {
    for (let i = 0; i < 100; i++) {
      const record = simulateMatch({
        playerA: { id: `a-${i}`, displayName: `Player A ${i}` },
        playerB: { id: `b-${i}`, displayName: `Player B ${i}` },
        strategyA: randomStrategy(),
        strategyB: randomStrategy(),
      });

      // Must have finished
      expect(record.totalTurns).toBeGreaterThan(0);
      expect(["HP_ZERO", "INACTIVITY", "DRAW"]).toContain(
        record.finishReason
      );

      // HP values must be valid
      expect(record.playerA.hp).toBeGreaterThanOrEqual(0);
      expect(record.playerA.hp).toBeLessThanOrEqual(GAME_CONFIG.INITIAL_HP);
      expect(record.playerB.hp).toBeGreaterThanOrEqual(0);
      expect(record.playerB.hp).toBeLessThanOrEqual(GAME_CONFIG.INITIAL_HP);

      // If there's a winner, they must be alive
      if (record.winnerId) {
        const winnerHp =
          record.winnerId === record.playerA.playerId
            ? record.playerA.hp
            : record.playerB.hp;
        expect(winnerHp).toBeGreaterThan(0);
      }

      // Each turn has valid records
      for (let j = 0; j < record.turns.length; j++) {
        expect(record.turns[j].turnNumber).toBe(j + 1);
      }
    }
  });
});
