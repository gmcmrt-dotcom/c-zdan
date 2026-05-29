import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_API_PROXY_TARGET || "http://localhost:3000";

  if (mode === "production" && env.VITE_DEV_MOCK_MERCHANT === "true") {
    throw new Error(
      "[vite.config] VITE_DEV_MOCK_MERCHANT=true is not allowed in production builds.",
    );
  }

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: { overlay: false },
      proxy: {
        // During `tsx watch` reloads the API is briefly unreachable. The
        // browser fetch client (apps/web/src/lib/api.ts) retries on
        // ECONNREFUSED, so we can safely swallow the proxy's own ERR_* logs
        // here. Real failures still surface via the browser's response.
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on("error", (err) => {
              if (!/ECONNREFUSED|socket hang up/i.test(err.message)) console.error(err);
            });
          },
        },
        "/ws": {
          target: apiTarget,
          changeOrigin: true,
          ws: true,
          configure: (proxy) => {
            proxy.on("error", (err) => {
              if (!/ECONNREFUSED|socket hang up/i.test(err.message)) console.error(err);
            });
          },
        },
        "/storage": {
          target: apiTarget,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on("error", (err) => {
              if (!/ECONNREFUSED|socket hang up/i.test(err.message)) console.error(err);
            });
          },
        },
      },
    },
    plugins: [react()],
    // I3 — Explicitly disable production source maps. The default is `false`
    // but pinning the value here documents the choice and prevents an
    // accidental flip via env or a plugin from leaking the un-minified
    // sources (which would re-expose the localStorage token-handling
    // logic to reverse-engineering tools).
    build: {
      sourcemap: mode !== "production" ? true : false,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
  };
});
