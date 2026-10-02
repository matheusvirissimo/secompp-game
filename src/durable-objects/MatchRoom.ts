import { DurableObject } from "cloudflare:workers";
import { GAME_CONFIG } from "../game/config";
import {
  resolveTurn,
  resolveTimeout,
  applyDamage,
  checkVictory,
  flipCoin,
  isValidDirection,
} from "../game/engine";
import type {
  AttackAction,
  DefenderAction,
  MatchPhase,
  TurnResult,
} from "../game/types";
import type {
  ClientMessage,
  ServerMessage,
  PlayerInfo,
} from "../shared/protocol";

// ==================== Types ====================

interface PlayerData {
  playerId: string;
  displayName: string;
  hp: number;
}

interface Env {
  MATCH_ROOM: DurableObjectNamespace;
}

// ==================== MatchRoom Durable Object ====================

/**
 * Each MatchRoom instance represents a single match.
 * 1 match = 1 Durable Object = single authoritative source of truth.
 *
 * Manages:
 * - WebSocket connections for both players
 * - Match state machine (WAITING → READY → PLAYING → RESOLVING → FINISHED)
 * - Turn timer via alarms
 * - Action validation and resolution using the Game Engine
 * - Turn alternation and role assignment
 */
export class MatchRoom extends DurableObject {
  // Match state
  private phase: MatchPhase = "WAITING";
  private matchId = "";
  private players = new Map<string, PlayerData>();
  private playerOrder: string[] = []; // [first joined, second joined]

  // Turn state
  private currentTurn = 0;
  private attackerId: string | null = null;
  private defenderId: string | null = null;
  private turnDeadline: number | null = null;
  private actions = new Map<string, AttackAction | DefenderAction>();
  private consecutiveInactiveTurns = 0;
  private resolvedTurn = 0; // Guards against double resolution

  // Match result
  private winnerId: string | null = null;

  // ==================== HTTP / WebSocket Entry ====================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocketUpgrade(url);
    }

    if (url.pathname === "/state") {
      return Response.json({
        phase: this.phase,
        players: Array.from(this.players.values()),
        currentTurn: this.currentTurn,
        attackerId: this.attackerId,
        defenderId: this.defenderId,
      });
    }

    return new Response("Not found", { status: 404 });
  }

  private handleWebSocketUpgrade(url: URL): Response {
    const playerId = url.searchParams.get("playerId");
    const displayName = url.searchParams.get("displayName");

    if (!playerId || !displayName) {
      return new Response("Missing playerId or displayName", { status: 400 });
    }

    // Validate match state
    if (this.phase === "FINISHED") {
      return new Response("Match is finished", { status: 410 });
    }

    if (this.players.size >= 2 && !this.players.has(playerId)) {
      return new Response("Match is full", { status: 409 });
    }

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept with player ID tag for identification
    this.ctx.acceptWebSocket(server, [playerId]);

    // Register player if new
    if (!this.players.has(playerId)) {
      this.players.set(playerId, {
        playerId,
        displayName: this.sanitizeDisplayName(displayName),
        hp: GAME_CONFIG.INITIAL_HP,
      });
      this.playerOrder.push(playerId);
      this.log("PLAYER_CONNECTED", { playerId, displayName });
    }

    this.matchId =
      url.searchParams.get("matchId") || this.ctx.id.toString();

    // Send initial state to the connecting player
    this.sendToPlayer(playerId, this.buildMatchState(playerId));

    // If both players are connected and we're still WAITING, transition
    if (this.players.size === 2 && this.phase === "WAITING") {
      this.transitionToReady();
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // ==================== WebSocket Handlers ====================

  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer
  ): Promise<void> {
    if (typeof message !== "string") return;

    const tags = this.ctx.getTags(ws);
    const playerId = tags[0];
    if (!playerId) return;

    let parsed: ClientMessage;
    try {
      parsed = JSON.parse(message);
    } catch {
      this.sendToWs(ws, {
        type: "ERROR",
        message: "Invalid JSON",
        code: "INVALID_JSON",
      });
      return;
    }

    switch (parsed.type) {
      case "PING":
        this.sendToWs(ws, { type: "PONG" });
        break;

      case "ACTION":
        this.handleAction(playerId, parsed);
        break;

      default:
        this.sendToWs(ws, {
          type: "ERROR",
          message: `Unknown message type: ${(parsed as any).type}`,
          code: "UNKNOWN_TYPE",
        });
    }
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    _reason: string,
    _wasClean: boolean
  ): Promise<void> {
    const tags = this.ctx.getTags(ws);
    const playerId = tags[0];
    if (!playerId) return;

    this.log("PLAYER_DISCONNECTED", { playerId, code });

    // Phase 3: if a player disconnects during a match, opponent wins by forfeit
    // Phase 4 will add proper reconnection support
    if (this.phase === "PLAYING" || this.phase === "RESOLVING") {
      const opponentId = this.getOpponentId(playerId);
      if (opponentId) {
        this.endMatch(opponentId, playerId);
      }
    } else if (this.phase === "WAITING" || this.phase === "READY") {
      // Clean up if a player disconnects before the match starts
      this.players.delete(playerId);
      this.playerOrder = this.playerOrder.filter((id) => id !== playerId);
      if (this.phase === "READY") {
        this.phase = "WAITING";
        this.ctx.storage.deleteAlarm();
      }
    }
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const tags = this.ctx.getTags(ws);
    const playerId = tags[0];
    this.log("WEBSOCKET_ERROR", {
      playerId,
      error: String(error),
    });
  }

  // ==================== Alarm (Timer) ====================

  async alarm(): Promise<void> {
    if (this.phase === "READY") {
      this.startMatch();
    } else if (this.phase === "PLAYING") {
      this.handleTurnTimeout();
    }
  }

  // ==================== State Transitions ====================

  private transitionToReady(): void {
    this.phase = "READY";
    this.log("MATCH_READY", { matchId: this.matchId });

    // Send MATCH_FOUND to each player with opponent info
    for (const [playerId] of this.players) {
      const opponentId = this.getOpponentId(playerId)!;
      const opponent = this.players.get(opponentId)!;
      this.sendToPlayer(playerId, {
        type: "MATCH_FOUND",
        matchId: this.matchId,
        opponent: {
          playerId: opponent.playerId,
          displayName: opponent.displayName,
        },
        countdownMs: GAME_CONFIG.READY_COUNTDOWN_MS,
      });
    }

    // Set alarm for countdown to start
    this.ctx.storage.setAlarm(
      Date.now() + GAME_CONFIG.READY_COUNTDOWN_MS
    );
  }

  private startMatch(): void {
    // Randomly decide who attacks first
    const firstAttackerIdx = flipCoin() === "HEADS" ? 0 : 1;
    this.attackerId = this.playerOrder[firstAttackerIdx];
    this.defenderId = this.playerOrder[1 - firstAttackerIdx];

    this.currentTurn = 1;
    this.resolvedTurn = 0;
    this.phase = "PLAYING";
    this.consecutiveInactiveTurns = 0;

    this.log("MATCH_STARTED", {
      matchId: this.matchId,
      firstAttacker: this.attackerId,
    });

    this.startTurn();
  }

  private startTurn(): void {
    this.actions.clear();
    this.turnDeadline = Date.now() + GAME_CONFIG.TURN_DURATION_MS;

    this.log("TURN_STARTED", {
      turn: this.currentTurn,
      attacker: this.attackerId,
      defender: this.defenderId,
    });

    // Notify each player of their role
    for (const [playerId] of this.players) {
      const role =
        playerId === this.attackerId ? "attacker" : "defender";
      this.sendToPlayer(playerId, {
        type: "TURN_STARTED",
        turn: this.currentTurn,
        yourRole: role as "attacker" | "defender",
        turnDeadline: this.turnDeadline,
      });
    }

    // Set alarm for turn deadline
    this.ctx.storage.setAlarm(this.turnDeadline);
  }

  // ==================== Action Handling ====================

  private handleAction(playerId: string, message: PlayerActionMessage): void {
    // Validate phase
    if (this.phase !== "PLAYING") {
      this.sendToPlayer(playerId, {
        type: "ACTION_REJECTED",
        turn: message.turn,
        reason: "Match is not in PLAYING phase",
      });
      return;
    }

    // Validate turn number
    if (message.turn !== this.currentTurn) {
      this.sendToPlayer(playerId, {
        type: "ACTION_REJECTED",
        turn: message.turn,
        reason: `Wrong turn number. Expected ${this.currentTurn}`,
      });
      return;
    }

    // Check if player already submitted action (one action per turn)
    if (this.actions.has(playerId)) {
      this.sendToPlayer(playerId, {
        type: "ACTION_REJECTED",
        turn: message.turn,
        reason: "Action already submitted for this turn",
      });
      return;
    }

    const action = message.action;

    // Validate direction
    if (!isValidDirection(action.direction)) {
      this.sendToPlayer(playerId, {
        type: "ACTION_REJECTED",
        turn: message.turn,
        reason: "Invalid direction",
      });
      return;
    }

    // Validate action matches player's role
    const isAttacker = playerId === this.attackerId;

    if (isAttacker && action.type !== "ATTACK") {
      this.sendToPlayer(playerId, {
        type: "ACTION_REJECTED",
        turn: message.turn,
        reason: "Attacker must use ATTACK action",
      });
      return;
    }

    if (
      !isAttacker &&
      action.type !== "DODGE" &&
      action.type !== "COUNTER"
    ) {
      this.sendToPlayer(playerId, {
        type: "ACTION_REJECTED",
        turn: message.turn,
        reason: "Defender must use DODGE or COUNTER action",
      });
      return;
    }

    // Accept the action
    this.actions.set(playerId, action);

    this.log("ACTION_RECEIVED", {
      playerId,
      turn: this.currentTurn,
      actionType: action.type,
    });

    // Confirm to the player
    this.sendToPlayer(playerId, {
      type: "ACTION_CONFIRMED",
      turn: this.currentTurn,
    });

    // Notify opponent (WITHOUT revealing the action)
    const opponentId = this.getOpponentId(playerId);
    if (opponentId) {
      this.sendToPlayer(opponentId, {
        type: "OPPONENT_READY",
        turn: this.currentTurn,
      });
    }

    // If both players have submitted, resolve immediately
    if (this.actions.size === 2) {
      this.resolveTurnNow();
    }
  }

  // ==================== Turn Resolution ====================

  private handleTurnTimeout(): void {
    if (this.phase !== "PLAYING") return;
    if (this.resolvedTurn >= this.currentTurn) return; // Guard against double resolution

    this.log("TURN_TIMEOUT", { turn: this.currentTurn });
    this.resolveTurnNow();
  }

  private resolveTurnNow(): void {
    // Idempotency guard: prevent resolving the same turn twice
    if (this.resolvedTurn >= this.currentTurn) return;
    this.resolvedTurn = this.currentTurn;

    this.phase = "RESOLVING";

    // Cancel any pending alarm (new alarm will be set if match continues)
    this.ctx.storage.deleteAlarm();

    const attackerAction = this.actions.get(this.attackerId!) as
      | AttackAction
      | undefined;
    const defenderAction = this.actions.get(this.defenderId!) as
      | DefenderAction
      | undefined;

    const attackerActed = !!attackerAction;
    const defenderActed = !!defenderAction;

    // Resolve using Game Engine
    let result: TurnResult;

    if (attackerActed && defenderActed) {
      result = resolveTurn(attackerAction!, defenderAction!);
      this.consecutiveInactiveTurns = 0;
    } else {
      result = resolveTimeout(
        attackerActed,
        defenderActed,
        attackerAction ?? null,
        defenderAction ?? null
      );
      if (!attackerActed && !defenderActed) {
        this.consecutiveInactiveTurns++;
      } else {
        this.consecutiveInactiveTurns = 0;
      }
    }

    // Apply damage
    const attacker = this.players.get(this.attackerId!)!;
    const defender = this.players.get(this.defenderId!)!;

    attacker.hp = applyDamage(attacker.hp, result.attackerDamage);
    defender.hp = applyDamage(defender.hp, result.defenderDamage);

    this.log("TURN_RESOLVED", {
      turn: this.currentTurn,
      outcome: result.outcome,
      attackerHp: attacker.hp,
      defenderHp: defender.hp,
    });

    // Broadcast turn result (REVEAL)
    this.broadcast({
      type: "TURN_RESULT",
      turn: this.currentTurn,
      attackerAction: attackerAction ?? null,
      defenderAction: defenderAction ?? null,
      result: result.outcome,
      attackerDamage: result.attackerDamage,
      defenderDamage: result.defenderDamage,
      attackerHpAfter: attacker.hp,
      defenderHpAfter: defender.hp,
      attackerId: this.attackerId!,
      defenderId: this.defenderId!,
    });

    // Check victory
    const victory = checkVictory(attacker.hp, defender.hp);

    if (victory.gameOver) {
      let winner: string | null = null;
      let loser: string | null = null;

      if (victory.winner === "attacker") {
        winner = this.attackerId;
        loser = this.defenderId;
      } else if (victory.winner === "defender") {
        winner = this.defenderId;
        loser = this.attackerId;
      }

      this.endMatch(winner, loser);
      return;
    }

    // Check inactivity abort
    if (
      this.consecutiveInactiveTurns >=
      GAME_CONFIG.MAX_CONSECUTIVE_INACTIVE_TURNS
    ) {
      this.log("MATCH_ABORTED", { reason: "INACTIVITY" });
      this.endMatch(null, null);
      return;
    }

    // Next turn: swap roles
    const prevAttacker = this.attackerId;
    this.attackerId = this.defenderId;
    this.defenderId = prevAttacker;
    this.currentTurn++;
    this.phase = "PLAYING";

    this.startTurn();
  }

  private endMatch(
    winnerId: string | null,
    loserId: string | null
  ): void {
    this.winnerId = winnerId;
    this.phase = "FINISHED";

    this.ctx.storage.deleteAlarm();

    const finalHp: Record<string, number> = {};
    for (const [id, player] of this.players) {
      finalHp[id] = player.hp;
    }

    this.log("MATCH_FINISHED", {
      matchId: this.matchId,
      winnerId,
      loserId,
      finalHp,
    });

    this.broadcast({
      type: "MATCH_FINISHED",
      winnerId,
      loserId,
      finalHp,
    });
  }

  // ==================== Helpers ====================

  private getOpponentId(playerId: string): string | null {
    for (const [id] of this.players) {
      if (id !== playerId) return id;
    }
    return null;
  }

  private sendToPlayer(playerId: string, message: ServerMessage): void {
    const sockets = this.ctx.getWebSockets(playerId);
    const data = JSON.stringify(message);
    for (const ws of sockets) {
      try {
        ws.send(data);
      } catch {
        // Socket might be closed
      }
    }
  }

  private sendToWs(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Socket might be closed
    }
  }

  private broadcast(message: ServerMessage): void {
    const data = JSON.stringify(message);
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      try {
        ws.send(data);
      } catch {
        // Socket might be closed
      }
    }
  }

  private buildMatchState(forPlayerId: string): ServerMessage {
    const me = this.players.get(forPlayerId)!;
    const opponentId = this.getOpponentId(forPlayerId);
    const opponent = opponentId
      ? this.players.get(opponentId) ?? null
      : null;

    const myRole =
      me.playerId === this.attackerId
        ? "attacker"
        : me.playerId === this.defenderId
          ? "defender"
          : "none";
    const oppRole = opponent
      ? opponent.playerId === this.attackerId
        ? "attacker"
        : opponent.playerId === this.defenderId
          ? "defender"
          : "none"
      : "none";

    return {
      type: "MATCH_STATE",
      matchId: this.matchId,
      state: this.phase,
      turn: this.currentTurn,
      you: {
        playerId: me.playerId,
        displayName: me.displayName,
        hp: me.hp,
        role: myRole as PlayerInfo["role"],
      },
      opponent: opponent
        ? {
            playerId: opponent.playerId,
            displayName: opponent.displayName,
            hp: opponent.hp,
            role: oppRole as PlayerInfo["role"],
          }
        : null,
      turnDeadline: this.turnDeadline,
      yourActionLocked: this.actions.has(forPlayerId),
    };
  }

  private sanitizeDisplayName(name: string): string {
    // Strip any HTML/script tags, limit length
    const clean = name
      .replace(/[<>&"'/]/g, "")
      .trim()
      .slice(0, GAME_CONFIG.MAX_DISPLAY_NAME_LENGTH);
    return clean || "Player";
  }

  private log(event: string, data?: Record<string, unknown>): void {
    console.log(
      JSON.stringify({
        event,
        matchId: this.matchId,
        phase: this.phase,
        timestamp: new Date().toISOString(),
        ...data,
      })
    );
  }
}

// Re-export for type inference
import type { PlayerActionMessage } from "../shared/protocol";
