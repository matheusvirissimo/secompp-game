import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";

export function Admin() {
  const navigate = useNavigate();
  const [token, setToken] = useState(localStorage.getItem("adminToken") || "");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [matches, setMatches] = useState<any[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const proto = window.location.protocol === "https:" ? "https:" : "http:";
    const host = window.location.host;
    const res = await fetch(`${proto}//${host}/api/admin/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: token })
    });
    if (res.ok) {
      localStorage.setItem("adminToken", token);
      setIsAuthenticated(true);
      connectWebSocket(token);
    } else {
      alert("Senha incorreta");
    }
  };

  const connectWebSocket = (authToken: string) => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const ws = new WebSocket(`${proto}//${host}/ws/admin?token=${authToken}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "ADMIN_STATE") {
          setMatches(data.matches);
        }
      } catch (e) {}
    };
    
    ws.onclose = () => {
      setIsAuthenticated(false);
    };
  };

  useEffect(() => {
    if (token) {
      // Try auto login
      handleLogin({ preventDefault: () => {} } as React.FormEvent);
    }
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const featureMatch = async (matchId: string) => {
    const proto = window.location.protocol === "https:" ? "https:" : "http:";
    const host = window.location.host;
    await fetch(`${proto}//${host}/api/admin/feature`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": token },
      body: JSON.stringify({ matchId })
    });
  };

  if (!isAuthenticated) {
    return (
      <div className="page">
        <h1 className="home-title">Admin Login</h1>
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', maxWidth: '300px' }}>
          <input 
            className="input" 
            type="password" 
            placeholder="Senha do Admin" 
            value={token} 
            onChange={e => setToken(e.target.value)} 
          />
          <button className="btn btn-primary" type="submit">Entrar</button>
        </form>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <h1 className="home-title">Painel Admin</h1>
        <button className="btn btn-secondary" onClick={() => {
          localStorage.removeItem("adminToken");
          if (wsRef.current) wsRef.current.close();
          setIsAuthenticated(false);
        }}>Sair</button>
      </div>

      <div className="divider">PARTIDAS AO VIVO ({matches.length})</div>

      <div style={{ display: 'grid', gap: '1rem', width: '100%' }}>
        {matches.map(m => (
          <div key={m.matchId} style={{ 
            background: 'var(--bg-light)', 
            padding: '1rem', 
            borderRadius: '8px',
            border: m.featured ? '2px solid var(--primary)' : '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div>
              <div style={{ fontSize: '0.8rem', color: 'var(--primary)', marginBottom: '0.5rem' }}>
                SALA: {m.matchId} {m.featured && "⭐ DESTAQUE"}
              </div>
              <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>
                {m.p1Name} (HP: {m.p1Hp}) vs {m.p2Name} (HP: {m.p2Hp})
              </div>
              <div style={{ fontSize: '0.9rem', color: '#666', marginTop: '0.25rem' }}>
                Turno Atual: {m.turn}
              </div>
            </div>
            <div>
              <button 
                className={`btn ${m.featured ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}
                onClick={() => featureMatch(m.matchId)}
                disabled={m.featured}
              >
                {m.featured ? 'Em Destaque' : 'Destacar'}
              </button>
            </div>
          </div>
        ))}
        {matches.length === 0 && (
          <p className="status-text">Nenhuma partida acontecendo no momento.</p>
        )}
      </div>
    </div>
  );
}
