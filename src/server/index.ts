/**
 * Cloudflare Worker entry point.
 * Routes HTTP requests and WebSocket upgrades to the appropriate handlers.
 */

import { MatchRoom } from "../durable-objects/MatchRoom";
import { MatchmakingQueue } from "../durable-objects/MatchmakingQueue";

export { MatchRoom, MatchmakingQueue };

interface Env {
  MATCH_ROOM: DurableObjectNamespace;
  MATCHMAKING_QUEUE: DurableObjectNamespace;
  DB: D1Database;
}

// ==================== CORS ====================

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function corsResponse(response: Response): Response {
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    newHeaders.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

// ==================== Match ID Generation ====================

function generateMatchId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No confusing chars (0/O, 1/I)
  let id = "";
  for (let i = 0; i < 4; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// ==================== Router ====================

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return corsResponse(new Response(null, { status: 204 }));
    }

    try {
      // ---- WebSocket: match connection ----
      if (url.pathname.startsWith("/ws/match/")) {
        const matchId = url.pathname.split("/")[3];
        if (!matchId) {
          return corsResponse(
            new Response("Missing matchId", { status: 400 })
          );
        }

        // Route to the MatchRoom DO for this match
        const doId = env.MATCH_ROOM.idFromName(matchId);
        const stub = env.MATCH_ROOM.get(doId);

        // Forward the request (including WebSocket upgrade) to the DO
        return stub.fetch(request);
      }

      // ---- WebSocket: matchmaking queue ----
      if (url.pathname === "/ws/matchmaking") {
        const doId = env.MATCHMAKING_QUEUE.idFromName("global-queue");
        const stub = env.MATCHMAKING_QUEUE.get(doId);
        return stub.fetch(request);
      }

      // ---- HTTP: create match ----
      if (
        url.pathname === "/api/match/create" &&
        request.method === "POST"
      ) {
        const matchId = generateMatchId();
        return corsResponse(
          Response.json({ matchId }, { status: 201 })
        );
      }

      // ---- HTTP: match state (debug) ----
      if (
        url.pathname.startsWith("/api/match/") &&
        request.method === "GET"
      ) {
        const matchId = url.pathname.split("/")[3];
        if (!matchId) {
          return corsResponse(
            new Response("Missing matchId", { status: 400 })
          );
        }

        const doId = env.MATCH_ROOM.idFromName(matchId);
        const stub = env.MATCH_ROOM.get(doId);

        const stateUrl = new URL(request.url);
        stateUrl.pathname = "/state";

        return corsResponse(await stub.fetch(stateUrl.toString()));
      }

      // ---- HTTP: leaderboard ----
      if (url.pathname === "/api/leaderboard" && request.method === "GET") {
        const result = await env.DB.prepare(`
          SELECT player_id, display_name, wins, losses, total_matches, current_streak, best_streak, points 
          FROM leaderboard 
          ORDER BY points DESC, wins DESC 
          LIMIT 10
        `).all();
        
        return corsResponse(
          Response.json({ leaderboard: result.results }, { status: 200 })
        );
      }

      // ---- HTTP: health check ----
      if (url.pathname === "/api/health") {
        return corsResponse(
          Response.json({
            status: "ok",
            timestamp: new Date().toISOString(),
          })
        );
      }

      // ---- 404 ----
      return corsResponse(
        new Response("Not found", { status: 404 })
      );
    } catch (error) {
      console.error("Worker error:", error);
      return corsResponse(
        Response.json(
          {
            error: "Internal server error",
            message:
              error instanceof Error ? error.message : "Unknown error",
          },
          { status: 500 }
        )
      );
    }
  },
};
