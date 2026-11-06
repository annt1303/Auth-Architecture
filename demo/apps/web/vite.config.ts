import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Mọi request tới /api đi qua proxy sang API (cookie phiên dùng chung origin localhost:5173).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        rewrite: (requestPath) => requestPath.replace(/^\/api/, ""),
      },
    },
  },
});
