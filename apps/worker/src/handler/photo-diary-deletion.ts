import { accountDataFor } from "@me-builder/lib";
import type { Message, PhotoDiaryDeletionQueueMessage } from "@me-builder/shared";
import { OperationalError, toOperationalError } from "@me-builder/shared";
import type { CloudflareBindings } from "../config";

/** 削除APIで利用停止済みの写真objectを冪等に物理削除する。 */
export async function processPhotoDiaryDeletionMessage(
  message: Message<PhotoDiaryDeletionQueueMessage>,
  cf: CloudflareBindings,
): Promise<void> {
  if (!cf.do.accountData || !cf.photoDiaryBucket) {
    throw new OperationalError({
      code: "PHOTO_DIARY_DELETION_BINDING_MISSING",
      category: "configuration",
      stage: "photo.delete.configure",
      retryable: true,
    });
  }
  const accountData = accountDataFor(cf.do.accountData, message.body.accountId);
  const media = await accountData.execute("photoDiary.getDeleting", message.body.mediaId);
  if (!media) {
    message.ack();
    return;
  }
  try {
    await cf.photoDiaryBucket.delete([media.originalObjectKey, media.thumbnailObjectKey]);
    const completed = await accountData.execute("photoDiary.completeDeletion", media.id);
    if (!completed) throw new Error("Photo diary deletion state could not be completed");
    message.ack();
  } catch (error) {
    throw toOperationalError(error, {
      code: "PHOTO_DIARY_PHYSICAL_DELETE_FAILED",
      category: "dependency",
      stage: "photo.delete.r2",
      retryable: true,
      dependency: "r2",
    });
  }
}
