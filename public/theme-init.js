(function () {
  try {
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      document.documentElement.classList.add("dark");
    }
  } catch (e) {}
  // LANX 3.17.1: the main window's start-up screen is the same calm dark colour on every PC
  // (it was near-white where Windows is in light mode: "a white screen"). The small windows
  // (alerts, the Stop bar, the hands window) keep their own look.
  try {
    var t = window.__TAURI_INTERNALS__;
    var label = t && t.metadata && t.metadata.currentWindow && t.metadata.currentWindow.label;
    var small = label === "island" || label === "remote" || label === "hud" || /^#(island|remote|hud)$/.test(location.hash);
    // (The small windows show no start-up screen at all: an alert must not flash a logo first.)
    document.documentElement.classList.add(small ? "lanx-small" : "lanx-starting");
    // …and LANX is told the moment that screen is really drawn: its window opens then, never
    // before (an empty window is white where Windows is in light mode). A window that is still
    // hidden gets no drawing frames on Linux; there the window opens as before (main.tsx).
    if (!small && t && typeof t.invoke === "function") {
      var told = false;
      var tell = function () {
        if (told) return;
        told = true;
        try {
          var p = t.invoke("splash_shown");
          if (p && p.catch) p.catch(function () {});
        } catch (e) {}
      };
      // Drawn = one drawing frame after the start-up screen's element is on the page. (Not
      // "the page has loaded": that waits for all of LANX's code, a second or so later.)
      var frames = 0;
      var look = function () {
        if (told) return;
        if (document.getElementById("lanx-splash") || frames > 600) {
          requestAnimationFrame(function () {
            requestAnimationFrame(tell);
          });
          return;
        }
        frames++;
        requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    }
  } catch (e) {}
})();
