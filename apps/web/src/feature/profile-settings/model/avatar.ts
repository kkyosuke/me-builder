export const AVATAR_PRESETS = [
  { id: "sunrise", name: "朝焼け" },
  { id: "starlight", name: "星空" },
  { id: "leaf", name: "若葉" },
  { id: "water", name: "水面" },
] as const;

export type AvatarPresetId = (typeof AVATAR_PRESETS)[number]["id"];

export type AvatarSelection =
  | { kind: "preset"; presetId: AvatarPresetId }
  | { kind: "uploaded"; dataUrl: string; fileName: string };

export function getAvatarName(avatar: AvatarSelection | null): string {
  if (!avatar) return "未設定";
  if (avatar.kind === "uploaded") return avatar.fileName;
  return AVATAR_PRESETS.find((preset) => preset.id === avatar.presetId)?.name ?? "アバター";
}
