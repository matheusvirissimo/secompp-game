import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Home } from "./pages/Home";
import { Battle } from "./pages/Battle";
import { Leaderboard } from "./pages/Leaderboard";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/join/:joinCode" element={<Home />} />
        <Route path="/battle/:matchId" element={<Battle />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
      </Routes>
    </BrowserRouter>
  );
}
