import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Home } from "./pages/Home";
import { Battle } from "./pages/Battle";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/battle/:matchId" element={<Battle />} />
      </Routes>
    </BrowserRouter>
  );
}
