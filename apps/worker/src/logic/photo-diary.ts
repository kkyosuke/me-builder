import { type PhotoDiaryMimeType, accountDataFor, billing } from "@me-builder/lib";
import { OperationalError, toOperationalError } from "@me-builder/shared";
import type { CloudflareBindings, WorkerConfig } from "../config";
import { createLineRetryKey, pushLineTextWithRetryKey } from "../infrastructure/line-delivery";

export const MAX_PHOTO_DIARY_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTO_DIARY_PIXELS = 40_000_000;
const THUMBNAIL_WIDTH = 512;
const PHOTO_STORAGE_LIMITS = {
  free: 500 * 1024 * 1024,
  lite: 5 * 1024 * 1024 * 1024,
  full: 20 * 1024 * 1024 * 1024,
  family: 20 * 1024 * 1024 * 1024,
} as const;

const PHOTO_SAVED_REPLY =
  "写真を日記として保存しました。写真のAI分析はまだ行っていません。ほかの方が写る写真は、必要な了承と権利を確認して送ってね。";
const PHOTO_INVALID_REPLY =
  "この写真は保存できませんでした。JPEG、PNG、静止WebPのいずれかで、10MB以下の写真を送り直してね。";
const PHOTO_CAPACITY_REPLY =
  "写真の保存容量がいっぱいです。Webの写真日記から不要な写真を削除するか、Planを変更してから送り直してね。";
const PHOTO_FAILED_REPLY = "写真を保存できませんでした。時間をおいて、写真をもう一度送ってね。";
const PHOTO_UNAVAILABLE_REPLY =
  "写真日記はまだ準備中です。いまは写真を保存していないので、日記はテキストで送ってね。";

type LineImageEvent = Readonly<{
  webhookEventId?: string;
  timestamp: number;
  replyToken?: string;
  source: Readonly<{ type: "user"; userId: string }>;
  message: Readonly<{
    id: string;
    type: "image";
    contentProvider?: Readonly<{ type: "line" | "external" }>;
  }>;
}>;

type ValidatedImage = Readonly<{
  bytes: Uint8Array;
  mimeType: PhotoDiaryMimeType;
  width: number;
  height: number;
}>;

function byteSequence(bytes: Uint8Array, value: readonly number[]): boolean {
  return value.every((byte, index) => bytes[index] === byte);
}

function asciiAt(bytes: Uint8Array, offset: number, value: string): boolean {
  if (offset + value.length > bytes.length) return false;
  return [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}

function detectedMimeType(bytes: Uint8Array): ValidatedImage["mimeType"] | null {
  if (byteSequence(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (byteSequence(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) return "image/webp";
  return null;
}

function uint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) * 0x1_00_00_00 +
      (bytes[offset + 1] ?? 0) * 0x1_00_00 +
      (bytes[offset + 2] ?? 0) * 0x1_00 +
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function uint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) +
      (bytes[offset + 1] ?? 0) * 0x1_00 +
      (bytes[offset + 2] ?? 0) * 0x1_00_00 +
      (bytes[offset + 3] ?? 0) * 0x1_00_00_00) >>>
    0
  );
}

function isAnimated(bytes: Uint8Array, mimeType: ValidatedImage["mimeType"]): boolean {
  if (mimeType === "image/png") {
    for (let offset = 8; offset + 12 <= bytes.length; ) {
      const chunkLength = uint32BigEndian(bytes, offset);
      if (asciiAt(bytes, offset + 4, "acTL")) return true;
      const nextOffset = offset + 12 + chunkLength;
      if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset || nextOffset > bytes.length) {
        break;
      }
      offset = nextOffset;
    }
  }
  if (mimeType === "image/webp") {
    for (let offset = 12; offset + 8 <= bytes.length; ) {
      if (asciiAt(bytes, offset, "ANIM") || asciiAt(bytes, offset, "ANMF")) return true;
      const chunkLength = uint32LittleEndian(bytes, offset + 4);
      const nextOffset = offset + 8 + chunkLength + (chunkLength % 2);
      if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset || nextOffset > bytes.length) {
        break;
      }
      offset = nextOffset;
    }
  }
  return false;
}

function normalizeImageInfoFormat(format: string): string {
  if (format === "jpeg" || format === "jpg") return "image/jpeg";
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";
  return format;
}

async function readLimitedBody(response: Response): Promise<Uint8Array | null> {
  if (!response.body) return null;
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PHOTO_DIARY_BYTES) {
    await response.body.cancel();
    return null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_PHOTO_DIARY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  if (length === 0) return null;
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function validatePhotoDiaryImage(
  response: Response,
  images: ImagesBinding,
): Promise<ValidatedImage | null> {
  const declaredType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  const bytes = await readLimitedBody(response);
  if (!bytes) return null;
  const mimeType = detectedMimeType(bytes);
  if (!mimeType || declaredType !== mimeType || isAnimated(bytes, mimeType)) return null;
  try {
    const info = await images.info(new Blob([Uint8Array.from(bytes).buffer]).stream());
    if (!("width" in info) || normalizeImageInfoFormat(info.format) !== mimeType) return null;
    if (
      !Number.isSafeInteger(info.width) ||
      !Number.isSafeInteger(info.height) ||
      info.width <= 0 ||
      info.height <= 0 ||
      info.width * info.height > MAX_PHOTO_DIARY_PIXELS
    ) {
      return null;
    }
    return { bytes, mimeType, width: info.width, height: info.height };
  } catch {
    return null;
  }
}

async function notify(
  config: WorkerConfig,
  accountId: string,
  to: string,
  messageId: string,
  text: string,
): Promise<void> {
  if (!config.lineChannelAccessToken || !config.chatDeliverySecret) return;
  const retryKey = await createLineRetryKey(
    config.chatDeliverySecret,
    `photo:${accountId}:${messageId}:${text}`,
  );
  await pushLineTextWithRetryKey({
    channelAccessToken: config.lineChannelAccessToken,
    to,
    texts: [text],
    retryKey,
  });
}

/** 保存flagが無効な環境ではcontentへ触れず、同じmessageへ一度だけ固定案内を送る。 */
export async function notifyPhotoDiaryUnavailable(
  config: WorkerConfig,
  accountId: string,
  to: string,
  messageId: string,
): Promise<void> {
  await notify(config, accountId, to, messageId, PHOTO_UNAVAILABLE_REPLY);
}

export type PhotoDiaryProcessingResult = "stored" | "duplicate" | "invalid" | "capacity-exceeded";

/** 保存段階だけを実行し、画像をAI、Brain、Vectorへ渡す経路を持たない。 */
export async function processPhotoDiaryImage(
  event: LineImageEvent,
  accountId: string,
  cf: CloudflareBindings,
  config: WorkerConfig,
  isFinalAttempt = false,
): Promise<PhotoDiaryProcessingResult> {
  if (!cf.do.accountData || !cf.photoDiaryBucket || !cf.images) {
    throw new OperationalError({
      code: "PHOTO_DIARY_BINDING_MISSING",
      category: "configuration",
      stage: "photo.configure",
      retryable: true,
    });
  }
  if (!config.lineChannelAccessToken) {
    throw new OperationalError({
      code: "LINE_CONTENT_TOKEN_MISSING",
      category: "configuration",
      stage: "photo.download",
      retryable: true,
    });
  }
  const accountData = accountDataFor(cf.do.accountData, accountId);
  let existing = await accountData.execute("photoDiary.findByLineMessage", event.message.id);
  if (existing?.storageStatus === "available") {
    await notify(config, accountId, event.source.userId, event.message.id, PHOTO_SAVED_REPLY);
    return "duplicate";
  }
  if (existing?.storageStatus === "deleting" || existing?.storageStatus === "deleted") {
    return "duplicate";
  }
  if (existing?.storageStatus === "reserved") {
    try {
      const [original, thumbnail] = await Promise.all([
        cf.photoDiaryBucket.head(existing.originalObjectKey),
        cf.photoDiaryBucket.head(existing.thumbnailObjectKey),
      ]);
      const objectsAreComplete =
        original?.size === existing.byteSize &&
        original.httpMetadata?.contentType === existing.mimeType &&
        thumbnail?.size === existing.thumbnailByteSize &&
        thumbnail.httpMetadata?.contentType === "image/webp";
      if (objectsAreComplete) {
        await accountData.execute("photoDiary.complete", existing.id);
        await notify(config, accountId, event.source.userId, event.message.id, PHOTO_SAVED_REPLY);
        return "duplicate";
      }
      await cf.photoDiaryBucket.delete([existing.originalObjectKey, existing.thumbnailObjectKey]);
      const released = await accountData.execute("photoDiary.releaseReservation", existing.id);
      if (!released) throw new Error("Incomplete photo diary reservation could not be released");
      existing = null;
    } catch (error) {
      throw toOperationalError(error, {
        code: "PHOTO_DIARY_RESERVATION_RECOVERY_FAILED",
        category: "dependency",
        stage: "photo.recover",
        retryable: true,
        dependency: "r2",
      });
    }
  }
  const entitlement = await new billing.EntitlementService(
    cf.planAssignmentProvider ?? new billing.FamilyAwareAccountPlanAssignmentProvider(cf.d1),
  ).resolve(accountId);
  const storageLimitBytes = PHOTO_STORAGE_LIMITS[entitlement.plan];
  if (
    !existing &&
    (await accountData.execute("photoDiary.readStorageUsage")) >= storageLimitBytes
  ) {
    await notify(config, accountId, event.source.userId, event.message.id, PHOTO_CAPACITY_REPLY);
    return "capacity-exceeded";
  }
  const eventId = event.webhookEventId ?? event.message.id;
  let response: Response;
  try {
    response = await fetch(
      `https://api-data.line.me/v2/bot/message/${encodeURIComponent(event.message.id)}/content`,
      { headers: { Authorization: `Bearer ${config.lineChannelAccessToken}` } },
    );
  } catch (error) {
    if (isFinalAttempt) {
      await notify(config, accountId, event.source.userId, event.message.id, PHOTO_FAILED_REPLY);
      return "invalid";
    }
    throw toOperationalError(error, {
      code: "LINE_PHOTO_DOWNLOAD_FAILED",
      category: "dependency",
      stage: "photo.download",
      retryable: true,
      dependency: "line",
    });
  }
  if (!response.ok) {
    if (
      response.status === 404 ||
      response.status === 410 ||
      (response.status >= 400 && response.status < 500 && response.status !== 429)
    ) {
      await notify(config, accountId, event.source.userId, event.message.id, PHOTO_FAILED_REPLY);
      return "invalid";
    }
    if (isFinalAttempt) {
      await notify(config, accountId, event.source.userId, event.message.id, PHOTO_FAILED_REPLY);
      return "invalid";
    }
    throw new OperationalError({
      code: "LINE_PHOTO_DOWNLOAD_UNAVAILABLE",
      category: "dependency",
      stage: "photo.download",
      retryable: true,
      dependency: "line",
    });
  }
  const validated = await validatePhotoDiaryImage(response, cf.images);
  if (!validated) {
    await notify(config, accountId, event.source.userId, event.message.id, PHOTO_INVALID_REPLY);
    return "invalid";
  }

  let thumbnailBytes: Uint8Array;
  try {
    const thumbnail = await cf.images
      .input(new Blob([Uint8Array.from(validated.bytes).buffer]).stream())
      .transform({ width: THUMBNAIL_WIDTH, fit: "scale-down" })
      .output({ format: "image/webp", quality: 80, anim: false });
    thumbnailBytes = new Uint8Array(await thumbnail.response().arrayBuffer());
    if (thumbnailBytes.byteLength === 0) throw new Error("Thumbnail output was empty");
  } catch (error) {
    throw toOperationalError(error, {
      code: "PHOTO_DIARY_THUMBNAIL_FAILED",
      category: "dependency",
      stage: "photo.thumbnail",
      retryable: true,
      dependency: "cloudflare-images",
    });
  }

  const reservation = await accountData.execute("photoDiary.reserve", {
    webhookEventId: eventId,
    lineMessageId: event.message.id,
    mimeType: validated.mimeType,
    byteSize: validated.bytes.byteLength,
    thumbnailByteSize: thumbnailBytes.byteLength,
    storageByteSize: validated.bytes.byteLength + thumbnailBytes.byteLength,
    width: validated.width,
    height: validated.height,
    capturedAt: new Date(event.timestamp),
    storageLimitBytes,
  });
  if (reservation.type === "capacity-exceeded") {
    await notify(config, accountId, event.source.userId, event.message.id, PHOTO_CAPACITY_REPLY);
    return "capacity-exceeded";
  }
  if (reservation.media.storageStatus !== "reserved") {
    if (reservation.media.storageStatus === "available") {
      await notify(config, accountId, event.source.userId, event.message.id, PHOTO_SAVED_REPLY);
    }
    return "duplicate";
  }

  try {
    await cf.photoDiaryBucket.put(reservation.media.originalObjectKey, validated.bytes, {
      httpMetadata: { contentType: validated.mimeType },
    });
    await cf.photoDiaryBucket.put(reservation.media.thumbnailObjectKey, thumbnailBytes, {
      httpMetadata: { contentType: "image/webp" },
    });
    const completed = await accountData.execute("photoDiary.complete", reservation.media.id);
    if (!completed) throw new Error("Photo diary reservation could not be completed");
  } catch (error) {
    try {
      await cf.photoDiaryBucket.delete([
        reservation.media.originalObjectKey,
        reservation.media.thumbnailObjectKey,
      ]);
      await accountData.execute("photoDiary.releaseReservation", reservation.media.id);
    } catch {
      // cleanup失敗時は予約を残す。次回再配送でobjectを検証・上書きして回復する。
    }
    throw toOperationalError(error, {
      code: "PHOTO_DIARY_STORE_FAILED",
      category: "dependency",
      stage: "photo.store",
      retryable: true,
      dependency: "r2",
    });
  }
  await notify(config, accountId, event.source.userId, event.message.id, PHOTO_SAVED_REPLY);
  return "stored";
}
