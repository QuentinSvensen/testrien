import { defineConfig } from "vite";
import path from "path";

const reactPath = path.resolve(__dirname, "./node_modules/react");
const reactDomPath = path.resolve(__dirname, "./node_modules/react-dom");

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    (await import(path.resolve(__dirname, "./node_modules/@vitejs/plugin-react/dist/index.mjs"))).default(),
  ],
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