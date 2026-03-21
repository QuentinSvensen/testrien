import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

import "./index.css";

// Filter annoying Chrome extension / message channel errors from console
const IGNORED_ERRORS = [
  "asynchronous response by returning true",
  "message channel closed before a response was received",
  "asynchronous response",
];

const isIgnored = (err: any) => {
  if (!err) return false;
  const str = String(err.message || err.stack || err || "").toLowerCase();
  return IGNORED_ERRORS.some(ignored => str.includes(ignored.toLowerCase()));
};

// Silence console.error safely
try {
  const originalError = console.error;
  Object.defineProperty(console, 'error', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: function(...args: any[]) {
      if (isIgnored(args[0])) return;
      originalError.apply(console, args);
    }
  });
} catch (e) {
  // If we can't redefine it (e.g. read-only/non-configurable), try simple assignment as fallback
  try {
    const originalError = console.error;
    (console as any).error = function(...args: any[]) {
      if (isIgnored(args[0])) return;
      originalError.apply(console, args);
    };
  } catch (e2) {
    // Both failed, skip console.error monkey-patching
  }
}

// Silence unhandled promise rejections (often from extensions)
window.addEventListener("unhandledrejection", (event) => {
  if (isIgnored(event.reason)) {
    event.preventDefault();
    event.stopPropagation();
  }
}, true);

// Silence general errors
window.addEventListener("error", (event) => {
  if (isIgnored(event.error) || isIgnored(event.message)) {
    event.preventDefault();
    event.stopPropagation();
  }
}, true);


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

createRoot(document.getElementById("root")!).render(<App />);

