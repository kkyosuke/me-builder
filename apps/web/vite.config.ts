import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import postcss from "postcss";
import { type Plugin, defineConfig } from "vite";

const browserTarget = (major: number, minor = 0) => (major << 16) | (minor << 8);

function unwrapCascadeLayers(css: string) {
  const root = postcss.parse(css);
  let changed = false;

  root.walkAtRules("layer", (rule) => {
    changed = true;
    if (rule.nodes) {
      rule.replaceWith(...rule.nodes);
    } else {
      rule.remove();
    }
  });

  return changed ? root.toString() : null;
}

function liffCssCompatibility(): Plugin {
  return {
    name: "liff-css-compatibility",
    enforce: "post",
    transform(code, id) {
      if (!id.split("?", 1)[0].endsWith(".css")) return null;

      const css = unwrapCascadeLayers(code);
      return css ? { code: css, map: null } : null;
    },
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== "asset" || !output.fileName.endsWith(".css")) continue;

        const css =
          typeof output.source === "string"
            ? output.source
            : new TextDecoder().decode(output.source);
        const compatibleCss = unwrapCascadeLayers(css);
        if (compatibleCss) output.source = compatibleCss;
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  // Tailwind CSS は PostCSS 設定を持たず、Vite プラグインとして読み込みます（v4 の推奨構成）。
  plugins: [react(), tailwindcss(), liffCssCompatibility()],
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
