const LIFF_ID_PATTERN = /^(\d+)-(.+)$/u;
const CHANNEL_ID_PATTERN = /^\d+$/;

function isSafePathSegment(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      codePoint <= 0x20 ||
      codePoint === 0x7f ||
      "/?#\\".includes(character)
    ) {
      return false;
    }
  }
  return true;
}

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

  // LINEが公開していないsuffixの文字集合は推測せず、URLの1 path segmentとして危険な文字だけを除く。
  const match = LIFF_ID_PATTERN.exec(liffId);
  const channelIdFromLiff = match?.[1];
  const suffix = match?.[2];
  if (!channelIdFromLiff || !suffix || !isSafePathSegment(suffix)) {
    throw new Error(
      "LIFF_ID must start with {LINE Login channel ID}- and include a URL-safe path suffix",
    );
  }
  if (explicitChannelId && explicitChannelId !== channelIdFromLiff) {
    throw new Error("LINE_LOGIN_CHANNEL_ID must match the channel ID prefix of LIFF_ID");
  }
  return { liffId, lineLoginChannelId: explicitChannelId ?? channelIdFromLiff };
}
