import type { Direction } from "@game/types";

interface DirectionPadProps {
  onSelect: (direction: Direction) => void;
  disabled?: boolean;
}

export function DirectionPad({ onSelect, disabled }: DirectionPadProps) {
  return (
    <div className="direction-pad">
      <button
        className="dir-btn up"
        onClick={() => onSelect("UP")}
        disabled={disabled}
        aria-label="Up"
      >
        ↑
      </button>
      <button
        className="dir-btn left"
        onClick={() => onSelect("LEFT")}
        disabled={disabled}
        aria-label="Left"
      >
        ←
      </button>
      <button
        className="dir-btn right"
        onClick={() => onSelect("RIGHT")}
        disabled={disabled}
        aria-label="Right"
      >
        →
      </button>
      <button
        className="dir-btn down"
        onClick={() => onSelect("DOWN")}
        disabled={disabled}
        aria-label="Down"
      >
        ↓
      </button>
    </div>
  );
}
