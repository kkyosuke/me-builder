import * as v from "valibot";
import type { operations } from "../../../generated/api";
import { OperationError, ValidationError } from "../../../infrastructure/errors";
import { createHttpClient } from "../../../infrastructure/http-client";
import type { AvatarSelection } from "../model/avatar";

type ApiResponse = operations["getProfile"]["responses"][200]["content"]["application/json"];

const ProfileResponseSchema = v.object({
  role: v.picklist(["user", "admin"]),
  avatar: v.nullable(
    v.object({
      source: v.picklist(["uploaded", "line"]),
      url: v.pipe(v.string(), v.nonEmpty()),
      updatedAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
    }),
  ),
}) satisfies v.GenericSchema<ApiResponse>;

export type AccountProfile = v.InferOutput<typeof ProfileResponseSchema>;

function profileError(operation: "取得" | "保存" | "削除", status: number): OperationError {
  if (status === 401) {
    return new OperationError("本人確認に失敗しました。LINEから開き直してください。", {
      code: "PROFILE_UNAUTHORIZED",
      status,
    });
  }
  if (status === 404) {
    return new OperationError("利用するには、先にLINE公式アカウントを友だち追加してください。", {
      code: "PROFILE_ACCOUNT_NOT_FOUND",
      status,
    });
  }
  if (status === 413) {
    return new OperationError("画像の容量が大きすぎます。別の画像を選んでください。", {
      code: "PROFILE_AVATAR_TOO_LARGE",
      status,
    });
  }
  if (status === 415 || status === 422) {
    return new OperationError("画像を保存できませんでした。別の画像を選んでください。", {
      code: "PROFILE_AVATAR_INVALID",
      status,
    });
  }
  return new OperationError(`プロフィールの${operation}に失敗しました。再試行してください。`, {
    code: `PROFILE_${operation === "取得" ? "FETCH" : operation === "保存" ? "SAVE" : "DELETE"}_FAILED`,
    status,
  });
}

function profileNetworkError(operation: "取得" | "保存" | "削除", cause: unknown): OperationError {
  return new OperationError(`プロフィールの${operation}に失敗しました。再試行してください。`, {
    code: `PROFILE_${operation === "取得" ? "FETCH" : operation === "保存" ? "SAVE" : "DELETE"}_FAILED`,
    cause,
  });
}

async function requestProfile(
  apiUrl: string | undefined,
  path: string,
  init: RequestInit,
  operation: "取得" | "保存" | "削除",
): Promise<Response> {
  try {
    return await createHttpClient(apiUrl).request(path, init);
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw profileNetworkError(operation, error);
  }
}

async function parseProfileResponse(response: Response, operation: "取得" | "保存" | "削除") {
  if (!response.ok) throw profileError(operation, response.status);
  try {
    return v.parse(ProfileResponseSchema, await response.json());
  } catch (error) {
    throw new ValidationError("プロフィールの応答を確認できませんでした。再試行してください。", {
      code: "PROFILE_RESPONSE_INVALID",
      status: response.status,
      cause: error,
    });
  }
}

function decodeAvatarDataUrl(
  dataUrl: string,
): Readonly<{ contentType: string; bytes: Uint8Array }> {
  const matched = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!matched?.[1] || !matched[2]) {
    throw new ValidationError("選択した画像を読み込めませんでした。選び直してください。", {
      code: "PROFILE_AVATAR_DATA_URL_INVALID",
    });
  }
  try {
    return {
      contentType: matched[1],
      bytes: Uint8Array.from(atob(matched[2]), (value) => value.charCodeAt(0)),
    };
  } catch (error) {
    throw new ValidationError("選択した画像を読み込めませんでした。選び直してください。", {
      code: "PROFILE_AVATAR_DATA_URL_INVALID",
      cause: error,
    });
  }
}

export async function fetchAccountProfile(
  apiUrl: string | undefined,
  idToken: string,
  signal?: AbortSignal,
): Promise<AccountProfile> {
  const response = await requestProfile(
    apiUrl,
    "/api/profile",
    {
      headers: { Authorization: `Bearer ${idToken}` },
      ...(signal ? { signal } : {}),
    },
    "取得",
  );
  return parseProfileResponse(response, "取得");
}

export async function saveAccountAvatar(
  apiUrl: string | undefined,
  idToken: string,
  avatar: AvatarSelection,
  signal?: AbortSignal,
): Promise<AccountProfile> {
  const { contentType, bytes } = decodeAvatarDataUrl(avatar.dataUrl);
  const response = await requestProfile(
    apiUrl,
    "/api/profile/avatar",
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": contentType },
      body: bytes.buffer as ArrayBuffer,
      ...(signal ? { signal } : {}),
    },
    "保存",
  );
  return parseProfileResponse(response, "保存");
}

export async function deleteAccountAvatar(
  apiUrl: string | undefined,
  idToken: string,
  signal?: AbortSignal,
): Promise<AccountProfile> {
  const response = await requestProfile(
    apiUrl,
    "/api/profile/avatar",
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${idToken}` },
      ...(signal ? { signal } : {}),
    },
    "削除",
  );
  return parseProfileResponse(response, "削除");
}
