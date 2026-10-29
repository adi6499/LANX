// LANX 3.0: the phone page. A plain web page (no Tauri) that this PC serves
// on the office network; see src-tauri/src/phone/mod.rs for the whole idea.
import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "../App.css";
import "./phone.css";
import icon from "../../public/lanx-logo.png";
import PhoneApp from "./PhoneApp";

// Light or dark like the phone (the page cannot run an inline script first,
// so phone.html paints the matching background until this runs).
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => document.documentElement.classList.toggle("dark", dark.matches);
applyTheme();
dark.addEventListener("change", applyTheme);

// The icon for "Add to Home Screen" and the tab.
for (const rel of ["icon", "apple-touch-icon"]) {
  const link = document.createElement("link");
  link.rel = rel;
  link.href = icon;
  document.head.appendChild(link);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <PhoneApp />
  </React.StrictMode>
);
