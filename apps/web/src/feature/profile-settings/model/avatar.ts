import type { operations } from "../../../generated/api";

export type AvatarState = operations["getAvatar"]["responses"][200]["content"]["application/json"];

/** 認証済み画像をブラウザ内で表示するための一時URL。 */
export type AvatarSelection = {
  id: string;
  src: string;
  source?: "saved" | "line";
};

export function getAvatarName(avatar: AvatarSelection | null): string {
  if (avatar?.source === "line") return "LINEプロフィール画像";
  return avatar ? "設定済み" : "未設定";
}
