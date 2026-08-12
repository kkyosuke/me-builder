import { shareLiffTextMessage } from "../../liff/infrastructure/liff-client";

export function compatibilityInvitationMessage(displayName: string | null, url: string): string {
  const sender = displayName?.trim() || "友だち";
  return `${sender}さんから相性診断の招待が届いています。\n内容を確認して承諾するまで、情報の共有は始まりません。\n${url}`;
}

export async function shareCompatibilityInvitationToLine(
  displayName: string | null,
  url: string,
): Promise<void> {
  const shared = await shareLiffTextMessage(compatibilityInvitationMessage(displayName, url));
  if (!shared) {
    throw new Error("この環境ではLINEの共有先を開けません。リンクをコピーして送ってください。");
  }
}

export async function copyCompatibilityInvitationUrl(url: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error("この環境ではリンクをコピーできません。URLを長押ししてコピーしてください。");
  }
  await navigator.clipboard.writeText(url);
}
