import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// We disable filename hashing so Django's index.html template can reference
// `static/assets/index.js` / `static/assets/index.css` without needing a Vite
// manifest lookup. The build is small enough that the cache-bust loss is
// irrelevant for a prototype; in production we'd wire up django-vite or
// equivalent. See DECISIONS.md.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsDir: "assets",
    rollupOptions: {
      output: {
        entryFileNames: "assets/index.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith(".css")) {
            return "assets/index.css";
          }
          return "assets/[name][extname]";
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
      "/healthz": "http://localhost:8000",
    },
  },
});
