import type { operations } from "../../../generated/api";

export type AvatarState = operations["getAvatar"]["responses"][200]["content"]["application/json"];
type AvatarJob = NonNullable<AvatarState["job"]>;

/** 認証済み画像をブラウザ内で表示するための一時URL。 */
export type AvatarSelection = {
  id: string;
  src: string;
};

type AvatarCandidate = AvatarSelection & {
  expiresAt: string;
};

export type AvatarDisplayState = {
  currentAvatar: AvatarSelection | null;
  job: (Omit<AvatarJob, "candidates"> & { candidates: AvatarCandidate[] }) | null;
};

export type AvatarJobStatus = NonNullable<AvatarDisplayState["job"]>["status"];

export function getAvatarName(avatar: AvatarSelection | null): string {
  return avatar ? "設定済み" : "未設定";
}
