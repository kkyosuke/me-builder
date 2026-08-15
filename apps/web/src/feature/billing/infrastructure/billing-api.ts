import * as v from "valibot";
import type { operations } from "../../../generated/api";
import { OperationError, ValidationError } from "../../../infrastructure/errors";
import { createHttpClient } from "../../../infrastructure/http-client";

type PortalResponse =
  operations["createBillingPortalSession"]["responses"][201]["content"]["application/json"];
const PortalResponseSchema = v.object({
  url: v.pipe(v.string(), v.url()),
}) satisfies v.GenericSchema<PortalResponse>;

export async function createCustomerPortalSession(
  apiUrl: string | undefined,
  idToken: string,
  signal?: AbortSignal,
): Promise<string> {
  let response: Response;
  try {
    response = await createHttpClient(apiUrl).request("/api/billing/portal-sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}` },
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new OperationError("契約管理を開けませんでした。時間をおいて再試行してください。", {
      code: "BILLING_PORTAL_NETWORK_FAILED",
      cause: error,
    });
  }
  if (response.status === 409) {
    throw new OperationError("管理できる契約がまだありません。契約反映後に再試行してください。", {
      code: "BILLING_CUSTOMER_NOT_FOUND",
      status: response.status,
    });
  }
  if (!response.ok) {
    throw new OperationError("契約管理を開けませんでした。時間をおいて再試行してください。", {
      code: "BILLING_PORTAL_FAILED",
      status: response.status,
    });
  }
  try {
    return v.parse(PortalResponseSchema, await response.json()).url;
  } catch (error) {
    throw new ValidationError("契約管理の応答を確認できませんでした。", {
      code: "BILLING_PORTAL_RESPONSE_INVALID",
      status: response.status,
      cause: error,
    });
  }
}
