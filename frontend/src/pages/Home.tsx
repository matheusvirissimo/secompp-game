import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createMatch, generatePlayerId } from "../services/api";

export function Home() {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(
    localStorage.getItem("displayName") || ""
  );
  const [matchId, setMatchId] = useState("");
  const [loading, setLoading] = useState(false);

  const initUser = () => {
    localStorage.setItem("displayName", displayName);
    let playerId = localStorage.getItem("playerId");
    if (!playerId) {
      playerId = generatePlayerId();
      localStorage.setItem("playerId", playerId);
    }
    let sessionToken = localStorage.getItem("sessionToken");
    if (!sessionToken) {
      sessionToken = crypto.randomUUID();
      localStorage.setItem("sessionToken", sessionToken);
    }
  };

  const handleCreate = async () => {
    if (!displayName) return;
    initUser();
    
    setLoading(true);
    try {
      const { matchId: newMatchId } = await createMatch();
      navigate(`/battle/${newMatchId}`);
    } catch (e) {
      console.error(e);
      alert("Falha ao criar a partida");
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = () => {
    if (!displayName || !matchId) return;
    initUser();
    navigate(`/battle/${matchId}`);
  };

  return (
    <div className="page">
      <h1 className="home-title">SECOMPP Battle</h1>
      <p className="home-subtitle">Arena Multiplayer</p>

      <input
        className="input"
        placeholder="Seu nome"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
      />

      <div className="divider">NOVA PARTIDA</div>
      
      <button 
        className="btn btn-primary" 
        onClick={handleCreate}
        disabled={!displayName || loading}
      >
        {loading ? "Criando..." : "Criar Partida"}
      </button>

      <div className="divider">ENTRAR</div>

      <input
        className="input"
        placeholder="Código da sala"
        value={matchId}
        onChange={(e) => setMatchId(e.target.value.toUpperCase())}
      />
      
      <button 
        className="btn btn-secondary" 
        onClick={handleJoin}
        disabled={!displayName || !matchId}
      >
        Entrar na Sala
      </button>
    </div>
  );
}
