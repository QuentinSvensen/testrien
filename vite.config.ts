import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const reactPath = path.resolve(__dirname, "./node_modules/react");
const reactDomPath = path.resolve(__dirname, "./node_modules/react-dom");

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 1000,
  },
  server: {
    host: true,
    port: 8081,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  optimizeDeps: {
    include: ["react", "react-dom", "react/jsx-runtime", "react-dom/client"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "react": reactPath,
      "react-dom": reactDomPath,
      "react/jsx-runtime": path.resolve(reactPath, "jsx-runtime"),
      "react/jsx-dev-runtime": path.resolve(reactPath, "jsx-dev-runtime"),
      "react-dom/client": path.resolve(reactDomPath, "client"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom/client"],
  },
});
