import * as v from "valibot";
import type { operations } from "../../../generated/api";
import { createHttpClient } from "../../../infrastructure/http-client";
import type { ServiceTermsStatus } from "../model/service-terms";

type StatusResponse =
  operations["getServiceTermsStatus"]["responses"][200]["content"]["application/json"];
type AcceptanceResponse =
  operations["acceptServiceTerms"]["responses"][200]["content"]["application/json"];

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());
const StatusSchema = v.object({
  document: v.object({
    documentKey: v.literal("terms_of_service"),
    version: NonEmptyStringSchema,
    publishedAt: v.pipe(v.string(), v.isoTimestamp()),
    title: NonEmptyStringSchema,
    summary: NonEmptyStringSchema,
    sections: v.array(
      v.object({ heading: NonEmptyStringSchema, paragraphs: v.array(NonEmptyStringSchema) }),
    ),
  }),
  acceptance: v.object({
    required: v.boolean(),
    acceptedAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
  }),
}) satisfies v.GenericSchema<StatusResponse>;
const AcceptanceSchema = v.object({
  documentKey: v.literal("terms_of_service"),
  version: NonEmptyStringSchema,
  acceptedAt: v.pipe(v.string(), v.isoTimestamp()),
}) satisfies v.GenericSchema<AcceptanceResponse>;

function errorFor(status: number): Error {
  if (status === 401) return new Error("本人確認に失敗しました。LINEから開き直してください。");
  return new Error("利用規約を確認できませんでした。再試行してください。");
}

export class ServiceTermsVersionConflictError extends Error {
  constructor() {
    super("利用規約が更新されました。最新の内容を読み直してください。");
    this.name = "ServiceTermsVersionConflictError";
  }
}

export async function fetchServiceTermsStatus(
  apiUrl: string | undefined,
  idToken: string,
  signal?: AbortSignal,
): Promise<ServiceTermsStatus> {
  const response = await createHttpClient(apiUrl).request("/api/legal/terms", {
    headers: { Authorization: `Bearer ${idToken}` },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw errorFor(response.status);
  return v.parse(StatusSchema, await response.json());
}

export async function acceptServiceTerms(
  apiUrl: string | undefined,
  idToken: string,
  version: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await createHttpClient(apiUrl).request("/api/legal/terms/acceptance", {
    method: "PUT",
    headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ version }),
    ...(signal ? { signal } : {}),
  });
  if (response.status === 409) {
    throw new ServiceTermsVersionConflictError();
  }
  if (!response.ok) throw errorFor(response.status);
  return v.parse(AcceptanceSchema, await response.json()).acceptedAt;
}
