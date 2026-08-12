import { resolveLiffConfiguration } from "@me-builder/lib/line/liff-configuration";

// CDはWeb artifactを最初にbuildするため、外部状態を変更する前に共通SSoTで設定を検証できる。
resolveLiffConfiguration({
  liffId: process.env.VITE_LIFF_ID ?? process.env.LIFF_ID,
  lineLoginChannelId: process.env.LINE_LOGIN_CHANNEL_ID,
});
