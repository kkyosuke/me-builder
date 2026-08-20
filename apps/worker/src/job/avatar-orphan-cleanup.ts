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

function isAvatarObjectKey(key: string): boolean {
  return /^accounts\/[^/]+\/profile\/avatar\/[^/]+$/.test(key);
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
  let scannedCount = 0;
  let candidateCount = 0;
  let deletedCount = 0;
  let failedCount = 0;
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  while (true) {
    const page = await input.bucket.list({
      prefix: AVATAR_OBJECT_PREFIX,
      ...(cursor ? { cursor } : {}),
    });
    scannedCount += page.objects.length;
    for (const object of page.objects) {
      // `accounts/`配下へ別用途のobjectが増えても、アバター以外は絶対に削除しない。
      if (!isAvatarObjectKey(object.key) || object.uploaded.getTime() > cutoff) continue;
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

    if (!page.truncated) break;
    const nextCursor = page.cursor;
    if (!nextCursor || nextCursor === cursor || seenCursors.has(nextCursor)) {
      throw new Error("Avatar object listing returned an invalid pagination cursor");
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return {
    mode: input.mode,
    scannedCount,
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
