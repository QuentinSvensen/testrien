import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

import "./index.css";

// Enregistrer le Service Worker (SW) uniquement en production. En preview/dev, vider les caches pour éviter les fragments obsolètes.
if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // L'enregistrement du SW a échoué — l'application fonctionne tout de même sans lui
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

// Masquer les logs bruyants des extensions externes ou les avertissements HMR connus de Supabase
// (Désormais géré par console-shield dans index.html)

createRoot(document.getElementById("root")!).render(<App />);

