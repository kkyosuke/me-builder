import type { CompatibilityRelationshipCategory } from "@me-builder/lib/compatibility";
import { getRelationshipCategoryLabel } from "../../diagnosis/model/relationship-category";
import { shareLiffTextMessage } from "../../liff/infrastructure/liff-client";

export function compatibilityInvitationMessage(
  displayName: string | null,
  relationshipCategory: CompatibilityRelationshipCategory,
  url: string,
): string {
  const sender = displayName?.trim() || "友だち";
  const category = getRelationshipCategoryLabel(relationshipCategory);
  return `${sender}さんから相性診断（関係: ${category}）の招待が届いています。\n内容を確認して承諾するまで、情報の共有は始まりません。\n${url}`;
}

export async function shareCompatibilityInvitationToLine(
  displayName: string | null,
  relationshipCategory: CompatibilityRelationshipCategory,
  url: string,
): Promise<"line" | "system" | "cancelled"> {
  const message = compatibilityInvitationMessage(displayName, relationshipCategory, url);
  const lineSharing = shareLiffTextMessage(message);
  if (lineSharing) {
    return (await lineSharing) === "sent" ? "line" : "cancelled";
  }
  if (navigator.share) {
    try {
      // LIFF可否の確認後にawaitを挟まず呼び、Web Share APIが必要とするユーザー操作を保つ。
      await navigator.share({ title: "相性診断の招待", text: message });
      return "system";
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        error.name === "AbortError"
      ) {
        return "cancelled";
      }
      throw error;
    }
  }
  throw new Error("この環境では共有先を開けません。リンクをコピーしてLINEで送ってください。");
}

export async function copyCompatibilityInvitationUrl(url: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error("この環境ではリンクをコピーできません。URLを長押ししてコピーしてください。");
  }
  await navigator.clipboard.writeText(url);
}
