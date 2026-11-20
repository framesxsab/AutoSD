import { defineConfig } from "vite";
import { resolve } from "path";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

const SECRET_VITE_NAME = /^VITE_.*(API[-_]?KEY|APIKEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL)/i;

function assertNoPublicSecretsInBuildEnv(): void {
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith("VITE_") || typeof v !== "string") continue;
    if (
      SECRET_VITE_NAME.test(k) ||
      /\bsk-[A-Za-z0-9_-]{8,}\b/.test(v) ||
      /\/\/[^/\s]+:[^/\s]+@/.test(v)
    ) {
      throw new Error(
        `[SECURITY] Refusing to bundle "${k}": VITE_-prefixed variables are embedded publicly in the client bundle. Move secrets and credentials to server-side environment variables.`,
      );
    }
  }
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), hid=(self)",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

export default defineConfig(({ command }) => {
  if (command === "build" && !process.env.VITEST) {
    assertNoPublicSecretsInBuildEnv();
  }
  return {
    // Non-secret build-time constants only. Secrets must never go through
    // `define` or VITE_ vars — they would be embedded into the client bundle.
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    server: {
      port: 5173,
      strictPort: true,
      cors: false,
      headers: SECURITY_HEADERS,
    },
    preview: {
      port: 4173,
      strictPort: true,
      cors: false,
      headers: SECURITY_HEADERS,
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
  };
});
