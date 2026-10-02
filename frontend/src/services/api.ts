/**
 * API service for HTTP calls to the Worker backend.
 */

const API_BASE = "";

export async function createMatch(): Promise<{ matchId: string }> {
  const res = await fetch(`${API_BASE}/api/match/create`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to create match");
  return res.json();
}

export function buildWebSocketUrl(
  matchId: string,
  playerId: string,
  displayName: string
): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  const params = new URLSearchParams({
    playerId,
    displayName,
    matchId,
  });
  return `${proto}//${host}/ws/match/${matchId}?${params}`;
}

export function generatePlayerId(): string {
  return crypto.randomUUID();
}
