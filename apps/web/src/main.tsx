import React from "react";
import ReactDOM from "react-dom/client";
import { authSessionRuntime } from "./feature/auth/infrastructure/auth-session-runtime";
import { initializeColorTheme, initializeFontSize } from "./feature/theme";
import {
  configureWebErrorCsrfTokenProvider,
  installGlobalWebErrorHandlers,
} from "./infrastructure/web-error-reporter";
import "./index.css";
import { RootApplication } from "./root-application";

// Reactの初回描画前に保存済みテーマを反映し、配色のちらつきを防ぎます。
initializeColorTheme();
initializeFontSize();

// フロントエンド最上位の未捕捉例外をAPI Worker経由でWorkers Logsへ送る。
if (typeof window !== "undefined") {
  configureWebErrorCsrfTokenProvider(() => authSessionRuntime.csrfToken());
  installGlobalWebErrorHandlers(window);
}

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <RootApplication />
    </React.StrictMode>,
  );
}
