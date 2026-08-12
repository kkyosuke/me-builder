import { resolveLiffConfiguration } from "@me-builder/lib/line/liff-configuration";
import { loadEnv } from "vite";

/** `vite build` と同じproduction modeの入力を共通SSoTで検証する。 */
export function validateLiffConfigurationForBuild(envDir = process.cwd()): void {
  const env = loadEnv("production", envDir, ["VITE_LIFF_ID", "LIFF_ID", "LINE_LOGIN_CHANNEL_ID"]);
  resolveLiffConfiguration({
    liffId: env.VITE_LIFF_ID ?? env.LIFF_ID,
    lineLoginChannelId: env.LINE_LOGIN_CHANNEL_ID,
  });
}

// CDはWeb artifactを最初にbuildするため、外部状態を変更する前に検証を完了できる。
if (import.meta.main) validateLiffConfigurationForBuild();
