import { DurableObject } from "cloudflare:workers";

interface ActiveMatch {
  matchId: string;
  p1Name: string;
  p2Name: string;
  p1Hp: number;
  p2Hp: number;
  turn: number;
  featured: boolean;
}

export class AdminRegistry extends DurableObject {
  private matches = new Map<string, ActiveMatch>();
  private adminWebSockets = new Set<WebSocket>();
  private featuredWebSockets = new Set<WebSocket>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal updates from MatchRoom
    if (request.method === "POST") {
      try {
        const body = await request.json() as any;
        
        if (url.pathname === "/internal/register") {
          this.matches.set(body.matchId, {
            matchId: body.matchId,
            p1Name: body.p1Name,
            p2Name: body.p2Name,
            p1Hp: body.p1Hp,
            p2Hp: body.p2Hp,
            turn: body.turn,
            featured: false
          });
          this.broadcast();
          return new Response("OK");
        }
        
        if (url.pathname === "/internal/update") {
          const m = this.matches.get(body.matchId);
          if (m) {
            m.p1Hp = body.p1Hp;
            m.p2Hp = body.p2Hp;
            m.turn = body.turn;
            this.broadcast();
          }
          return new Response("OK");
        }

        if (url.pathname === "/internal/unregister") {
          this.matches.delete(body.matchId);
          this.broadcast();
          this.broadcastFeatured();
          return new Response("OK");
        }

        if (url.pathname === "/internal/feature") {
          const matchId = body.matchId;
          // Unfeature all
          for (const [k, v] of this.matches.entries()) {
            v.featured = (k === matchId);
          }
          this.broadcast();
          this.broadcastFeatured();
          return new Response("OK");
        }

      } catch (e) {
        return new Response("Bad Request", { status: 400 });
      }
    }

    // Admin WebSocket connection
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      
      if (url.pathname === "/ws/featured") {
        this.ctx.acceptWebSocket(server);
        this.featuredWebSockets.add(server);
        
        const featuredMatch = Array.from(this.matches.values()).find(m => m.featured);
        server.send(JSON.stringify({
          type: "FEATURED_MATCH",
          matchId: featuredMatch?.matchId || null
        }));
      } else {
        this.ctx.acceptWebSocket(server);
        this.adminWebSockets.add(server);
        
        server.send(JSON.stringify({
          type: "ADMIN_STATE",
          matches: Array.from(this.matches.values())
        }));
      }

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketClose(ws: WebSocket) {
    this.adminWebSockets.delete(ws);
    this.featuredWebSockets.delete(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.adminWebSockets.delete(ws);
    this.featuredWebSockets.delete(ws);
  }

  private broadcastFeatured() {
    const featuredMatch = Array.from(this.matches.values()).find(m => m.featured);
    const msg = JSON.stringify({
      type: "FEATURED_MATCH",
      matchId: featuredMatch?.matchId || null
    });
    for (const ws of this.featuredWebSockets) {
      try {
        ws.send(msg);
      } catch {
        this.featuredWebSockets.delete(ws);
      }
    }
  }

  private broadcast() {
    const msg = JSON.stringify({
      type: "ADMIN_STATE",
      matches: Array.from(this.matches.values())
    });
    for (const ws of this.adminWebSockets) {
      try {
        ws.send(msg);
      } catch {
        this.adminWebSockets.delete(ws);
      }
    }
  }
}
