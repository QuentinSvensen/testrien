import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

import "./index.css";

// Filter annoying Chrome extension / message channel errors from console
const IGNORED_ERRORS = [
  "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received",
  "message channel closed before a response was received",
  "A listener indicated an asynchronous response",
];

try {
  const originalError = console.error;
  Object.defineProperty(console, 'error', {
    writable: true,
    configurable: true,
    value: function(...args: any[]) {
      const msg = args[0];
      if (typeof msg === 'string' && IGNORED_ERRORS.some(err => msg.includes(err))) {
        return;
      }
      originalError.apply(console, args);
    }
  });
} catch (e) {
  // If defineProperty fails (non-configurable), try simple assignment
  try {
    const originalError = console.error;
    (console as any).error = function(...args: any[]) {
      const msg = args[0];
      if (typeof msg === 'string' && IGNORED_ERRORS.some(err => msg.includes(err))) {
        return;
      }
      originalError.apply(console, args);
    };
  } catch (e2) {
    // Both failed, nothing more we can safely do for console.error
  }
}

window.onerror = function(message) {
  const msg = typeof message === 'string' ? message : (message as any)?.message || "";
  if (msg && IGNORED_ERRORS.some(err => msg.includes(err))) {
    return true;
  }
};

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const message = reason?.message || (typeof reason === 'string' ? reason : "");
  const stack = reason?.stack || "";
  if ((message && IGNORED_ERRORS.some(err => message.includes(err))) || 
      (stack && IGNORED_ERRORS.some(err => stack.includes(err)))) {
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

