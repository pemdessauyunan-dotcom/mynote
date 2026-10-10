import React from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import "./styles/globals.css";

registerSW({ immediate: true });

// Reflect persisted theme + reduced-motion on <html> before first paint.
try {
  const raw = localStorage.getItem("nf.ui");
  if (raw) {
    const s = (JSON.parse(raw)?.state ?? {}) as { theme?: string; reducedMotion?: boolean };
    if (s.theme) document.documentElement.setAttribute("data-theme", s.theme);
    if (s.reducedMotion) document.documentElement.setAttribute("data-reduced-motion", "true");
  }
} catch { /* ignore */ }

createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
