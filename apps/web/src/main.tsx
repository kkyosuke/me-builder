import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { initializeColorTheme } from "./feature/theme";
import "./index.css";

// Reactの初回描画前に保存済みテーマを反映し、配色のちらつきを防ぎます。
initializeColorTheme();

// フロントエンド最上位での未捕捉例外・未処理 Rejection のキャッチとログ出力
if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    console.error("[Unhandled Error]", event.error || event.message);
  });

  window.addEventListener("unhandledrejection", (event) => {
    console.error("[Unhandled Rejection]", event.reason);
  });
}

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
