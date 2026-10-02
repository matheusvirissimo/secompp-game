import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Home } from "./pages/Home";
import { Battle } from "./pages/Battle";
import { Leaderboard } from "./pages/Leaderboard";
import { Admin } from "./pages/Admin";
import { Featured } from "./pages/Featured";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/join/:joinCode" element={<Home />} />
        <Route path="/battle/:matchId" element={<Battle />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/featured" element={<Featured />} />
      </Routes>
    </BrowserRouter>
  );
}
