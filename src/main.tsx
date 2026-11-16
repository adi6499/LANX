import React from "react";
import ReactDOM from "react-dom/client";
// Fonts are bundled with the app so it looks the same with no internet.
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./App.css";
import { applyColorStyle, colorStyle } from "./lib/storybook";
import { IS_LINUX } from "./lib/platform";

// LANX 3.6.2: Linux draws a lighter LANX (App.css .lanx-linux): its web engine
// blurs and filters on the processor, which made LANX stutter there.
if (IS_LINUX) document.documentElement.classList.add("lanx-linux");
// LANX 3.12.0: a PC with 4 GB of memory or less draws the same light LANX (App.css
// :is(.lanx-linux, .lanx-lite)): no frosted glass, soft shadows or ever-moving decorations.
// (The window's engine reports the memory, rounded; WebKitGTK doesn't, and Linux is light anyway.)
const memoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
if (typeof memoryGb === "number" && memoryGb > 0 && memoryGb <= 4) document.documentElement.classList.add("lanx-lite");

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
// LANX 3.7.0: and in the hands window (air keyboard over other programs).
const isHud = windowLabel === "hud" || location.hash === "#hud";
const isMain = !isIsland && !isRemoteBar && !isHud;

// LANX 3.12.0: each window loads only its own part. The alert, hands and Stop-bar windows
// used to load (and keep in memory) the whole app — over a megabyte of code each — to show
// one small thing; now they load a few kilobytes.
const Root = React.lazy(
  isIsland
    ? () => import("./IslandApp")
    : isRemoteBar
      ? () => import("./RemoteBar")
      : isHud
        ? () => import("./HudApp")
        : () =>
            // LANX 3.13.0: calls on web engines without RTCPeerConnection (Linux) use LANX's own
            // engine — put in place before anything (the phone camera too) looks for it.
            import("./lib/endTracks")
              // LANX 3.15.0, Linux: ending a camera that is still shown must not freeze the window.
              .then((m) => IS_LINUX && m.installSafeStop())
              .catch(() => false)
              .then(() => import("./lib/ownrtc"))
              .then((m) => m.installOwnRtc())
              .catch(() => false)
              // LANX 3.6.2: the paired phone's camera for calls, meetings and gestures (main window only).
              .then(() => import("./lib/phoneCamera"))
              .then((m) => {
                m.installPhoneCamera();
                return import("./App");
              }),
);

/** LANX 3.17.1: takes the start-up screen (index.html) away, with a short fade. The main
 *  window does this once LANX is really ready (App calls it); until then that one screen
 *  stays, instead of logo → another loading screen → LANX. */
let splashEnded = false;
function endSplash() {
  if (splashEnded) return;
  splashEnded = true;
  let gone = false;
  const go = () => {
    if (gone) return;
    gone = true;
    const el = document.getElementById("lanx-splash");
    if (el) {
      el.classList.add("lanx-splash-out");
      setTimeout(() => el.remove(), 280);
    }
    document.documentElement.classList.remove("lanx-starting");
  };
  // After LANX's first real picture is on screen (a hidden window may get no frames: the timer).
  requestAnimationFrame(() => requestAnimationFrame(go));
  setTimeout(go, 500);
}
(window as unknown as { __lanxAppReady?: () => void }).__lanxAppReady = endSplash;

/** Runs once the window's own part has drawn. */
function Drawn({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    // LANX 2.5.3: the start-up logo (index.html) goes once the app has drawn.
    // LANX 3.17.1: in the main window it stays until LANX is ready (see endSplash); if that
    // never comes, it goes after 15 seconds so whatever is underneath can be seen.
    if (isMain) setTimeout(endSplash, 15000);
    else endSplash();
    // LANX 1.3.0: tell LANX the window drew itself (it restarts with a fresh
    // WebView2 folder if a window stays blank).
    if (isMain && "__TAURI_INTERNALS__" in window) {
      let told = false;
      const tell = () => {
        if (told) return;
        told = true;
        void import("@tauri-apps/api/core").then(({ invoke }) => invoke("ui_ready")).catch(() => {});
      };
      requestAnimationFrame(tell);
      // LANX 3.13.1: Linux's web engine gives a window that is still hidden no animation
      // frames, so this never ran there and LANX sat out the 6-second "show it anyway"
      // wait at every start. On Linux a short timer tells LANX too (Windows is unchanged).
      if (IS_LINUX) setTimeout(tell, 100);
    }
  }, []);
  return <>{children}</>;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <React.Suspense fallback={null}>
      <Drawn>
        <Root />
      </Drawn>
    </React.Suspense>
  </React.StrictMode>,
);
