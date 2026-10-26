// LANX 2.13.0: a die drawn as a real cube (CSS 3D) that tumbles to its value.
// `rollKey` changes with every roll, so the same number twice still tumbles.
import { useEffect, useState } from "react";

const PIPS: Record<number, number[]> = { 1: [4], 2: [2, 6], 3: [2, 4, 6], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
export const DIE_GLYPH = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
/** How far the cube turns (X, Y) to bring a face to the front. */
const SHOW: Record<number, [number, number]> = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] };
/** Where each face sits on the cube: 1 front, 6 back, 3 right, 4 left, 2 top, 5 bottom. */
const FACES: { v: number; t: string }[] = [
  { v: 1, t: "translateZ(var(--h))" },
  { v: 6, t: "rotateY(180deg) translateZ(var(--h))" },
  { v: 3, t: "rotateY(90deg) translateZ(var(--h))" },
  { v: 4, t: "rotateY(-90deg) translateZ(var(--h))" },
  { v: 2, t: "rotateX(90deg) translateZ(var(--h))" },
  { v: 5, t: "rotateX(-90deg) translateZ(var(--h))" },
];

export function Dice3D({ value, size = 36, rollKey, testId }: { value: number; size?: number; rollKey?: string | number; testId?: string }) {
  const [turns, setTurns] = useState(0);
  useEffect(() => {
    setTurns((t) => t + 1);
  }, [rollKey, value]);
  const v = Math.max(1, Math.min(6, Math.round(value) || 1));
  const [rx, ry] = SHOW[v];
  return (
    <span className="g3-dice" data-die={v} data-testid={testId} style={{ width: size, height: size, ["--h" as string]: `${size / 2}px` }} title={`${v}`}>
      <span className="g3-dice-cube" style={{ transform: `rotateX(${rx + 720 * turns}deg) rotateY(${ry + 1080 * turns}deg)` }}>
        {FACES.map((f) => (
          <span key={f.v} className="g3-dice-face" style={{ transform: f.t }}>
            {Array.from({ length: 9 }, (_, i) => (PIPS[f.v].includes(i) ? <i key={i} /> : <b key={i} />))}
          </span>
        ))}
      </span>
      <span className="sr-only">{DIE_GLYPH[v]}</span>
    </span>
  );
}
