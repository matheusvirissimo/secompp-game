#!/usr/bin/env node

/**
 * CLI script to simulate a match between two players.
 * Run with: npm run simulate
 */

import {
  simulateMatch,
  formatMatchLog,
  randomStrategy,
  fixedStrategy,
} from "./simulation";

console.log("");
console.log("🎮 Multiplayer Battle Game — Simulação Local");
console.log("");

// Simulate a random match
const record = simulateMatch({
  playerA: { id: "player-a", displayName: "Matheus" },
  playerB: { id: "player-b", displayName: "Lucas" },
  strategyA: randomStrategy(),
  strategyB: randomStrategy(),
});

console.log(formatMatchLog(record));

// Run a few more quick matches for statistics
console.log("");
console.log("───────────────────────────────────────");
console.log("  Quick Stats: 50 random matches");
console.log("───────────────────────────────────────");

let aWins = 0;
let bWins = 0;
let draws = 0;
let aborted = 0;
let totalTurns = 0;

for (let i = 0; i < 50; i++) {
  const r = simulateMatch({
    playerA: { id: "a", displayName: "A" },
    playerB: { id: "b", displayName: "B" },
    strategyA: randomStrategy(),
    strategyB: randomStrategy(),
  });

  if (r.winnerId === "a") aWins++;
  else if (r.winnerId === "b") bWins++;
  else if (r.finishReason === "INACTIVITY") aborted++;
  else draws++;

  totalTurns += r.totalTurns;
}

console.log(`  Player A wins: ${aWins}`);
console.log(`  Player B wins: ${bWins}`);
console.log(`  Draws:         ${draws}`);
console.log(`  Aborted:       ${aborted}`);
console.log(`  Avg turns:     ${(totalTurns / 50).toFixed(1)}`);
console.log("───────────────────────────────────────");
console.log("");
