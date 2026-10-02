import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerMessage, ClientMessage } from "@shared/protocol";
import type { Direction, MatchPhase, TurnOutcome } from "@game/types";
import { buildWebSocketUrl } from "../services/api";

// ==================== Types ====================

export interface MatchPlayer {
  playerId: string;
  displayName: string;
  hp: number;
  role: "attacker" | "defender" | "none";
}

export interface TurnResultData {
  turn: number;
  outcome: TurnOutcome;
  attackerAction: { type: "ATTACK"; direction: Direction } | null;
  defenderAction: { type: string; direction: Direction } | null;
  attackerDamage: number;
  defenderDamage: number;
  attackerId: string;
  defenderId: string;
}

export interface MatchState {
  phase: MatchPhase | "CONNECTING" | "DISCONNECTED";
  matchId: string;
  turn: number;
  you: MatchPlayer | null;
  opponent: MatchPlayer | null;
  turnDeadline: number | null;
  yourActionLocked: boolean;
  opponentReady: boolean;
  lastTurnResult: TurnResultData | null;
  winnerId: string | null;
  loserId: string | null;
  error: string | null;
}

const initialState: MatchState = {
  phase: "CONNECTING",
  matchId: "",
  turn: 0,
  you: null,
  opponent: null,
  turnDeadline: null,
  yourActionLocked: false,
  opponentReady: false,
  lastTurnResult: null,
  winnerId: null,
  loserId: null,
  error: null,
};

// ==================== Hook ====================

export function useMatch(
  matchId: string,
  playerId: string,
  displayName: string,
  sessionToken: string
) {
  const [state, setState] = useState<MatchState>({ ...initialState, matchId });
  const wsRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // Connect WebSocket
  useEffect(() => {
    if (!matchId || !playerId || !displayName || !sessionToken) return;

    const url = buildWebSocketUrl(matchId, playerId, displayName, sessionToken);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setState((s) => ({ ...s, phase: "WAITING" as MatchPhase }));

      // Start ping interval
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "PING" }));
        }
      }, 30_000);
    };

    ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);
        handleMessage(msg);
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onerror = () => {
      setState((s) => ({
        ...s,
        phase: "DISCONNECTED" as any,
        error: "Connection error",
      }));
    };

    ws.onclose = () => {
      setState((s) => {
        if (s.phase === "FINISHED") return s; // Don't overwrite finished state
        return { ...s, phase: "DISCONNECTED" as any, error: "Disconnected" };
      });
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
    };

    return () => {
      ws.close();
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
    };
  }, [matchId, playerId, displayName]);

  // Message handler
  const handleMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "MATCH_STATE":
        setState((s) => ({
          ...s,
          phase: msg.state,
          matchId: msg.matchId,
          turn: msg.turn,
          you: msg.you,
          opponent: msg.opponent,
          turnDeadline: msg.turnDeadline,
          yourActionLocked: msg.yourActionLocked,
        }));
        break;

      case "MATCH_FOUND":
        setState((s) => ({
          ...s,
          phase: "READY",
          opponent: {
            playerId: msg.opponent.playerId,
            displayName: msg.opponent.displayName,
            hp: s.opponent?.hp ?? 3,
            role: "none",
          },
        }));
        break;

      case "TURN_STARTED":
        setState((s) => ({
          ...s,
          phase: "PLAYING",
          turn: msg.turn,
          turnDeadline: msg.turnDeadline,
          yourActionLocked: false,
          opponentReady: false,
          lastTurnResult: null,
          you: s.you
            ? { ...s.you, role: msg.yourRole }
            : null,
          opponent: s.opponent
            ? {
                ...s.opponent,
                role: msg.yourRole === "attacker" ? "defender" : "attacker",
              }
            : null,
        }));
        break;

      case "ACTION_CONFIRMED":
        setState((s) => ({ ...s, yourActionLocked: true }));
        break;

      case "ACTION_REJECTED":
        setState((s) => ({ ...s, error: msg.reason }));
        // Clear error after 3 seconds
        setTimeout(() => {
          setState((s) => ({ ...s, error: null }));
        }, 3000);
        break;

      case "OPPONENT_READY":
        setState((s) => ({ ...s, opponentReady: true }));
        break;

      case "TURN_RESULT":
        setState((s) => ({
          ...s,
          phase: "RESOLVING",
          lastTurnResult: {
            turn: msg.turn,
            outcome: msg.result,
            attackerAction: msg.attackerAction,
            defenderAction: msg.defenderAction,
            attackerDamage: msg.attackerDamage,
            defenderDamage: msg.defenderDamage,
            attackerId: msg.attackerId,
            defenderId: msg.defenderId,
          },
          you: s.you
            ? {
                ...s.you,
                hp:
                  s.you.playerId === msg.attackerId
                    ? msg.attackerHpAfter
                    : msg.defenderHpAfter,
              }
            : null,
          opponent: s.opponent
            ? {
                ...s.opponent,
                hp:
                  s.opponent.playerId === msg.attackerId
                    ? msg.attackerHpAfter
                    : msg.defenderHpAfter,
              }
            : null,
        }));
        break;

      case "MATCH_FINISHED":
        setState((s) => ({
          ...s,
          phase: "FINISHED",
          winnerId: msg.winnerId,
          loserId: msg.loserId,
        }));
        break;

      case "OPPONENT_DISCONNECTED":
        setState((s) => ({
          ...s,
          phase: "WAITING_RECONNECT",
          error: "Adversário desconectou...",
        }));
        break;

      case "OPPONENT_RECONNECTED":
        setState((s) => ({
          ...s,
          error: null,
        }));
        break;

      case "ERROR":
        setState((s) => ({ ...s, error: msg.message }));
        break;

      case "PONG":
        // Heartbeat response, nothing to do
        break;
    }
  }, []);

  // Send action
  const sendAction = useCallback(
    (action: { type: string; direction: Direction }) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const message: ClientMessage = {
        type: "ACTION",
        matchId: state.matchId,
        turn: state.turn,
        action: action as any,
      };

      ws.send(JSON.stringify(message));
    },
    [state.matchId, state.turn]
  );

  return { state, sendAction };
}
