export type AvatarSelection = { kind: "uploaded"; dataUrl: string; fileName: string };

export function getAvatarName(
  avatar: AvatarSelection | null,
  linePictureUrl?: string | undefined,
): string {
  if (avatar) return "設定した画像";
  if (linePictureUrl) return "LINEのプロフィール画像";
  return "未設定";
}
