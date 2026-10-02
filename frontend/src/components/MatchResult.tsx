interface MatchResultProps {
  winnerId: string | null;
  loserId: string | null;
  youId: string;
  onHome: () => void;
}

export function MatchResult({ winnerId, loserId, youId, onHome }: MatchResultProps) {
  const isWinner = winnerId === youId;
  const isDraw = !winnerId && !loserId;

  return (
    <div className="match-result">
      {isDraw ? (
        <>
          <h2 className="match-result-title draw">EMPATE</h2>
          <p className="status-text">Ambos foram eliminados simultaneamente!</p>
        </>
      ) : isWinner ? (
        <>
          <h2 className="match-result-title win">VITÓRIA!</h2>
          <p className="status-text">Você venceu a batalha!</p>
        </>
      ) : (
        <>
          <h2 className="match-result-title lose">DERROTA</h2>
          <p className="status-text">Você foi derrotado.</p>
        </>
      )}
      <button className="btn btn-primary" onClick={onHome} style={{ marginTop: "2rem" }}>
        Voltar para o Início
      </button>
    </div>
  );
}
