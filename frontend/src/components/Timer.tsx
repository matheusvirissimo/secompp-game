import { useEffect, useState } from "react";
import { GAME_CONFIG } from "../../../src/game/config";

interface TimerProps {
  deadline: number | null;
}

export function Timer({ deadline }: TimerProps) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!deadline) {
      setRemaining(null);
      return;
    }

    const update = () => {
      const ms = Math.max(0, deadline - Date.now());
      setRemaining(ms);
    };

    update();
    const interval = setInterval(update, 100);
    return () => clearInterval(interval);
  }, [deadline]);

  if (remaining === null) return null;

  const seconds = Math.ceil(remaining / 1000);
  const isWarning = remaining <= GAME_CONFIG.TURN_WARNING_MS;
  const isCritical = remaining <= 3000;

  return (
    <div
      className={`timer ${isCritical ? "critical" : isWarning ? "warning" : ""}`}
    >
      ⏱ {seconds}s
    </div>
  );
}
