import { resolver } from "hono-openapi";
import * as v from "valibot";

export const UnauthorizedErrorSchema = v.object({
  error: v.literal("Unauthorized"),
});

export const AccountNotFoundErrorSchema = v.object({
  error: v.literal("Account not found"),
  reason: v.literal("friendship_required"),
});

export const ServiceUnavailableErrorSchema = v.object({
  error: v.literal("Service Unavailable"),
});

export const InternalServerErrorSchema = v.object({
  error: v.literal("Internal Server Error"),
});

const jsonResponse = (description: string, schema: Parameters<typeof resolver>[0]) => ({
  description,
  content: {
    "application/json": {
      schema: resolver(schema),
    },
  },
});

export const authenticatedErrors = {
  401: jsonResponse("LIFF IDトークンを検証できない", UnauthorizedErrorSchema),
  404: jsonResponse("対応するAccountが存在しない", AccountNotFoundErrorSchema),
  503: jsonResponse("D1 bindingが設定されていない", ServiceUnavailableErrorSchema),
  500: jsonResponse("未処理のサーバーエラー", InternalServerErrorSchema),
};

export { jsonResponse };
