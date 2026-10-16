// Draws the NSIS installer sidebar (164x314) and header (150x57) images and
// writes them as 24-bit BMPs. usage: node make-installer-art.mjs <logo.png> <outDir>
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const [logoPath, outDir] = process.argv.slice(2);
const logo = "data:image/png;base64," + fs.readFileSync(logoPath).toString("base64");

function bmp(width, height, rgba) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + rowSize * height;
  const b = Buffer.alloc(size);
  b.write("BM", 0);
  b.writeUInt32LE(size, 2);
  b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14);
  b.writeInt32LE(width, 18);
  b.writeInt32LE(height, 22);
  b.writeUInt16LE(1, 26);
  b.writeUInt16LE(24, 28);
  b.writeUInt32LE(rowSize * height, 34);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      b[row + x * 3] = rgba[i + 2];
      b[row + x * 3 + 1] = rgba[i + 1];
      b[row + x * 3 + 2] = rgba[i];
    }
  }
  return b;
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();
await page.setContent("<html><body></body></html>");

const draw = async (w, h, kind) =>
  page.evaluate(
    async ([w, h, kind, logo]) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d");
      const img = new Image();
      img.src = logo;
      await img.decode();
      const round = (x, y, ww, hh, r) => {
        g.beginPath();
        g.moveTo(x + r, y);
        g.arcTo(x + ww, y, x + ww, y + hh, r);
        g.arcTo(x + ww, y + hh, x, y + hh, r);
        g.arcTo(x, y + hh, x, y, r);
        g.arcTo(x, y, x + ww, y, r);
        g.closePath();
      };
      if (kind === "sidebar") {
        const bg = g.createLinearGradient(0, 0, w * 0.6, h);
        bg.addColorStop(0, "#38bdf8");
        bg.addColorStop(0.55, "#3b82f6");
        bg.addColorStop(1, "#4f46e5");
        g.fillStyle = bg;
        g.fillRect(0, 0, w, h);
        // soft light blobs
        for (const [x, y, r, a] of [[20, 40, 90, 0.18], [150, 250, 110, 0.14], [120, 120, 60, 0.08]]) {
          const rg = g.createRadialGradient(x, y, 0, x, y, r);
          rg.addColorStop(0, `rgba(255,255,255,${a})`);
          rg.addColorStop(1, "rgba(255,255,255,0)");
          g.fillStyle = rg;
          g.fillRect(0, 0, w, h);
        }
        // network of dots and lines
        const pts = [[26, 238], [62, 214], [104, 236], [138, 206], [82, 262], [128, 280], [40, 286]];
        g.strokeStyle = "rgba(255,255,255,0.35)";
        g.lineWidth = 1.2;
        for (const [a, b] of [[0, 1], [1, 2], [2, 3], [1, 4], [4, 5], [2, 5], [4, 6], [0, 6]]) {
          g.beginPath();
          g.moveTo(...pts[a]);
          g.lineTo(...pts[b]);
          g.stroke();
        }
        g.fillStyle = "rgba(255,255,255,0.9)";
        for (const [x, y] of pts) {
          g.beginPath();
          g.arc(x, y, 3.2, 0, Math.PI * 2);
          g.fill();
        }
        // logo card
        g.shadowColor = "rgba(15,23,42,0.35)";
        g.shadowBlur = 14;
        g.shadowOffsetY = 4;
        round(42, 34, 80, 80, 20);
        g.fillStyle = "#ffffff";
        g.fill();
        g.shadowColor = "transparent";
        g.save();
        round(48, 40, 68, 68, 16);
        g.clip();
        g.drawImage(img, 48, 40, 68, 68);
        g.restore();
        g.fillStyle = "#ffffff";
        g.textAlign = "center";
        g.font = "700 30px 'Segoe UI', sans-serif";
        g.fillText("LANX", w / 2, 152);
        g.font = "500 11.5px 'Segoe UI', sans-serif";
        g.fillStyle = "rgba(255,255,255,0.92)";
        g.fillText("Office chat & file sharing", w / 2, 172);
        g.font = "400 10px 'Segoe UI', sans-serif";
        g.fillStyle = "rgba(255,255,255,0.8)";
        g.fillText("No internet Â· No server", w / 2, 188);
        g.fillText("End-to-end encrypted", w / 2, 201);
      } else {
        g.fillStyle = "#ffffff";
        g.fillRect(0, 0, w, h);
        const bg = g.createLinearGradient(0, 0, w, 0);
        bg.addColorStop(0, "rgba(56,189,248,0.10)");
        bg.addColorStop(1, "rgba(79,70,229,0.18)");
        g.fillStyle = bg;
        g.fillRect(0, 0, w, h);
        g.save();
        round(w - 50, 8, 41, 41, 10);
        g.clip();
        g.drawImage(img, w - 50, 8, 41, 41);
        g.restore();
        g.fillStyle = "#0f172a";
        g.textAlign = "right";
        g.font = "700 18px 'Segoe UI', sans-serif";
        g.fillText("LANX", w - 58, 31);
        g.font = "500 9px 'Segoe UI', sans-serif";
        g.fillStyle = "#475569";
        g.fillText("Office messenger", w - 58, 44);
      }
      return Array.from(g.getImageData(0, 0, w, h).data);
    },
    [w, h, kind, logo]
  );

for (const [name, w, h, kind] of [
  ["installer-sidebar", 164, 314, "sidebar"],
  ["installer-header", 150, 57, "header"],
]) {
  const rgba = await draw(w, h, kind);
  fs.writeFileSync(path.join(outDir, `${name}.bmp`), bmp(w, h, rgba));
  // PNG copy for checking how it looks
  await page.setContent(`<canvas id=c width=${w} height=${h}></canvas>`);
  const png = await page.evaluate(([w, h, data]) => {
    const c = document.getElementById("c");
    const g = c.getContext("2d");
    g.putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
    return c.toDataURL("image/png").split(",")[1];
  }, [w, h, rgba]);
  fs.writeFileSync(path.join(outDir, `${name}.preview.png`), Buffer.from(png, "base64"));
  console.log(`${name}.bmp ${w}x${h}`);
}
await browser.close();

