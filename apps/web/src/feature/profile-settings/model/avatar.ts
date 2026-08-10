export type AvatarSelection = { kind: "uploaded"; dataUrl: string; fileName: string };

export function getAvatarName(
  avatar: AvatarSelection | null,
  linePictureUrl?: string | undefined,
): string {
  if (avatar) return avatar.fileName;
  if (linePictureUrl) return "LINEのプロフィール画像";
  return "未設定";
}
