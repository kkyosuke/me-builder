import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const browserTarget = (major: number, minor = 0) => (major << 16) | (minor << 8);

// https://vitejs.dev/config/
export default defineConfig({
  // Tailwind CSS は PostCSS 設定を持たず、Vite プラグインとして読み込みます（v4 の推奨構成）。
  plugins: [react(), tailwindcss()],
  css: {
    transformer: "lightningcss",
    lightningcss: {
      // LINE が保持する古い LIFF WebView でも色やレイアウトを失わないようにします。
      targets: {
        chrome: browserTarget(80),
        safari: browserTarget(13, 1),
      },
    },
  },
  build: {
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
