/**
 * WebSocket protocol types shared between frontend and backend.
 * All messages exchanged via WebSocket are defined here.
 */

import type { Direction, MatchPhase, TurnOutcome } from "../game/types";

// ==================== Client → Server ====================

export type JoinMatchMessage = {
  type: "JOIN_MATCH";
  matchId: string;
  sessionToken: string;
};

export type PlayerActionMessage = {
  type: "ACTION";
  matchId: string;
  turn: number;
  action:
    | { type: "ATTACK"; direction: Direction }
    | { type: "DODGE"; direction: Direction }
    | { type: "COUNTER"; direction: Direction };
};

export type ReconnectMessage = {
  type: "RECONNECT";
  matchId: string;
  sessionToken: string;
};

export type PingMessage = {
  type: "PING";
};

export type ClientMessage =
  | JoinMatchMessage
  | PlayerActionMessage
  | ReconnectMessage
  | PingMessage;

// ==================== Server → Client ====================

export type PlayerInfo = {
  playerId: string;
  displayName: string;
  hp: number;
  role: "attacker" | "defender" | "none";
};

export type MatchStateMessage = {
  type: "MATCH_STATE";
  matchId: string;
  state: MatchPhase;
  turn: number;
  you: PlayerInfo;
  opponent: PlayerInfo | null;
  turnDeadline: number | null;
  yourActionLocked: boolean;
};

export type MatchFoundMessage = {
  type: "MATCH_FOUND";
  matchId: string;
  opponent: { playerId: string; displayName: string };
  countdownMs: number;
};

export type TurnStartedMessage = {
  type: "TURN_STARTED";
  turn: number;
  yourRole: "attacker" | "defender";
  turnDeadline: number;
};

export type OpponentReadyMessage = {
  type: "OPPONENT_READY";
  turn: number;
};

export type ActionConfirmedMessage = {
  type: "ACTION_CONFIRMED";
  turn: number;
};

export type ActionRejectedMessage = {
  type: "ACTION_REJECTED";
  turn: number;
  reason: string;
};

export type TurnResultMessage = {
  type: "TURN_RESULT";
  turn: number;
  attackerAction: { type: "ATTACK"; direction: Direction } | null;
  defenderAction:
    | { type: "DODGE"; direction: Direction }
    | { type: "COUNTER"; direction: Direction }
    | null;
  result: TurnOutcome;
  attackerDamage: number;
  defenderDamage: number;
  attackerHpAfter: number;
  defenderHpAfter: number;
  attackerId: string;
  defenderId: string;
};

export type MatchFinishedMessage = {
  type: "MATCH_FINISHED";
  winnerId: string | null;
  loserId: string | null;
  finalHp: Record<string, number>;
};

export type OpponentDisconnectedMessage = {
  type: "OPPONENT_DISCONNECTED";
  reconnectTimeoutMs: number;
};

export type OpponentReconnectedMessage = {
  type: "OPPONENT_RECONNECTED";
};

export type TimeWarningMessage = {
  type: "TIME_WARNING";
  turn: number;
  remainingMs: number;
};

export type ErrorMessage = {
  type: "ERROR";
  message: string;
  code: string;
};

export type PongMessage = {
  type: "PONG";
};

export type ServerMessage =
  | MatchStateMessage
  | MatchFoundMessage
  | TurnStartedMessage
  | OpponentReadyMessage
  | ActionConfirmedMessage
  | ActionRejectedMessage
  | TurnResultMessage
  | MatchFinishedMessage
  | OpponentDisconnectedMessage
  | OpponentReconnectedMessage
  | TimeWarningMessage
  | ErrorMessage
  | PongMessage;
