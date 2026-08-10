export type AvatarRecord = {
  id: string;
  objectKey: string;
  contentType: string;
  updatedAt: Date;
};

export type AvatarState = {
  currentAvatar: AvatarRecord | null;
};

export type SetCurrentAvatarInput = {
  id: string;
  objectKey: string;
  contentType: string;
};

export type SetCurrentAvatarResult =
  | { type: "updated"; state: AvatarState }
  | { type: "rate-limited"; retryAt: Date };

export type DeleteCurrentAvatarResult =
  | { type: "deleted" }
  | { type: "unchanged" }
  | { type: "rate-limited"; retryAt: Date };

export type ResolveAvatarImageResult =
  | { type: "resolved"; objectKey: string; contentType: string }
  | { type: "not-found" };
