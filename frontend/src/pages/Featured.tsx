import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { HealthBar } from "../components/HealthBar";
import { Timer } from "../components/Timer";
import { ServerMessage } from "@shared/protocol";

export function Featured() {
  const [matchId, setMatchId] = useState<string | null>(null);
  const [state, setState] = useState<any>({ phase: "WAITING" });
  const wsRef = useRef<WebSocket | null>(null);
  const registryWsRef = useRef<WebSocket | null>(null);

  // 1. Connect to AdminRegistry to get current featured match
  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const ws = new WebSocket(`${proto}//${host}/ws/featured`);
    registryWsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "FEATURED_MATCH") {
          setMatchId(data.matchId);
        }
      } catch (e) {}
    };

    return () => {
      ws.close();
    };
  }, []);

  // 2. Connect to the featured MatchRoom as spectator
  useEffect(() => {
    if (!matchId) return;

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const ws = new WebSocket(`${proto}//${host}/ws/match/${matchId}?spectator=true`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        
        // Simple state reducer for spectator
        if (msg.type === "MATCH_STATE") {
          setState((s: any) => ({ ...s, ...msg, phase: msg.state }));
        } else if (msg.type === "TURN_STARTED") {
          setState((s: any) => ({
            ...s,
            phase: "PLAYING",
            turn: msg.turn,
            turnDeadline: msg.turnDeadline,
            lastTurnResult: null
          }));
        } else if (msg.type === "TURN_RESULT") {
          setState((s: any) => ({
            ...s,
            phase: "RESOLVING",
            lastTurnResult: msg,
            you: { ...s.you, hp: s.you.playerId === msg.attackerId ? msg.attackerHpAfter : msg.defenderHpAfter },
            opponent: { ...s.opponent, hp: s.opponent.playerId === msg.attackerId ? msg.attackerHpAfter : msg.defenderHpAfter }
          }));
        } else if (msg.type === "MATCH_FINISHED") {
          setState((s: any) => ({ ...s, phase: "FINISHED" }));
        }
      } catch (e) {}
    };

    return () => {
      ws.close();
    };
  }, [matchId]);

  if (!matchId) {
    return (
      <div className="page" style={{ justifyContent: 'center' }}>
        <h1 className="home-title" style={{ fontSize: '3rem' }}>SECOMPP BATTLE</h1>
        <p className="status-text" style={{ fontSize: '1.5rem', marginTop: '2rem' }}>Aguardando partida em destaque...</p>
        <div className="waiting-spinner" style={{ width: '60px', height: '60px', marginTop: '2rem' }} />
      </div>
    );
  }

  const p1 = state.you;
  const p2 = state.opponent;

  return (
    <div className="battle" style={{ transform: 'scale(1.2)', transformOrigin: 'top center', padding: '2rem' }}>
      <h1 className="home-title" style={{ marginBottom: '2rem', textShadow: '0 0 10px var(--primary)' }}>SALA {matchId}</h1>
      
      <div className="battle-header" style={{ marginBottom: '3rem' }}>
        <div className="player-info" style={{ alignItems: 'flex-start' }}>
          <div className="player-name" style={{ fontSize: '2rem' }}>{p1?.displayName || "?"}</div>
          <HealthBar hp={p1?.hp ?? 3} />
        </div>
        <div className="vs" style={{ fontSize: '3rem' }}>VS</div>
        <div className="player-info" style={{ alignItems: 'flex-end' }}>
          <div className="player-name" style={{ fontSize: '2rem' }}>{p2?.displayName || "?"}</div>
          <HealthBar hp={p2?.hp ?? 3} />
        </div>
      </div>

      <Timer deadline={state.turnDeadline} />

      <div style={{ textAlign: 'center', marginTop: '2rem', fontSize: '1.5rem', fontWeight: 'bold' }}>
        TURNO {state.turn || 1}
      </div>

      {state.phase === "PLAYING" && (
        <div className="action-panel" style={{ border: 'none', background: 'transparent' }}>
          <div className="waiting-spinner" style={{ width: '80px', height: '80px' }} />
          <p className="status-text" style={{ fontSize: '1.2rem', marginTop: '1rem' }}>Os jogadores estão decidindo...</p>
        </div>
      )}

      {state.phase === "RESOLVING" && state.lastTurnResult && (
        <div className="action-panel" style={{ transform: 'scale(1.3)' }}>
          <div className="turn-result">
            <div className="result-outcome" style={{ fontSize: '2rem' }}>{state.lastTurnResult.outcome.replace("_", " ")}</div>
            <div className="result-detail" style={{ fontSize: '1.2rem', lineHeight: '1.8' }}>
              Ataque: {state.lastTurnResult.attackerAction?.direction || "Timeout"} <br/>
              Defesa: {state.lastTurnResult.defenderAction ? `${state.lastTurnResult.defenderAction.type} ${state.lastTurnResult.defenderAction.direction}` : "Timeout"}
            </div>
          </div>
        </div>
      )}

      {state.phase === "FINISHED" && (
        <div className="action-panel" style={{ background: 'var(--primary)', color: 'white', border: 'none', padding: '3rem' }}>
          <h1 style={{ fontSize: '3rem', margin: 0 }}>PARTIDA FINALIZADA</h1>
        </div>
      )}
    </div>
  );
}
