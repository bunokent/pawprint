import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  plugins: [
    react({
      babel: {
        plugins: ["babel-plugin-react-compiler"],
      },
    }),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: process.env.PAWPRINT_API_URL ?? "http://127.0.0.1:8000", changeOrigin: true },
      "/media": { target: process.env.PAWPRINT_API_URL ?? "http://127.0.0.1:8000", changeOrigin: true },
      "/private-media": { target: process.env.PAWPRINT_API_URL ?? "http://127.0.0.1:8000", changeOrigin: true },
      "/ws": { target: (process.env.PAWPRINT_API_URL ?? "http://127.0.0.1:8000").replace(/^http/, "ws"), ws: true },
    },
  },
});
