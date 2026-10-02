import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMatch } from "../hooks/useMatch";
import { DirectionPad } from "../components/DirectionPad";
import { HealthBar } from "../components/HealthBar";
import { Timer } from "../components/Timer";
import { MatchResult } from "../components/MatchResult";

export function Battle() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const [defenseType, setDefenseType] = useState<"DODGE" | "COUNTER">("DODGE");

  const playerId = localStorage.getItem("playerId") || "";
  const displayName = localStorage.getItem("displayName") || "";
  const sessionToken = localStorage.getItem("sessionToken") || "";

  useEffect(() => {
    if (!playerId || !displayName || !sessionToken || !matchId) {
      navigate("/");
    }
  }, [playerId, displayName, sessionToken, matchId, navigate]);

  const { state, sendAction } = useMatch(matchId || "", playerId, displayName, sessionToken);

  if (state.phase === "CONNECTING") {
    return <div className="page"><div className="waiting-spinner" /></div>;
  }

  if (state.phase === "WAITING_RECONNECT") {
    return (
      <div className="page">
        <div className="waiting-spinner" />
        <h2>Aguardando Reconexão</h2>
        <p className="status-text">Oponente desconectou. A partida será retomada se ele voltar em breve.</p>
        <button className="btn btn-secondary" onClick={() => navigate("/")} style={{ marginTop: "2rem" }}>
          Sair da Partida
        </button>
      </div>
    );
  }
  if (state.phase === "DISCONNECTED") {
    return (
      <div className="page">
        <h2>Desconectado</h2>
        <p className="status-text">{state.error || "A conexão com o servidor foi perdida."}</p>
        <button className="btn btn-primary" onClick={() => navigate("/")}>
          Voltar
        </button>
      </div>
    );
  }

  if (state.phase === "WAITING") {
    return (
      <div className="page">
        <div className="waiting-spinner" />
        <p className="status-text">Aguardando adversário...</p>
        <div className="match-code">{matchId}</div>
      </div>
    );
  }

  if (state.phase === "FINISHED") {
    return (
      <div className="page">
        <MatchResult 
          winnerId={state.winnerId} 
          loserId={state.loserId} 
          youId={playerId} 
          onHome={() => navigate("/")} 
        />
      </div>
    );
  }

  // READY, PLAYING, RESOLVING
  const isAttacker = state.you?.role === "attacker";
  
  const handleAction = (direction: any) => {
    if (state.yourActionLocked) return;
    if (isAttacker) {
      sendAction({ type: "ATTACK", direction });
    } else {
      sendAction({ type: defenseType, direction });
    }
  };

  return (
    <div className="battle">
      <div className="battle-header">
        <div className="player-info">
          <div className="player-name is-you">{state.you?.displayName}</div>
          <HealthBar hp={state.you?.hp ?? 3} />
        </div>
        <div className="vs">VS</div>
        <div className="player-info">
          <div className="player-name">{state.opponent?.displayName || "?"}</div>
          <HealthBar hp={state.opponent?.hp ?? 3} />
        </div>
      </div>

      <Timer deadline={state.turnDeadline} />

      <div className={`role-banner ${state.you?.role}`}>
        Você é o {isAttacker ? "Atacante" : "Defensor"}
      </div>

      {state.error && <p className="status-text" style={{color: "var(--danger)"}}>{state.error}</p>}

      {state.phase === "PLAYING" && (
        <div className="action-panel">
          {state.yourActionLocked ? (
            <p className="status-text">Ação registrada! Aguardando oponente...</p>
          ) : (
            <>
              {!isAttacker && (
                <div className="defense-choice">
                  <button 
                    className={`defense-btn dodge ${defenseType === "DODGE" ? "selected" : ""}`}
                    onClick={() => setDefenseType("DODGE")}
                  >
                    DODGE
                  </button>
                  <button 
                    className={`defense-btn counter ${defenseType === "COUNTER" ? "selected" : ""}`}
                    onClick={() => setDefenseType("COUNTER")}
                  >
                    COUNTER
                  </button>
                </div>
              )}
              <DirectionPad onSelect={handleAction} disabled={state.yourActionLocked} />
            </>
          )}
        </div>
      )}

      {state.phase === "RESOLVING" && state.lastTurnResult && (
        <div className="action-panel">
          <div className="turn-result">
            <div className="result-outcome">{state.lastTurnResult.outcome.replace("_", " ")}</div>
            <div className="result-detail">
              Ataque: {state.lastTurnResult.attackerAction?.direction || "Timeout"} <br/>
              Defesa: {state.lastTurnResult.defenderAction ? `${state.lastTurnResult.defenderAction.type} ${state.lastTurnResult.defenderAction.direction}` : "Timeout"}
            </div>
          </div>
        </div>
      )}

      {state.opponentReady && !state.yourActionLocked && (
        <div className="opponent-ready">Oponente já escolheu a ação!</div>
      )}
    </div>
  );
}
