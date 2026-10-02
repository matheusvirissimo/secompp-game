import { GAME_CONFIG } from "../../../src/game/config";

interface HealthBarProps {
  hp: number;
  maxHp?: number;
}

export function HealthBar({ hp, maxHp = GAME_CONFIG.INITIAL_HP }: HealthBarProps) {
  return (
    <div className="health-bar">
      {Array.from({ length: maxHp }, (_, i) => (
        <span
          key={i}
          className={`heart ${i >= hp ? "lost" : ""}`}
        >
          ❤️
        </span>
      ))}
    </div>
  );
}
