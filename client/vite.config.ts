import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: "es2022",
    sourcemap: false,
    // Three.js is a single runtime module (744 kB minified, ~188 kB gzip); keep Vite's
    // generic 500 kB warning useful for unexpected application/vendor chunks.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "three",
              test: /node_modules[\\/]three[\\/]/,
              priority: 30,
            },
            {
              name: "react-three",
              test: /node_modules[\\/]@react-three[\\/](fiber|drei)[\\/]/,
              priority: 20,
            },
            {
              name: "colyseus",
              test: /node_modules[\\/]@colyseus[\\/]/,
              priority: 10,
            },
            {
              name: "vendor",
              test: /node_modules[\\/]/,
              priority: 0,
            },
          ],
        },
      },
    },
  },
});
