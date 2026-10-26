// LANX download site — tiny helpers, no framework.
(function () {
  var root = document.documentElement;

  // Light / dark switch (follows Windows by default; the choice is remembered).
  try {
    var saved = localStorage.getItem("lanx-theme");
    if (saved === "light" || saved === "dark") root.setAttribute("data-theme", saved);
  } catch (e) {}
  var btn = document.getElementById("themeBtn");
  if (btn)
    btn.addEventListener("click", function () {
      var dark = root.getAttribute("data-theme") === "dark" ||
        (!root.getAttribute("data-theme") && window.matchMedia("(prefers-color-scheme: dark)").matches);
      var next = dark ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("lanx-theme", next); } catch (e) {}
      swapShot();
    });

  // The hero picture follows the chosen look (the <picture> only follows Windows).
  function swapShot() {
    var img = document.getElementById("heroShot");
    var src = document.querySelector(".src-dark");
    if (!img || !src) return;
    var t = root.getAttribute("data-theme");
    if (t === "dark") { img.src = "/img/shot-chat-dark.png"; src.media = "all"; }
    else if (t === "light") { img.src = "/img/shot-chat-light.png"; src.media = "not all"; }
  }
  swapShot();

  // Fill version, size, date and checksum from version.json, so a new release
  // only needs that file (and the installer) changed. The HTML already holds
  // the current values, so nothing breaks if this fails.
  fetch("/version.json", { cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (v) {
      if (!v || !v.version) return;
      var map = {
        version: v.version,
        size: v.size,
        date: v.dateText || v.date,
        sha256: v.sha256,
      };
      var lx = v.linux || {};
      var linuxThere = !!(lx.deb || lx.appimage);
      document.querySelectorAll("[data-linux-only]").forEach(function (el) { el.hidden = !linuxThere; });
      document.querySelectorAll("[data-linux-deb]").forEach(function (el) { el.hidden = !lx.deb; });
      document.querySelectorAll("[data-linux-appimage]").forEach(function (el) { el.hidden = !lx.appimage; });
      if (lx.deb) { map.debSize = lx.deb.size; map.debSha = lx.deb.sha256; }
      map.linuxVersion = (lx.deb && lx.deb.version) || (lx.appimage && lx.appimage.version) || v.version;
      if (lx.appimage) { map.appSize = lx.appimage.size; map.appSha = lx.appimage.sha256; }
      document.querySelectorAll("[data-v]").forEach(function (el) {
        var k = el.getAttribute("data-v");
        if (k === "debHref" && lx.deb) el.href = lx.deb.file;
        else if (k === "appHref" && lx.appimage) el.href = lx.appimage.file;
        else if (k === "dlHref" && v.file) el.href = v.file;
        else if (k === "sigHref" && v.sig) el.href = v.sig;
        else if (k === "shaHref" && v.sha256File) el.href = v.sha256File;
        else if (map[k]) el.textContent = map[k];
      });
    })
    .catch(function () {});

  // Sections, cards and steps glide in as you scroll (once each; not when Windows asks for less motion).
  try {
    var items = document.querySelectorAll(".section > .kicker, .section > h2, .section > .sub, .card, .steps li, .strip > div, .gallery figure, .changelog article, .faq details, .dl-card, .guide, .reqs, .cta-bottom .btn-lg");
    if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      items.forEach(function (el, i) { el.classList.add("reveal"); el.style.setProperty("--d", (i % 5) * 70 + "ms"); });
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
        });
      }, { rootMargin: "0px 0px -6% 0px" });
      items.forEach(function (el) { io.observe(el); });
    }
  } catch (e) {}

  // "Copy" next to the checksum.
  document.querySelectorAll("[data-copy]").forEach(function (b) {
    b.addEventListener("click", function () {
      var el = document.querySelector('[data-v="' + b.getAttribute("data-copy") + '"]');
      if (!el || !navigator.clipboard) return;
      navigator.clipboard.writeText(el.textContent.trim()).then(function () {
        var old = b.textContent;
        b.textContent = "Copied";
        setTimeout(function () { b.textContent = old; }, 1400);
      });
    });
  });
})();
