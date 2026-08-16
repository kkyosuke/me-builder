import * as v from "valibot";
import { OperationError, ValidationError } from "../../../infrastructure/errors";
import { createAuthenticatedHttpClient } from "../../../infrastructure/http-client";

const RecoveryCodeSchema = v.object({
  code: v.pipe(v.string(), v.nonEmpty()),
  expiresAt: v.pipe(v.string(), v.isoTimestamp()),
});
const RecoveryCompleteSchema = v.object({
  status: v.literal("recovered"),
  alreadyRecovered: v.boolean(),
});

async function recoveryRequest(
  apiUrl: string | undefined,
  path: string,
  body?: unknown,
): Promise<Response> {
  try {
    return await createAuthenticatedHttpClient(apiUrl).request(path, {
      method: "POST",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (cause) {
    throw new OperationError("Account復旧サーバーへ接続できませんでした。", {
      code: "ACCOUNT_RECOVERY_NETWORK_ERROR",
      cause,
    });
  }
}

export async function issueRecoveryCode(apiUrl: string | undefined) {
  const response = await recoveryRequest(apiUrl, "/api/account-recovery/codes");
  if (!response.ok) {
    throw new OperationError(
      response.status === 409
        ? "復旧コードは有料契約があるAccountで発行できます。"
        : "復旧コードを発行できませんでした。",
      { code: "ACCOUNT_RECOVERY_CODE_FAILED", status: response.status },
    );
  }
  try {
    return v.parse(RecoveryCodeSchema, await response.json());
  } catch (cause) {
    throw new ValidationError("復旧コードの応答を確認できませんでした。", {
      code: "ACCOUNT_RECOVERY_CODE_INVALID",
      cause,
    });
  }
}

export async function completeRecovery(apiUrl: string | undefined, code: string) {
  const response = await recoveryRequest(apiUrl, "/api/account-recovery/complete", {
    code,
  });
  if (!response.ok) {
    throw new OperationError(
      response.status === 409
        ? "このLINE Accountは別のAccountで利用されています。"
        : response.status === 429
          ? "試行回数が上限に達しました。しばらく待ってからやり直してください。"
          : "復旧コードを確認できませんでした。",
      { code: "ACCOUNT_RECOVERY_COMPLETE_FAILED", status: response.status },
    );
  }
  try {
    return v.parse(RecoveryCompleteSchema, await response.json());
  } catch (cause) {
    throw new ValidationError("Account復旧の応答を確認できませんでした。", {
      code: "ACCOUNT_RECOVERY_RESPONSE_INVALID",
      cause,
    });
  }
}
