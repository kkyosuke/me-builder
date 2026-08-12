import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const browserTarget = (major: number, minor = 0) => (major << 16) | (minor << 8);
const appVersion = process.env.GITHUB_SHA?.slice(0, 12) ?? "development";

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  // Tailwind CSS は PostCSS 設定を持たず、Vite プラグインとして読み込みます（v4 の推奨構成）。
  plugins: [react(), tailwindcss()],
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
});
