import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiPort = process.env.FOUR_EYES_API_PORT ?? "8787";
const webPort = Number(process.env.FOUR_EYES_WEB_PORT ?? "5173");

export default defineConfig({
  root: "web",
  plugins: [react()],
  resolve: {
    alias: { "@shared": fileURLToPath(new URL("./shared", import.meta.url)) },
  },
  server: {
    port: webPort,
    strictPort: true,
    proxy: {
      "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
    },
  },
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
  },
});
