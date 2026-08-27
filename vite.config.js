import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Sirve el sitio bajo /agro-plex/ (GitHub Pages: gusorh.github.io/agro-plex/)
export default defineConfig({
  plugins: [react()],
  base: "/agro-plex/",
});
