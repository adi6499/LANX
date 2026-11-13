// LANX 3.12.0: textures for the board games — printed cardboard and wood — painted once on a
// canvas and kept as small pictures. Pictures are cheap to draw again and again (an SVG noise
// filter is not, least of all on Linux), so boards stay smooth while pieces move.

const cache = new Map<string, string>();
let seed = 1;
const rand = () => {
  // A fixed sequence: the texture looks the same every time.
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

function paint(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): string {
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    if (!g) return "";
    seed = 7;
    draw(g);
    const url = c.toDataURL("image/png");
    cache.set(key, url);
    return url;
  } catch {
    return "";
  }
}

/** Printed cardboard: a fine grain and a few paper fibres, see-through (lay it over the print). */
export function paperTexture(): string {
  return paint("paper", 256, 256, (g) => {
    for (let i = 0; i < 6000; i++) {
      const dark = rand() < 0.55;
      g.fillStyle = dark ? `rgba(90,70,40,${0.018 + rand() * 0.03})` : `rgba(255,255,255,${0.04 + rand() * 0.06})`;
      g.fillRect(rand() * 256, rand() * 256, 1 + rand(), 1 + rand());
    }
    g.lineCap = "round";
    for (let i = 0; i < 60; i++) {
      const x = rand() * 256, y = rand() * 256, a = rand() * Math.PI, l = 4 + rand() * 10;
      g.strokeStyle = `rgba(120,95,60,${0.05 + rand() * 0.06})`;
      g.lineWidth = 0.5 + rand() * 0.5;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + rand() * 2, y + Math.sin(a) * l * 0.5 + rand() * 2, x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
  });
}

/** Wood with its grain running along (x): `tone` "walnut" (a table, a frame) or "maple" (light). */
export function woodTexture(tone: "walnut" | "maple" = "walnut"): string {
  const [base, lightC, darkC] = tone === "walnut" ? ["#7a4a24", "rgba(196,140,82,", "rgba(52,28,10,"] : ["#d9a96a", "rgba(255,230,190,", "rgba(140,90,40,"];
  return paint(`wood-${tone}`, 512, 256, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, 512, 256);
    // Broad bands, then fine grain lines that wander a little, then pores.
    for (let i = 0; i < 14; i++) {
      const y = rand() * 256, hgt = 8 + rand() * 30;
      const grad = g.createLinearGradient(0, y, 0, y + hgt);
      const c = rand() < 0.5 ? lightC : darkC;
      grad.addColorStop(0, `${c}0)`);
      grad.addColorStop(0.5, `${c}${0.1 + rand() * 0.12})`);
      grad.addColorStop(1, `${c}0)`);
      g.fillStyle = grad;
      g.fillRect(0, y, 512, hgt);
    }
    for (let i = 0; i < 120; i++) {
      const y0 = rand() * 256, amp = 1 + rand() * 4, freq = 0.004 + rand() * 0.012, ph = rand() * 6;
      g.strokeStyle = rand() < 0.6 ? `${darkC}${0.08 + rand() * 0.16})` : `${lightC}${0.06 + rand() * 0.1})`;
      g.lineWidth = 0.4 + rand() * 1.2;
      g.beginPath();
      for (let x = 0; x <= 512; x += 8) {
        const y = y0 + Math.sin(x * freq + ph) * amp + Math.sin(x * freq * 3.1 + ph * 2) * amp * 0.3;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = `${darkC}${0.12 + rand() * 0.2})`;
      g.fillRect(rand() * 512, rand() * 256, 1 + rand() * 3, 0.6);
    }
  });
}
