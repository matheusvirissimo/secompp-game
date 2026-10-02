import { useState, useRef, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createMatch, generatePlayerId, buildMatchmakingUrl } from "../services/api";

export function Home() {
  const navigate = useNavigate();
  const { joinCode } = useParams<{ joinCode?: string }>();
  
  const [displayName, setDisplayName] = useState(
    localStorage.getItem("displayName") || ""
  );
  const [matchId, setMatchId] = useState(joinCode || "");
  const [loading, setLoading] = useState(false);
  
  const [isSearching, setIsSearching] = useState(false);
  const queueWsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    return () => {
      if (queueWsRef.current) {
        queueWsRef.current.close();
      }
    };
  }, []);

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

  const handleMatchmaking = () => {
    if (!displayName) return;
    initUser();
    setIsSearching(true);
    
    const playerId = localStorage.getItem("playerId")!;
    const sessionToken = localStorage.getItem("sessionToken")!;
    const url = buildMatchmakingUrl(playerId, displayName, sessionToken);
    
    const ws = new WebSocket(url);
    queueWsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "MATCH_FOUND_IN_QUEUE") {
          setIsSearching(false);
          ws.close();
          navigate(`/battle/${data.matchId}`);
        }
      } catch (e) {}
    };

    ws.onclose = () => {
      setIsSearching(false);
    };
  };

  const cancelMatchmaking = () => {
    if (queueWsRef.current) {
      queueWsRef.current.close();
      queueWsRef.current = null;
    }
    setIsSearching(false);
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
      alert("Falha ao criar a sala");
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = () => {
    if (!displayName || !matchId) return;
    initUser();
    navigate(`/battle/${matchId}`);
  };

  if (isSearching) {
    return (
      <div className="page">
        <h1 className="home-title">Buscando Oponente...</h1>
        <div className="waiting-spinner" />
        <button className="btn btn-secondary" onClick={cancelMatchmaking} style={{ marginTop: "2rem" }}>
          Cancelar Busca
        </button>
      </div>
    );
  }

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

      <div className="divider">JOGAR AGORA</div>
      
      <button 
        className="btn btn-primary" 
        onClick={handleMatchmaking}
        disabled={!displayName}
      >
        Procurar Partida
      </button>

      <div className="divider">SALA PRIVADA</div>

      <button 
        className="btn btn-secondary" 
        onClick={handleCreate}
        disabled={!displayName || loading}
        style={{ marginBottom: "1rem" }}
      >
        {loading ? "Criando..." : "Criar Sala"}
      </button>

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

      <div className="divider" style={{ marginTop: '2rem' }}></div>

      <button 
        className="btn" 
        onClick={() => navigate('/leaderboard')}
        style={{ background: 'var(--text)', color: 'var(--bg)', marginTop: '0.5rem' }}
      >
        🏆 Ver Ranking
      </button>
    </div>
  );
}
