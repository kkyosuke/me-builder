import * as v from "valibot";
import {
  AuthenticationError,
  OperationError,
  ValidationError,
} from "../../../infrastructure/errors";
import { createAuthenticatedHttpClient } from "../../../infrastructure/http-client";

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());
const PersonalDataRecordSchema = v.variant("kind", [
  v.object({
    id: NonEmptyStringSchema,
    kind: v.literal("diagnosis"),
    title: NonEmptyStringSchema,
    value: NonEmptyStringSchema,
    recordedAt: v.pipe(v.string(), v.isoTimestamp()),
    diagnosisId: NonEmptyStringSchema,
    choices: v.array(v.object({ id: NonEmptyStringSchema, label: NonEmptyStringSchema })),
  }),
  v.object({
    id: NonEmptyStringSchema,
    kind: v.literal("diary"),
    title: v.literal("日記"),
    value: NonEmptyStringSchema,
    recordedAt: v.pipe(v.string(), v.isoTimestamp()),
  }),
]);
const RecordsResponseSchema = v.object({ records: v.array(PersonalDataRecordSchema) });
const MutationResponseSchema = v.object({
  outcome: v.picklist(["updated", "deleted", "unchanged"]),
  recordId: NonEmptyStringSchema,
  invalidatedBrainItemCount: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
});
const TimestampSchema = v.pipe(v.string(), v.isoTimestamp());
const PersonalDataFeaturesSchema = v.object({
  format: v.literal("kagami-brain-features"),
  formatVersion: v.literal(1),
  generatedAt: TimestampSchema,
  scopes: v.tuple([v.literal("metadata"), v.literal("active"), v.literal("history")]),
  brainItems: v.array(
    v.object({
      category: NonEmptyStringSchema,
      status: v.picklist(["active", "superseded", "invalidated"]),
      derivation: v.picklist(["ai", "deterministic"]),
      isInference: v.boolean(),
      stability: NonEmptyStringSchema,
      sensitivity: NonEmptyStringSchema,
      validFrom: v.nullable(TimestampSchema),
      validTo: v.nullable(TimestampSchema),
      firstObservedAt: TimestampSchema,
      lastObservedAt: TimestampSchema,
      createdAt: TimestampSchema,
      updatedAt: TimestampSchema,
    }),
  ),
});
export type PersonalDataRecord = v.InferOutput<typeof PersonalDataRecordSchema>;
export type PersonalDataMutationResult = v.InferOutput<typeof MutationResponseSchema>;
export type PersonalDataCorrection = Readonly<{ kind: "diary"; value: string }>;
export type PersonalDataFeatures = v.InferOutput<typeof PersonalDataFeaturesSchema>;

function requestError(status: number): Error {
  if (status === 401) {
    return new AuthenticationError("本人確認に失敗しました。LINEから開き直してください。", {
      code: "AUTHENTICATION_REQUIRED",
      status,
    });
  }
  if (status === 404) {
    return new OperationError("対象のデータはすでに削除または訂正されています。", {
      code: "PERSONAL_DATA_NOT_FOUND",
      status,
    });
  }
  return new OperationError("入力データを更新できませんでした。再試行してください。", {
    code: "PERSONAL_DATA_REQUEST_FAILED",
    status,
  });
}

async function parse<TSchema extends v.GenericSchema>(response: Response, schema: TSchema) {
  if (!response.ok) throw requestError(response.status);
  try {
    return v.parse(schema, await response.json());
  } catch (error) {
    throw new ValidationError("入力データの応答を確認できませんでした。", {
      code: "PERSONAL_DATA_RESPONSE_INVALID",
      cause: error,
    });
  }
}

export async function fetchPersonalDataRecords(
  apiUrl: string | undefined,
  signal?: AbortSignal,
): Promise<readonly PersonalDataRecord[]> {
  const response = await createAuthenticatedHttpClient(apiUrl).request(
    "/api/personal-data/records",
    {
      ...(signal ? { signal } : {}),
    },
  );
  return (await parse(response, RecordsResponseSchema)).records;
}

export async function fetchPersonalDataFeatures(
  apiUrl: string | undefined,
  signal?: AbortSignal,
): Promise<PersonalDataFeatures> {
  const response = await createAuthenticatedHttpClient(apiUrl).request(
    "/api/personal-data/features",
    signal ? { signal } : undefined,
  );
  return parse(response, PersonalDataFeaturesSchema);
}

export async function correctPersonalDataRecord(
  apiUrl: string | undefined,
  sourceRecordId: string,
  correction: PersonalDataCorrection,
): Promise<PersonalDataMutationResult> {
  const response = await createAuthenticatedHttpClient(apiUrl).request(
    `/api/personal-data/records/${encodeURIComponent(sourceRecordId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(correction),
    },
  );
  return parse(response, MutationResponseSchema);
}

export async function deletePersonalDataRecord(
  apiUrl: string | undefined,
  sourceRecordId: string,
): Promise<PersonalDataMutationResult> {
  const response = await createAuthenticatedHttpClient(apiUrl).request(
    `/api/personal-data/records/${encodeURIComponent(sourceRecordId)}`,
    {
      method: "DELETE",
    },
  );
  return parse(response, MutationResponseSchema);
}
