import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const browserTarget = (major: number, minor = 0) => (major << 16) | (minor << 8);

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Tailwind CSS は PostCSS 設定を持たず、Vite プラグインとして読み込みます（v4 の推奨構成）。
  plugins: [react(), tailwindcss()],
  resolve: {
    alias:
      mode === "liff-e2e"
        ? {
            "@line/liff": fileURLToPath(new URL("./e2e/fixtures/liff-mock.ts", import.meta.url)),
          }
        : {},
  },
  css: {
    transformer: "lightningcss",
    lightningcss: {
      targets: {
        chrome: browserTarget(80),
        safari: browserTarget(13, 1),
      },
    },
  },
  build: {
    // CSSだけでなくJavaScriptもLIFF内のWebViewと同じ世代へ変換します。
    target: ["chrome80", "safari13.1"],
    cssMinify: "lightningcss",
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
}));
