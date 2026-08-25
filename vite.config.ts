import { defineConfig } from "vite";
import { resolve } from "path";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  // Non-secret build-time constants only. Secrets must never go through
  // `define` or VITE_ vars — they would be embedded into the client bundle.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
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
    sourcemap: false,
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
