import * as v from "valibot";
import type { operations } from "../../../generated/api";
import { createHttpClient } from "../../../infrastructure/http-client";
import type { AvatarState } from "../model/avatar";

type ApiAvatarState = operations["getAvatar"]["responses"][200]["content"]["application/json"];

const IdSchema = v.pipe(v.string(), v.uuid());
const TimestampSchema = v.pipe(v.string(), v.isoTimestamp());
const AvatarStateSchema = v.object({
  currentAvatar: v.nullable(v.object({ id: IdSchema, imageUrl: v.pipe(v.string(), v.nonEmpty()) })),
  job: v.nullable(
    v.object({
      id: IdSchema,
      status: v.picklist([
        "checking",
        "not_person",
        "verified",
        "accepted",
        "generating",
        "ready",
        "failed",
        "cancelled",
        "selected",
        "expired",
      ]),
      errorCode: v.nullable(v.string()),
      createdAt: TimestampSchema,
      updatedAt: TimestampSchema,
      expiresAt: TimestampSchema,
      candidates: v.array(
        v.object({
          id: IdSchema,
          imageUrl: v.pipe(v.string(), v.nonEmpty()),
          expiresAt: TimestampSchema,
        }),
      ),
    }),
  ),
}) satisfies v.GenericSchema<ApiAvatarState>;

class AvatarApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AvatarApiError";
    this.status = status;
  }
}

export type AvatarStateResult = {
  state: AvatarState;
  retryAfterMilliseconds: number | null;
};

function retryAfterMilliseconds(response: Response): number | null {
  const seconds = Number(response.headers.get("Retry-After"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : null;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  if (response.status === 401) return "本人確認に失敗しました。LINEから開き直してください。";
  if (response.status === 404) {
    const body = await response
      .clone()
      .json()
      .catch(() => null);
    if (body && typeof body === "object" && "reason" in body) {
      return "利用するには、先にLINE公式アカウントを友だち追加してください。";
    }
    return "処理対象が見つかりませんでした。画面を読み直してください。";
  }
  if (response.status === 409) return "処理状態が更新されました。画面を読み直してください。";
  if (response.status === 429) {
    return "短時間の生成上限に達しました。しばらく待ってからもう一度お試しください。";
  }
  if (response.status === 503)
    return "アバター機能は現在利用できません。時間をおいてお試しください。";
  if (response.status === 400) {
    const body = await response
      .clone()
      .json()
      .catch(() => null);
    const reason =
      body && typeof body === "object" && "reason" in body ? String(body.reason) : undefined;
    if (reason === "image_too_large") return "画像は10MB以下にしてください。";
    if (reason === "unsupported_image_type") return "PNG、JPEG、WebP形式の画像を選んでください。";
    if (reason === "invalid_image") return "画像を読み取れませんでした。別の画像を選んでください。";
    if (reason === "consent_required") return "画像を送信する前に同意を確認してください。";
  }
  return `${fallback} (HTTP ${response.status})`;
}

async function parseState(response: Response, fallback: string): Promise<AvatarStateResult> {
  if (!response.ok)
    throw new AvatarApiError(await errorMessage(response, fallback), response.status);
  return {
    state: v.parse(AvatarStateSchema, await response.json()),
    retryAfterMilliseconds: retryAfterMilliseconds(response),
  };
}

function authorization(idToken: string): HeadersInit {
  return { Authorization: `Bearer ${idToken}` };
}

export async function fetchAvatarState(
  apiUrl: string | undefined,
  idToken: string,
  signal?: AbortSignal,
): Promise<AvatarStateResult> {
  const response = await createHttpClient(apiUrl).request("/api/avatar", {
    headers: authorization(idToken),
    ...(signal ? { signal } : {}),
  });
  return parseState(response, "アバターの取得に失敗しました");
}

export async function uploadAvatarSource(
  apiUrl: string | undefined,
  idToken: string,
  file: File,
  signal?: AbortSignal,
): Promise<AvatarStateResult> {
  const form = new FormData();
  form.set("image", file);
  form.set("consent", "true");
  const response = await createHttpClient(apiUrl).request("/api/avatar/uploads", {
    method: "POST",
    headers: authorization(idToken),
    body: form,
    ...(signal ? { signal } : {}),
  });
  return parseState(response, "画像のアップロードに失敗しました");
}

export async function selectAvatar(
  apiUrl: string | undefined,
  idToken: string,
  candidateId: string,
  signal?: AbortSignal,
): Promise<AvatarStateResult> {
  const response = await createHttpClient(apiUrl).request("/api/avatar", {
    method: "PUT",
    headers: { ...authorization(idToken), "Content-Type": "application/json" },
    body: JSON.stringify({ candidateId }),
    ...(signal ? { signal } : {}),
  });
  return parseState(response, "アバターの設定に失敗しました");
}

export async function deleteAvatar(
  apiUrl: string | undefined,
  idToken: string,
  signal?: AbortSignal,
): Promise<void> {
  const response = await createHttpClient(apiUrl).request("/api/avatar", {
    method: "DELETE",
    headers: authorization(idToken),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new AvatarApiError(
      await errorMessage(response, "アバターの削除に失敗しました"),
      response.status,
    );
  }
}

export async function fetchAvatarImage(
  apiUrl: string | undefined,
  idToken: string,
  imageUrl: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await createHttpClient(apiUrl).request(imageUrl, {
    headers: authorization(idToken),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new AvatarApiError(
      await errorMessage(response, "画像の取得に失敗しました"),
      response.status,
    );
  }
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) {
    throw new AvatarApiError("画像の取得結果が不正です。", response.status);
  }
  return blob;
}
