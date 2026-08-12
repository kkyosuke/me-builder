import { shareLiffTextMessage } from "../../liff/infrastructure/liff-client";

export function compatibilityInvitationMessage(displayName: string | null, url: string): string {
  const sender = displayName?.trim() || "友だち";
  return `${sender}さんから相性診断の招待が届いています。\n内容を確認して承諾するまで、情報の共有は始まりません。\n${url}`;
}

export async function shareCompatibilityInvitationToLine(
  displayName: string | null,
  url: string,
): Promise<"line" | "system"> {
  const message = compatibilityInvitationMessage(displayName, url);
  const shared = await shareLiffTextMessage(message);
  if (shared) return "line";
  if (navigator.share) {
    await navigator.share({ title: "相性診断の招待", text: message });
    return "system";
  }
  throw new Error("この環境では共有先を開けません。リンクをコピーしてLINEで送ってください。");
}

export async function copyCompatibilityInvitationUrl(url: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error("この環境ではリンクをコピーできません。URLを長押ししてコピーしてください。");
  }
  await navigator.clipboard.writeText(url);
}
