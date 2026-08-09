export async function copyCompatibilityInvitation(url: string): Promise<void> {
  if (!navigator.clipboard) {
    throw new Error("Clipboard API is unavailable");
  }
  await navigator.clipboard.writeText(url);
}

export function createLineShareUrl(invitationUrl: string): string {
  const message = `相性診断の招待が届いています。承諾するまで共有は始まりません。\n${invitationUrl}`;
  return `https://line.me/R/msg/text/?${encodeURIComponent(message)}`;
}
