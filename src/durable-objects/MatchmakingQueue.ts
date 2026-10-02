import { DurableObject } from "cloudflare:workers";

interface QueueEntry {
  playerId: string;
  ws: WebSocket;
}

export class MatchmakingQueue extends DurableObject {
  private queue: QueueEntry[] = [];

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") === "websocket") {
      const url = new URL(request.url);
      const playerId = url.searchParams.get("playerId");
      if (!playerId) return new Response("Missing playerId", { status: 400 });

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      this.ctx.acceptWebSocket(server, [playerId]);
      
      // Remove any existing entry for this player
      this.queue = this.queue.filter(e => e.playerId !== playerId);
      
      this.queue.push({ playerId, ws: server });
      
      console.log(`[Queue] Player joined: ${playerId}. Queue size: ${this.queue.length}`);

      this.tryMatch();

      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("Not found", { status: 404 });
  }
  
  async webSocketClose(ws: WebSocket) {
    const tags = this.ctx.getTags(ws);
    const playerId = tags[0];
    if (playerId) {
      this.queue = this.queue.filter(e => e.playerId !== playerId);
      console.log(`[Queue] Player left: ${playerId}. Queue size: ${this.queue.length}`);
    }
  }

  async webSocketError(ws: WebSocket) {
    const tags = this.ctx.getTags(ws);
    const playerId = tags[0];
    if (playerId) {
      this.queue = this.queue.filter(e => e.playerId !== playerId);
    }
  }

  private tryMatch() {
    if (this.queue.length >= 2) {
      const p1 = this.queue.shift()!;
      let p2Idx = this.queue.findIndex(p => p.playerId !== p1.playerId);
      
      if (p2Idx !== -1) {
        const p2 = this.queue.splice(p2Idx, 1)[0];
        
        const matchId = crypto.randomUUID();
        
        console.log(`[Queue] Matched ${p1.playerId} vs ${p2.playerId} -> ${matchId}`);
        
        const msg = JSON.stringify({ type: "MATCH_FOUND_IN_QUEUE", matchId });
        
        try { p1.ws.send(msg); p1.ws.close(1000, "Matched"); } catch {}
        try { p2.ws.send(msg); p2.ws.close(1000, "Matched"); } catch {}
      } else {
        // Only duplicates left in queue, put p1 back
        this.queue.unshift(p1);
      }
    }
  }
}
