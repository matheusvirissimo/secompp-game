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
  sessionToken: string;
  hp: number;
}

interface Env {
  MATCH_ROOM: DurableObjectNamespace;
  ADMIN_REGISTRY: DurableObjectNamespace;
  DB: D1Database;
}

export class MatchRoom extends DurableObject<Env> {
  // Match state
  private phase: MatchPhase = "WAITING";
  private matchId = "";
  private players = new Map<string, PlayerData>();
  private playerOrder: string[] = []; 
  private matchStartedAt: string | null = null;

  // Turn state
  private currentTurn = 0;
  private attackerId: string | null = null;
  private defenderId: string | null = null;
  private turnDeadline: number | null = null;
  private actions = new Map<string, AttackAction | DefenderAction>();
  private consecutiveInactiveTurns = 0;
  private resolvedTurn = 0; 
  private turnHistory: any[] = []; // Store turns for D1
  private spectatorWebSockets = new Set<WebSocket>();

  // Reconnection state
  private pausedPhase: MatchPhase | null = null;
  private pausedTurnRemainingMs: number | null = null;
  private disconnectTimeoutId: string | null = null;

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
    const isSpectator = url.searchParams.get("spectator") === "true";
    
    if (isSpectator) {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      this.spectatorWebSockets.add(server);
      
      this.sendToWs(server, this.buildMatchState(null));
      return new Response(null, { status: 101, webSocket: client });
    }

    const playerId = url.searchParams.get("playerId");
    const displayName = url.searchParams.get("displayName");
    const sessionToken = url.searchParams.get("sessionToken");

    if (!playerId || !displayName || !sessionToken) {
      return new Response("Missing playerId, displayName or sessionToken", { status: 400 });
    }

    if (this.phase === "FINISHED") {
      return new Response("Match is finished", { status: 410 });
    }

    if (this.players.size >= 2 && !this.players.has(playerId)) {
      return new Response("Match is full", { status: 409 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (this.players.has(playerId)) {
      // Reconnection or multiple tabs
      const existingPlayer = this.players.get(playerId)!;
      if (existingPlayer.sessionToken !== sessionToken) {
        return new Response("Invalid session token", { status: 403 });
      }
      
      this.ctx.acceptWebSocket(server, [playerId]);
      this.log("PLAYER_RECONNECTED", { playerId });
      
      // Send current state
      this.sendToWs(server, this.buildMatchState(playerId));
      
      this.checkReconnection();
    } else {
      // New player
      this.ctx.acceptWebSocket(server, [playerId]);
      
      this.players.set(playerId, {
        playerId,
        displayName: this.sanitizeDisplayName(displayName),
        sessionToken,
        hp: GAME_CONFIG.INITIAL_HP,
      });
      this.playerOrder.push(playerId);
      this.log("PLAYER_CONNECTED", { playerId, displayName });

      this.matchId = url.searchParams.get("matchId") || this.ctx.id.toString();

      this.sendToWs(server, this.buildMatchState(playerId));

      if (this.players.size === 2 && this.phase === "WAITING") {
        this.transitionToReady();
      }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // ==================== WebSocket Handlers ====================

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;

    const tags = this.ctx.getTags(ws);
    const playerId = tags[0];
    if (!playerId) return;

    let parsed: ClientMessage;
    try {
      parsed = JSON.parse(message);
    } catch {
      this.sendToWs(ws, { type: "ERROR", message: "Invalid JSON", code: "INVALID_JSON" });
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
        this.sendToWs(ws, { type: "ERROR", message: `Unknown message type`, code: "UNKNOWN_TYPE" });
    }
  }

  async webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean): Promise<void> {
    this.spectatorWebSockets.delete(ws);
    const tags = this.ctx.getTags(ws);
    const playerId = tags[0];
    if (!playerId) return;

    this.log("PLAYER_DISCONNECTED", { playerId, code });

    // Check if player has any other active sockets (e.g., multiple tabs)
    const activeSockets = this.ctx.getWebSockets(playerId);
    if (activeSockets.length > 0) return; // Still connected elsewhere

    if (this.phase === "PLAYING" || this.phase === "RESOLVING") {
      this.handleDisconnectDuringMatch(playerId);
    } else if (this.phase === "WAITING" || this.phase === "READY") {
      this.players.delete(playerId);
      this.playerOrder = this.playerOrder.filter((id) => id !== playerId);
      if (this.phase === "READY") {
        this.phase = "WAITING";
        this.ctx.storage.deleteAlarm();
      }
    }
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    this.spectatorWebSockets.delete(ws);
    const tags = this.ctx.getTags(ws);
    const playerId = tags[0];
    this.log("WEBSOCKET_ERROR", { playerId, error: String(error) });
  }

  // ==================== Reconnection Logic ====================

  private handleDisconnectDuringMatch(disconnectedPlayerId: string): void {
    const opponentId = this.getOpponentId(disconnectedPlayerId);
    if (!opponentId) return;

    this.log("WAITING_RECONNECT", { disconnectedPlayerId });
    
    // Pause match
    this.pausedPhase = this.phase;
    this.pausedTurnRemainingMs = this.turnDeadline ? Math.max(0, this.turnDeadline - Date.now()) : null;
    this.phase = "WAITING_RECONNECT";
    this.disconnectTimeoutId = disconnectedPlayerId;

    // Set alarm for forfeit timeout
    this.ctx.storage.setAlarm(Date.now() + GAME_CONFIG.RECONNECT_TIMEOUT_MS);

    // Notify opponent
    this.sendToPlayer(opponentId, {
      type: "OPPONENT_DISCONNECTED",
      reconnectTimeoutMs: GAME_CONFIG.RECONNECT_TIMEOUT_MS,
    });
  }

  private checkReconnection(): void {
    if (this.phase !== "WAITING_RECONNECT") return;

    // Are both players fully connected?
    const p1Connected = this.ctx.getWebSockets(this.playerOrder[0]).length > 0;
    const p2Connected = this.ctx.getWebSockets(this.playerOrder[1]).length > 0;

    if (p1Connected && p2Connected) {
      this.log("MATCH_RESUMED", {});
      
      // Resume match
      this.phase = this.pausedPhase || "PLAYING";
      this.disconnectTimeoutId = null;

      // Restore timer
      if (this.pausedTurnRemainingMs !== null) {
        this.turnDeadline = Date.now() + this.pausedTurnRemainingMs;
        this.ctx.storage.setAlarm(this.turnDeadline);
      } else {
        // If there was no timer, clear alarm
        this.ctx.storage.deleteAlarm();
      }

      // Broadcast new state so timers sync up
      for (const [id] of this.players) {
        this.sendToPlayer(id, this.buildMatchState(id));
      }
      
      // Also specifically notify opponent they reconnected
      const reconnectedPlayerId = this.playerOrder.find(id => id !== this.disconnectTimeoutId) || this.playerOrder[0];
      const opponentId = this.getOpponentId(reconnectedPlayerId);
      if (opponentId) {
        this.sendToPlayer(opponentId, { type: "OPPONENT_RECONNECTED" });
      }
    }
  }

  // ==================== Alarm (Timer) ====================

  async alarm(): Promise<void> {
    if (this.phase === "READY") {
      this.startMatch();
    } else if (this.phase === "PLAYING") {
      this.handleTurnTimeout();
    } else if (this.phase === "WAITING_RECONNECT") {
      this.handleReconnectTimeout();
    }
  }

  private handleReconnectTimeout(): void {
    this.log("RECONNECT_TIMEOUT_EXPIRED", { disconnectedPlayerId: this.disconnectTimeoutId });
    
    const loserId = this.disconnectTimeoutId;
    const winnerId = this.playerOrder.find(id => id !== loserId) || null;
    
    this.endMatch(winnerId, loserId);
  }

  // ==================== State Transitions ====================

  private transitionToReady(): void {
    this.phase = "READY";
    this.log("MATCH_READY", { matchId: this.matchId });

    for (const [playerId] of this.players) {
      const opponentId = this.getOpponentId(playerId)!;
      const opponent = this.players.get(opponentId)!;
      this.sendToPlayer(playerId, {
        type: "MATCH_FOUND",
        matchId: this.matchId,
        opponent: { playerId: opponent.playerId, displayName: opponent.displayName },
        countdownMs: GAME_CONFIG.READY_COUNTDOWN_MS,
      });
    }

    this.ctx.storage.setAlarm(Date.now() + GAME_CONFIG.READY_COUNTDOWN_MS);
  }

  private startMatch(): void {
    this.matchStartedAt = new Date().toISOString();
    const firstAttackerIdx = flipCoin() === "HEADS" ? 0 : 1;
    this.attackerId = this.playerOrder[firstAttackerIdx];
    this.defenderId = this.playerOrder[1 - firstAttackerIdx];

    this.currentTurn = 1;
    this.resolvedTurn = 0;
    this.phase = "PLAYING";
    this.consecutiveInactiveTurns = 0;

    this.log("MATCH_STARTED", { matchId: this.matchId, firstAttacker: this.attackerId });
    this.updateRegistry("register");
    this.startTurn();
  }

  private updateRegistry(action: "register" | "update" | "unregister") {
    try {
      const doId = this.env.ADMIN_REGISTRY.idFromName("global-registry");
      const stub = this.env.ADMIN_REGISTRY.get(doId);
      
      const p1 = this.players.get(this.playerOrder[0]);
      const p2 = this.players.get(this.playerOrder[1]);

      stub.fetch(new Request(`http://internal/internal/${action}`, {
        method: "POST",
        body: JSON.stringify({
          matchId: this.matchId,
          p1Name: p1?.displayName || "Player 1",
          p2Name: p2?.displayName || "Player 2",
          p1Hp: p1?.hp ?? 0,
          p2Hp: p2?.hp ?? 0,
          turn: this.currentTurn
        })
      }));
    } catch (e) {
      // Ignore registry errors
    }
  }

  private startTurn(): void {
    this.actions.clear();
    this.turnDeadline = Date.now() + GAME_CONFIG.TURN_DURATION_MS;
    
    if (this.currentTurn > 1) {
      this.updateRegistry("update");
    }

    this.log("TURN_STARTED", {
      turn: this.currentTurn,
      attacker: this.attackerId,
      defender: this.defenderId,
    });

    for (const [playerId] of this.players) {
      const role = playerId === this.attackerId ? "attacker" : "defender";
      this.sendToPlayer(playerId, {
        type: "TURN_STARTED",
        turn: this.currentTurn,
        yourRole: role as "attacker" | "defender",
        turnDeadline: this.turnDeadline,
      });
    }

    this.ctx.storage.setAlarm(this.turnDeadline);
  }

  // ==================== Action Handling ====================

  private handleAction(playerId: string, message: PlayerActionMessage): void {
    if (this.phase !== "PLAYING") {
      this.sendToPlayer(playerId, { type: "ACTION_REJECTED", turn: message.turn, reason: "Match is not in PLAYING phase" });
      return;
    }

    if (message.turn !== this.currentTurn) {
      this.sendToPlayer(playerId, { type: "ACTION_REJECTED", turn: message.turn, reason: `Wrong turn number. Expected ${this.currentTurn}` });
      return;
    }

    if (this.actions.has(playerId)) {
      this.sendToPlayer(playerId, { type: "ACTION_REJECTED", turn: message.turn, reason: "Action already submitted for this turn" });
      return;
    }

    const action = message.action;

    if (!isValidDirection(action.direction)) {
      this.sendToPlayer(playerId, { type: "ACTION_REJECTED", turn: message.turn, reason: "Invalid direction" });
      return;
    }

    const isAttacker = playerId === this.attackerId;

    if (isAttacker && action.type !== "ATTACK") {
      this.sendToPlayer(playerId, { type: "ACTION_REJECTED", turn: message.turn, reason: "Attacker must use ATTACK action" });
      return;
    }

    if (!isAttacker && action.type !== "DODGE" && action.type !== "COUNTER") {
      this.sendToPlayer(playerId, { type: "ACTION_REJECTED", turn: message.turn, reason: "Defender must use DODGE or COUNTER action" });
      return;
    }

    this.actions.set(playerId, action);

    this.log("ACTION_RECEIVED", { playerId, turn: this.currentTurn, actionType: action.type });

    this.sendToPlayer(playerId, { type: "ACTION_CONFIRMED", turn: this.currentTurn });

    const opponentId = this.getOpponentId(playerId);
    if (opponentId) {
      this.sendToPlayer(opponentId, { type: "OPPONENT_READY", turn: this.currentTurn });
    }

    if (this.actions.size === 2) {
      this.resolveTurnNow();
    }
  }

  // ==================== Turn Resolution ====================

  private handleTurnTimeout(): void {
    if (this.phase !== "PLAYING") return;
    if (this.resolvedTurn >= this.currentTurn) return;

    this.log("TURN_TIMEOUT", { turn: this.currentTurn });
    this.resolveTurnNow();
  }

  private resolveTurnNow(): void {
    if (this.resolvedTurn >= this.currentTurn) return;
    this.resolvedTurn = this.currentTurn;

    this.phase = "RESOLVING";
    this.ctx.storage.deleteAlarm();

    const attackerAction = this.actions.get(this.attackerId!) as AttackAction | undefined;
    const defenderAction = this.actions.get(this.defenderId!) as DefenderAction | undefined;

    const attackerActed = !!attackerAction;
    const defenderActed = !!defenderAction;

    let result: TurnResult;

    if (attackerActed && defenderActed) {
      result = resolveTurn(attackerAction!, defenderAction!);
      this.consecutiveInactiveTurns = 0;
    } else {
      result = resolveTimeout(attackerActed, defenderActed, attackerAction ?? null, defenderAction ?? null);
      if (!attackerActed && !defenderActed) {
        this.consecutiveInactiveTurns++;
      } else {
        this.consecutiveInactiveTurns = 0;
      }
    }

    const attacker = this.players.get(this.attackerId!)!;
    const defender = this.players.get(this.defenderId!)!;

    attacker.hp = applyDamage(attacker.hp, result.attackerDamage);
    defender.hp = applyDamage(defender.hp, result.defenderDamage);

    this.log("TURN_RESOLVED", { turn: this.currentTurn, outcome: result.outcome, attackerHp: attacker.hp, defenderHp: defender.hp });

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

    this.turnHistory.push({
      turn_number: this.currentTurn,
      attacker_id: this.attackerId!,
      defender_id: this.defenderId!,
      attack_direction: attackerAction?.direction ?? null,
      defense_type: defenderAction?.type ?? null,
      defense_direction: defenderAction?.direction ?? null,
      result: result.outcome,
    });

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

    if (this.consecutiveInactiveTurns >= GAME_CONFIG.MAX_CONSECUTIVE_INACTIVE_TURNS) {
      this.log("MATCH_ABORTED", { reason: "INACTIVITY" });
      this.endMatch(null, null);
      return;
    }

    const prevAttacker = this.attackerId;
    this.attackerId = this.defenderId;
    this.defenderId = prevAttacker;
    this.currentTurn++;
    this.phase = "PLAYING";

    this.startTurn();
  }

  private endMatch(winnerId: string | null, loserId: string | null): void {
    this.winnerId = winnerId;
    this.phase = "FINISHED";

    this.ctx.storage.deleteAlarm();

    const finalHp: Record<string, number> = {};
    for (const [id, player] of this.players) {
      finalHp[id] = player.hp;
    }

    this.log("MATCH_FINISHED", { matchId: this.matchId, winnerId, loserId, finalHp });

    this.broadcast({
      type: "MATCH_FINISHED",
      winnerId,
      loserId,
      finalHp,
    });

    this.updateRegistry("unregister");

    this.ctx.waitUntil(this.persistMatch(winnerId, loserId, finalHp));
  }

  private async persistMatch(winnerId: string | null, loserId: string | null, finalHp: Record<string, number>) {
    try {
      const db = this.env.DB;
      const p1 = this.players.get(this.playerOrder[0])!;
      const p2 = this.players.get(this.playerOrder[1])!;

      // 1. Upsert players
      await db.prepare(`
        INSERT INTO players (id, display_name, session_token, last_seen_at) 
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET 
          display_name = excluded.display_name,
          session_token = excluded.session_token,
          last_seen_at = excluded.last_seen_at
      `).bind(p1.playerId, p1.displayName, p1.sessionToken).run();

      await db.prepare(`
        INSERT INTO players (id, display_name, session_token, last_seen_at) 
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET 
          display_name = excluded.display_name,
          session_token = excluded.session_token,
          last_seen_at = excluded.last_seen_at
      `).bind(p2.playerId, p2.displayName, p2.sessionToken).run();

      // 2. Insert match
      await db.prepare(`
        INSERT INTO matches (id, player_a_id, player_b_id, winner_id, loser_id, player_a_hp_final, player_b_hp_final, total_turns, started_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        this.matchId,
        p1.playerId,
        p2.playerId,
        winnerId,
        loserId,
        finalHp[p1.playerId],
        finalHp[p2.playerId],
        this.currentTurn,
        this.matchStartedAt || new Date().toISOString()
      ).run();

      // 3. Insert turns
      if (this.turnHistory.length > 0) {
        // Prepare bulk insert (D1 max batch size logic could be needed, but a game usually has < 20 turns)
        const stmt = db.prepare(`
          INSERT INTO turns (id, match_id, turn_number, attacker_id, defender_id, attack_direction, defense_type, defense_direction, result)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const batch = this.turnHistory.map(t => stmt.bind(
          crypto.randomUUID(),
          this.matchId,
          t.turn_number,
          t.attacker_id,
          t.defender_id,
          t.attack_direction,
          t.defense_type,
          t.defense_direction,
          t.result
        ));
        await db.batch(batch);
      }

      // 4. Update leaderboard
      // Could be complex, let's do simple updates
      await this.updateLeaderboard(p1.playerId, p1.displayName, winnerId === p1.playerId, winnerId === p2.playerId);
      await this.updateLeaderboard(p2.playerId, p2.displayName, winnerId === p2.playerId, winnerId === p1.playerId);

    } catch (e) {
      console.error("Failed to persist match to D1:", e);
    }
  }

  private async updateLeaderboard(playerId: string, displayName: string, isWinner: boolean, isLoser: boolean) {
    const db = this.env.DB;
    const entry = await db.prepare(`SELECT current_streak, best_streak, points FROM leaderboard WHERE player_id = ?`).bind(playerId).first<{ current_streak: number, best_streak: number, points: number }>();
    
    let currentStreak = entry ? entry.current_streak : 0;
    let bestStreak = entry ? entry.best_streak : 0;
    let points = entry ? entry.points : 0;

    let winsIncrement = 0;
    let lossesIncrement = 0;

    if (isWinner) {
      winsIncrement = 1;
      currentStreak += 1;
      if (currentStreak > bestStreak) bestStreak = currentStreak;
      // Formula: BASE_WIN_POINTS (3) + STREAK_BONUS (1 * streak)
      points += GAME_CONFIG.LEADERBOARD.BASE_WIN_POINTS + (currentStreak * GAME_CONFIG.LEADERBOARD.STREAK_BONUS);
    } else if (isLoser) {
      lossesIncrement = 1;
      currentStreak = 0;
      points += GAME_CONFIG.LEADERBOARD.LOSS_POINTS;
    } else {
      // Draw or aborted
      currentStreak = 0;
    }

    await db.prepare(`
      INSERT INTO leaderboard (player_id, display_name, wins, losses, total_matches, current_streak, best_streak, points)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(player_id) DO UPDATE SET
        display_name = excluded.display_name,
        wins = leaderboard.wins + excluded.wins,
        losses = leaderboard.losses + excluded.losses,
        total_matches = leaderboard.total_matches + 1,
        current_streak = excluded.current_streak,
        best_streak = excluded.best_streak,
        points = excluded.points,
        updated_at = datetime('now')
    `).bind(playerId, displayName, winsIncrement, lossesIncrement, currentStreak, bestStreak, points).run();
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
      } catch {}
    }
  }

  private sendToWs(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {}
  }

  private broadcast(message: ServerMessage): void {
    const data = JSON.stringify(message);
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      try {
        ws.send(data);
      } catch {}
    }
  }

  private buildMatchState(forPlayerId: string | null): ServerMessage {
    let me: PlayerData | null = null;
    let opponentId: string | null = null;
    let opponent: PlayerData | null = null;

    if (forPlayerId) {
      me = this.players.get(forPlayerId) || null;
      opponentId = this.getOpponentId(forPlayerId);
      opponent = opponentId ? this.players.get(opponentId) ?? null : null;
    } else {
      // Spectator view: Treat p1 as "me" and p2 as "opponent"
      const p1 = this.playerOrder[0];
      const p2 = this.playerOrder[1];
      if (p1) me = this.players.get(p1) || null;
      if (p2) opponent = this.players.get(p2) || null;
    }

    const myRole = me?.playerId === this.attackerId ? "attacker"
        : me?.playerId === this.defenderId ? "defender" : "none";
    const oppRole = opponent ? (opponent.playerId === this.attackerId ? "attacker"
        : opponent.playerId === this.defenderId ? "defender" : "none") : "none";

    return {
      type: "MATCH_STATE",
      matchId: this.matchId,
      state: this.phase,
      turn: this.currentTurn,
      you: me ? {
        playerId: me.playerId,
        displayName: me.displayName,
        hp: me.hp,
        role: myRole as PlayerInfo["role"],
      } : { playerId: "", displayName: "", hp: 0, role: "none" },
      opponent: opponent ? {
        playerId: opponent.playerId,
        displayName: opponent.displayName,
        hp: opponent.hp,
        role: oppRole as PlayerInfo["role"],
      } : null,
      turnDeadline: this.turnDeadline,
      yourActionLocked: forPlayerId ? this.actions.has(forPlayerId) : true,
    };
  }

  private sanitizeDisplayName(name: string): string {
    const clean = name.replace(/[<>&"'/]/g, "").trim().slice(0, GAME_CONFIG.MAX_DISPLAY_NAME_LENGTH);
    return clean || "Player";
  }

  private log(event: string, data?: Record<string, unknown>): void {
    console.log(JSON.stringify({
      event,
      matchId: this.matchId,
      phase: this.phase,
      timestamp: new Date().toISOString(),
      ...data,
    }));
  }
}

import type { PlayerActionMessage } from "../shared/protocol";
