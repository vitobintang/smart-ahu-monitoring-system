import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [react()],
  publicDir: resolve(rootDir, "../public"),
  server: {
    host: "0.0.0.0",
    allowedHosts: [".e2b.app"],
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.NEXT_DEV_ORIGIN ?? "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
