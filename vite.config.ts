import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  build: {
    outDir: "dist-app",
    emptyOutDir: true,
  },
  resolve: {
    alias: [
      { find: /^node:fs\/promises$/, replacement: resolve("./src/utils/empty.ts") },
      { find: /^node:fs$/, replacement: resolve("./src/utils/empty.ts") },
      { find: /^node:path$/, replacement: resolve("./src/utils/empty.ts") },
      { find: /^node:crypto$/, replacement: resolve("./src/utils/empty.ts") },
    ],
  },
});
