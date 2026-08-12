/** 発行時と一覧再送で共通して使う、LINE内で開ける正規LIFF招待URLを組み立てる。 */
export function createCompatibilityInvitationUrl(liffId: string, relationshipId: string): string {
  return new URL(
    `https://liff.line.me/${encodeURIComponent(liffId)}/compatibility/invitations/${relationshipId}`,
  ).toString();
}
