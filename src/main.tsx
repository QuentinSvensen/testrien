import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

import "./index.css";

// Register SW only in production. In preview/dev, clear old SW caches to avoid stale Vite/React chunks.
if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // SW registration failed — app works fine without it
      });
    });
  } else {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((reg) => reg.unregister());
    });
    if ("caches" in window) {
      window.caches.keys().then((keys) => {
        keys.filter((k) => k.startsWith("mealscards-")).forEach((k) => window.caches.delete(k));
      });
    }
  }
}

// Silence noisy console logs from external extensions or known Supabase HMR warnings
if (typeof window !== "undefined") {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = (...args) => {
    const msg = String(args[0]);
    if (msg === "test" || msg.includes("[debug-metadata]")) return;
    originalLog(...args);
  };

  console.warn = (...args) => {
    const msg = String(args[0]);
    if (msg.includes("WebSocket is closed before the connection is established")) return;
    originalWarn(...args);
  };

  console.error = (...args) => {
    const msg = String(args[0]);
    // Silence common HMR / WebSocket noise that doesn't impact functionality
    if (msg.includes("WebSocket is closed before the connection is established") || msg.includes("ChunkLoadError")) return;
    originalError(...args);
  }
}

createRoot(document.getElementById("root")!).render(<App />);

