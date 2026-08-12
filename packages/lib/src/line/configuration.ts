const LIFF_ID_PATTERN = /^(\d+)-(.+)$/;
const CHANNEL_ID_PATTERN = /^\d+$/;

export type LiffConfiguration = Readonly<{
  liffId: string | undefined;
  lineLoginChannelId: string | undefined;
}>;

export type ConfiguredLiff = Readonly<{
  liffId: string;
  lineLoginChannelId: string;
}>;

/** LIFF ID と LINE Login チャネル ID を一箇所で検証・解決する。 */
export function resolveLiffConfiguration(params: {
  liffId?: string | undefined;
  lineLoginChannelId?: string | undefined;
}): LiffConfiguration {
  const liffId = params.liffId?.trim() || undefined;
  const explicitChannelId = params.lineLoginChannelId?.trim() || undefined;

  if (explicitChannelId && !CHANNEL_ID_PATTERN.test(explicitChannelId)) {
    throw new Error("LINE_LOGIN_CHANNEL_ID must contain only decimal digits");
  }
  if (!liffId) {
    return { liffId: undefined, lineLoginChannelId: explicitChannelId };
  }

  // LINEが公開していないsuffixの文字集合は推測せず、チャネルIDの抽出に必要な境界だけを見る。
  const match = LIFF_ID_PATTERN.exec(liffId);
  if (!match) {
    throw new Error("LIFF_ID must start with {LINE Login channel ID}- and include a suffix");
  }
  const channelIdFromLiff = match[1];
  if (explicitChannelId && explicitChannelId !== channelIdFromLiff) {
    throw new Error("LINE_LOGIN_CHANNEL_ID must match the channel ID prefix of LIFF_ID");
  }
  return { liffId, lineLoginChannelId: explicitChannelId ?? channelIdFromLiff };
}
