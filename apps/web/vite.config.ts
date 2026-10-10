import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// PWA: manifest + service worker precache for offline shell.
// Data itself is not precached; it is served from Supabase and the
// app writes last-fetched snapshots to localStorage (see lib/cache.ts).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "NoteFlow",
        short_name: "NoteFlow",
        description: "Real-time personal notes with desktop widgets.",
        theme_color: "#0d1017",
        background_color: "#0d1017",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        navigateFallback: "/index.html",
      },
    }),
  ],
  server: { port: 5173, host: true },
  build: { target: "es2022", sourcemap: true },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  } as never,
});
