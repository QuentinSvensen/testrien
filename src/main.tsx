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
// (Now handled by console-shield in index.html)

createRoot(document.getElementById("root")!).render(<App />);

