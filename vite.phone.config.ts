import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";

// LANX 3.0: the page a phone opens from this PC ("Use on your phone"). It is
// built into src-tauri/phone-dist and embedded in lanx.exe, which serves it on
// the office network (src-tauri/src/phone/http.rs). `npm run build:phone`.
//
// `npm run dev:phone` serves it from Vite against a running LANX copy
// (LANX_PHONE_TARGET=http://127.0.0.1:52930 by default).
const target = process.env.LANX_PHONE_TARGET || "http://127.0.0.1:52930";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  publicDir: false,
  clearScreen: false,
  build: {
    outDir: "src-tauri/phone-dist",
    emptyOutDir: true,
    rollupOptions: {
      // The page, the service worker as its own file at the root (/sw.js), and
      // (3.4) the recorder's timer worker (/lanx-ticker.js, as on the PC).
      input: { phone: "phone.html", sw: "src/phone/sw.js", "lanx-ticker": "public/lanx-ticker.js" },
      output: {
        entryFileNames: (chunk) => (chunk.name === "sw" ? "sw.js" : chunk.name === "lanx-ticker" ? "lanx-ticker.js" : "assets/[name]-[hash].js"),
      },
    },
    // Fonts and pictures stay files (the server embeds every file in the folder).
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  server: {
    port: 1430,
    strictPort: true,
    proxy: {
      "/api": target,
      "/ws": { target: target.replace(/^http/, "ws"), ws: true },
    },
  },
});
