import { D1 } from "@me-builder/lib";

const AVATAR_ORPHAN_GRACE_PERIOD_MS = 24 * 60 * 60 * 1_000;
const AVATAR_OBJECT_PREFIX = "accounts/";

type AvatarObject = Readonly<{ key: string; uploaded: Date }>;
type AvatarObjectStore = Readonly<{
  delete: (key: string) => Promise<unknown>;
  list: (options: Readonly<{ prefix: string; cursor?: string }>) => Promise<
    Readonly<{
      objects: readonly AvatarObject[];
      truncated: boolean;
      cursor?: string;
    }>
  >;
}>;
type CleanupDependencies = Readonly<{
  isReferenced: (objectKey: string) => Promise<boolean>;
}>;

export type AvatarOrphanCleanupResult = Readonly<{
  mode: "dry-run" | "delete";
  scannedCount: number;
  candidateCount: number;
  deletedCount: number;
  failedCount: number;
}>;

async function listAvatarObjects(bucket: AvatarObjectStore): Promise<readonly AvatarObject[]> {
  const objects: AvatarObject[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({
      prefix: AVATAR_OBJECT_PREFIX,
      ...(cursor ? { cursor } : {}),
    });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

/**
 * 猶予期間を過ぎたobjectだけを対象に、削除直前のD1参照確認を通して整理する。
 * object keyやAccount識別子は結果へ含めない。
 */
export async function cleanupAvatarOrphans(
  input: Readonly<{
    bucket: AvatarObjectStore;
    mode: "dry-run" | "delete";
    now?: Date;
    gracePeriodMs?: number;
  }>,
  dependencies: CleanupDependencies,
): Promise<AvatarOrphanCleanupResult> {
  const now = input.now ?? new Date();
  const cutoff = now.getTime() - (input.gracePeriodMs ?? AVATAR_ORPHAN_GRACE_PERIOD_MS);
  const objects = await listAvatarObjects(input.bucket);
  let candidateCount = 0;
  let deletedCount = 0;
  let failedCount = 0;

  for (const object of objects) {
    if (object.uploaded.getTime() > cutoff) continue;
    try {
      if (await dependencies.isReferenced(object.key)) continue;
      candidateCount += 1;
      if (input.mode === "delete") {
        await input.bucket.delete(object.key);
        deletedCount += 1;
      }
    } catch {
      failedCount += 1;
    }
  }

  return {
    mode: input.mode,
    scannedCount: objects.length,
    candidateCount,
    deletedCount,
    failedCount,
  };
}

export async function cleanupAvatarOrphansFromCloudflare(input: {
  db: D1.shared.Client;
  bucket: AvatarObjectStore;
  mode: "dry-run" | "delete";
  now?: Date;
}): Promise<AvatarOrphanCleanupResult> {
  return cleanupAvatarOrphans(input, {
    isReferenced: (objectKey) =>
      D1.shared.action.profile.isProfileAvatarObjectReferenced(input.db, objectKey),
  });
}
