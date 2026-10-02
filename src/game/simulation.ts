import { GAME_CONFIG } from "./config";
import {
  resolveTurn,
  resolveTimeout,
  applyDamage,
  checkVictory,
  flipCoin,
} from "./engine";
import type {
  AttackAction,
  CoinSide,
  DefenderAction,
  Direction,
  TurnResult,
  VictoryCheck,
} from "./types";
import { DIRECTIONS } from "./types";

// ==================== Match Simulation Types ====================

export type SimulatedPlayer = {
  readonly playerId: string;
  readonly displayName: string;
  hp: number;
};

export type TurnRecord = {
  readonly turnNumber: number;
  readonly attackerId: string;
  readonly defenderId: string;
  readonly attackAction: AttackAction | null;
  readonly defenderAction: DefenderAction | null;
  readonly result: TurnResult;
  readonly attackerHpAfter: number;
  readonly defenderHpAfter: number;
};

export type MatchRecord = {
  readonly playerA: SimulatedPlayer;
  readonly playerB: SimulatedPlayer;
  readonly firstAttackerId: string;
  readonly turns: TurnRecord[];
  readonly winnerId: string | null;
  readonly finishReason: "HP_ZERO" | "INACTIVITY" | "DRAW";
  readonly totalTurns: number;
};

/**
 * Strategy function that decides what action a player takes.
 * Receives the player's role and returns their action, or null for timeout.
 */
export type ActionStrategy = (context: {
  turnNumber: number;
  role: "attacker" | "defender";
  myHp: number;
  opponentHp: number;
  playerId: string;
}) => AttackAction | DefenderAction | null;

// ==================== Built-in Strategies ====================

/**
 * Returns a random valid action for the player's role.
 */
export function randomStrategy(): ActionStrategy {
  return ({ role }) => {
    const direction = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
    if (role === "attacker") {
      return { type: "ATTACK", direction };
    }
    const defenseType = Math.random() < 0.5 ? "DODGE" : "COUNTER";
    return { type: defenseType, direction } as DefenderAction;
  };
}

/**
 * Always attacks/defends in a fixed direction with a fixed defense type.
 */
export function fixedStrategy(
  attackDir: Direction,
  defenseType: "DODGE" | "COUNTER",
  defenseDir: Direction
): ActionStrategy {
  return ({ role }) => {
    if (role === "attacker") {
      return { type: "ATTACK", direction: attackDir };
    }
    return { type: defenseType, direction: defenseDir } as DefenderAction;
  };
}

/**
 * Never acts — always times out.
 */
export function afkStrategy(): ActionStrategy {
  return () => null;
}

/**
 * Acts based on a predefined sequence of actions per turn.
 * Returns null (timeout) for turns beyond the sequence.
 */
export function scriptedStrategy(
  actions: (AttackAction | DefenderAction | null)[]
): ActionStrategy {
  let index = 0;
  return () => {
    if (index >= actions.length) return null;
    return actions[index++] ?? null;
  };
}

// ==================== Match Simulator ====================

export type SimulateMatchOptions = {
  playerA: { id: string; displayName: string };
  playerB: { id: string; displayName: string };
  strategyA: ActionStrategy;
  strategyB: ActionStrategy;
  firstAttackerId?: string; // If omitted, decided by coin flip
  maxTurns?: number; // Safety limit, default 50
};

/**
 * Simulates an entire match using the Game Engine.
 * No networking, no WebSockets — pure in-memory simulation.
 *
 * Returns a complete record of the match.
 */
export function simulateMatch(options: SimulateMatchOptions): MatchRecord {
  const {
    playerA: playerAOpts,
    playerB: playerBOpts,
    strategyA,
    strategyB,
    maxTurns = 50,
  } = options;

  const playerA: SimulatedPlayer = {
    playerId: playerAOpts.id,
    displayName: playerAOpts.displayName,
    hp: GAME_CONFIG.INITIAL_HP,
  };

  const playerB: SimulatedPlayer = {
    playerId: playerBOpts.id,
    displayName: playerBOpts.displayName,
    hp: GAME_CONFIG.INITIAL_HP,
  };

  // Decide who attacks first
  const firstAttackerId =
    options.firstAttackerId ??
    (flipCoin() === "HEADS" ? playerA.playerId : playerB.playerId);

  const turns: TurnRecord[] = [];
  let consecutiveInactiveTurns = 0;
  let winnerId: string | null = null;
  let finishReason: "HP_ZERO" | "INACTIVITY" | "DRAW" = "HP_ZERO";

  for (let turnNumber = 1; turnNumber <= maxTurns; turnNumber++) {
    // Determine attacker/defender for this turn (alternates each turn)
    const attackerIsA =
      (turnNumber % 2 === 1) ===
      (firstAttackerId === playerA.playerId);

    const attacker = attackerIsA ? playerA : playerB;
    const defender = attackerIsA ? playerB : playerA;
    const attackerStrategy = attackerIsA ? strategyA : strategyB;
    const defenderStrategy = attackerIsA ? strategyB : strategyA;

    // Get actions from strategies
    const attackAction = attackerStrategy({
      turnNumber,
      role: "attacker",
      myHp: attacker.hp,
      opponentHp: defender.hp,
      playerId: attacker.playerId,
    }) as AttackAction | null;

    const defenderAction = defenderStrategy({
      turnNumber,
      role: "defender",
      myHp: defender.hp,
      opponentHp: attacker.hp,
      playerId: defender.playerId,
    }) as DefenderAction | null;

    // Resolve the turn
    const attackerActed = attackAction !== null;
    const defenderActed = defenderAction !== null;
    let result: TurnResult;

    if (attackerActed && defenderActed) {
      result = resolveTurn(attackAction!, defenderAction!);
      consecutiveInactiveTurns = 0;
    } else {
      result = resolveTimeout(
        attackerActed,
        defenderActed,
        attackAction,
        defenderAction
      );

      if (!attackerActed && !defenderActed) {
        consecutiveInactiveTurns++;
      } else {
        consecutiveInactiveTurns = 0;
      }
    }

    // Apply damage
    attacker.hp = applyDamage(attacker.hp, result.attackerDamage);
    defender.hp = applyDamage(defender.hp, result.defenderDamage);

    // Record the turn
    turns.push({
      turnNumber,
      attackerId: attacker.playerId,
      defenderId: defender.playerId,
      attackAction,
      defenderAction,
      result,
      attackerHpAfter: attacker.hp,
      defenderHpAfter: defender.hp,
    });

    // Check victory
    const victory = checkVictory(attacker.hp, defender.hp);
    if (victory.gameOver) {
      if (victory.winner === "attacker") {
        winnerId = attacker.playerId;
      } else if (victory.winner === "defender") {
        winnerId = defender.playerId;
      } else {
        winnerId = null;
        finishReason = "DRAW";
      }
      if (finishReason !== "DRAW") finishReason = "HP_ZERO";
      break;
    }

    // Check inactivity abort
    if (
      consecutiveInactiveTurns >= GAME_CONFIG.MAX_CONSECUTIVE_INACTIVE_TURNS
    ) {
      winnerId = null;
      finishReason = "INACTIVITY";
      break;
    }
  }

  return {
    playerA,
    playerB,
    firstAttackerId,
    turns,
    winnerId,
    finishReason,
    totalTurns: turns.length,
  };
}

// ==================== Match Logger ====================

/**
 * Formats a match record as a human-readable log string.
 */
export function formatMatchLog(record: MatchRecord): string {
  const lines: string[] = [];
  const playerMap = new Map<string, string>([
    [record.playerA.playerId, record.playerA.displayName],
    [record.playerB.playerId, record.playerB.displayName],
  ]);

  const name = (id: string) => playerMap.get(id) ?? id;

  lines.push("═══════════════════════════════════════");
  lines.push("          BATTLE SIMULATION");
  lines.push("═══════════════════════════════════════");
  lines.push("");
  lines.push(
    `  ${record.playerA.displayName} (${GAME_CONFIG.INITIAL_HP} HP)  vs  ${record.playerB.displayName} (${GAME_CONFIG.INITIAL_HP} HP)`
  );
  lines.push(`  First attacker: ${name(record.firstAttackerId)}`);
  lines.push("");
  lines.push("───────────────────────────────────────");

  for (const turn of record.turns) {
    lines.push("");
    lines.push(`  Turn ${turn.turnNumber}`);
    lines.push(
      `  ⚔️  ${name(turn.attackerId)} attacks  →  ${name(turn.defenderId)} defends`
    );

    if (turn.attackAction && turn.defenderAction) {
      lines.push(
        `  📋  ATTACK ${turn.attackAction.direction}  vs  ${turn.defenderAction.type} ${turn.defenderAction.direction}`
      );
    } else if (!turn.attackAction && !turn.defenderAction) {
      lines.push("  ⏰  Both players timed out!");
    } else if (!turn.attackAction) {
      lines.push("  ⏰  Attacker timed out!");
    } else {
      lines.push("  ⏰  Defender timed out!");
    }

    const outcomeEmoji: Record<string, string> = {
      DODGE_SUCCESS: "💨 Dodge successful — no damage!",
      DODGE_FAIL: "💥 Dodge failed!",
      COUNTER_SUCCESS: "⚡ PERFECT COUNTER!",
      COUNTER_FAIL: "💥 Counter failed!",
      ATTACKER_TIMEOUT: "⏰ Turn wasted — no damage",
      DEFENDER_TIMEOUT: "⏰ Turn wasted — no damage",
      BOTH_TIMEOUT: "💀 Passivity penalty — both take damage!",
    };

    lines.push(
      `  ${outcomeEmoji[turn.result.outcome] ?? turn.result.outcome}`
    );

    if (turn.result.attackerDamage > 0) {
      lines.push(
        `  ${name(turn.attackerId)} takes ${turn.result.attackerDamage} damage`
      );
    }
    if (turn.result.defenderDamage > 0) {
      lines.push(
        `  ${name(turn.defenderId)} takes ${turn.result.defenderDamage} damage`
      );
    }

    lines.push(
      `  HP: ${name(turn.attackerId)} ${turn.attackerHpAfter}  |  ${name(turn.defenderId)} ${turn.defenderHpAfter}`
    );
  }

  lines.push("");
  lines.push("═══════════════════════════════════════");

  if (record.winnerId) {
    lines.push(`  🏆 WINNER: ${name(record.winnerId)}!`);
  } else if (record.finishReason === "DRAW") {
    lines.push("  🤝 DRAW — both players eliminated!");
  } else if (record.finishReason === "INACTIVITY") {
    lines.push("  ❌ MATCH ABORTED — inactivity!");
  }

  lines.push(`  Total turns: ${record.totalTurns}`);
  lines.push(
    `  Final HP: ${record.playerA.displayName} ${record.playerA.hp}  |  ${record.playerB.displayName} ${record.playerB.hp}`
  );
  lines.push("═══════════════════════════════════════");

  return lines.join("\n");
}
