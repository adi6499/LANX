import React from "react";
import ReactDOM from "react-dom/client";
// Fonts are bundled with the app so it looks the same with no internet.
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import App from "./App";
import IslandApp from "./IslandApp";
import RemoteBar from "./RemoteBar";
import "./App.css";
import { applyColorStyle, colorStyle } from "./lib/storybook";

// LANX 3.6.0: the last Storybook look straight away (settings load a moment later).
let lastLook: string | null = null;
try {
  lastLook = localStorage.getItem("lanx.colorStyle");
} catch {}
applyColorStyle(colorStyle(lastLook));

// The desktop app has no use for the browser's right-click menu (Reload,
// Inspect...), except in text fields and selected text where Copy/Paste help.
document.addEventListener("contextmenu", (e) => {
  const el = e.target as HTMLElement | null;
  const editable = el?.closest("input, textarea, [contenteditable=true]");
  const hasSelection = !!window.getSelection()?.toString();
  if (!import.meta.env.DEV && !editable && !hasSelection) e.preventDefault();
});

// LANX 1.2.7: the same page also runs in the small "island" window at the
// top of the screen (alerts while LANX is hidden).
const windowLabel = (() => {
  try {
    return (window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } })
      .__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
  } catch {
    return undefined;
  }
})();
const isIsland = windowLabel === "island" || location.hash === "#island";
// LANX 2.0: and in the remote-control Stop bar.
const isRemoteBar = windowLabel === "remote" || location.hash === "#remote";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isIsland ? <IslandApp /> : isRemoteBar ? <RemoteBar /> : <App />}</React.StrictMode>,
);
// LANX 2.5.3: the start-up logo (index.html) goes once the app has drawn.
requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById("lanx-splash")?.remove()));

// LANX 1.3.0: tell LANX the window drew itself (it restarts with a fresh
// WebView2 folder if a window stays blank).
if (!isIsland && !isRemoteBar && "__TAURI_INTERNALS__" in window) {
  requestAnimationFrame(() => {
    void import("@tauri-apps/api/core").then(({ invoke }) => invoke("ui_ready")).catch(() => {});
  });
}
