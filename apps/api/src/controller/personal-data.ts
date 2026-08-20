import { logger } from "@me-builder/shared";
import type { Context } from "hono";
import * as v from "valibot";
import { PersonalDataFeaturesResponseSchema } from "../contract/personal-data/features";
import {
  CorrectPersonalDataRecordRequestSchema,
  ImmutableDiagnosisAnswerSchema,
  InvalidPersonalDataMutationSchema,
  PersonalDataMutationResponseSchema,
  PersonalDataRecordNotFoundSchema,
  PersonalDataRecordsResponseSchema,
} from "../contract/personal-data/records";
import { ServiceUnavailableErrorSchema } from "../contract/shared/errors";
import {
  correctPersonalData,
  deletePersonalData,
  getPersonalDataFeatures,
  listPersonalData,
} from "../logic/personal-data";
import { authenticatedActor } from "../middleware/authentication";
import type { AppEnv } from "../types";

function dependencies(c: Context<AppEnv>) {
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) return undefined;
  return {
    actor: authenticatedActor(c),
    accountData: c.env.ACCOUNT_DATA,
  };
}

function unavailable(c: Context<AppEnv>) {
  logger.error({ path: c.req.path }, "Personal data binding is not configured");
  return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
}

export async function getPersonalDataRecords(c: Context<AppEnv>): Promise<Response> {
  const deps = dependencies(c);
  if (!deps) return unavailable(c);
  const outcome = await listPersonalData(deps);
  c.header("Cache-Control", "no-store");
  return c.json(v.parse(PersonalDataRecordsResponseSchema, { records: outcome.records }));
}

export async function getPersonalDataFeatureContents(c: Context<AppEnv>): Promise<Response> {
  const deps = dependencies(c);
  if (!deps) return unavailable(c);
  const outcome = await getPersonalDataFeatures(deps);
  c.header("Cache-Control", "no-store");
  return c.json(v.parse(PersonalDataFeaturesResponseSchema, outcome.features));
}

export async function patchPersonalDataRecord(c: Context<AppEnv>): Promise<Response> {
  const deps = dependencies(c);
  if (!deps) return unavailable(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      v.parse(InvalidPersonalDataMutationSchema, { error: "Invalid personal data mutation" }),
      400,
    );
  }
  const input = v.safeParse(CorrectPersonalDataRecordRequestSchema, body);
  if (!input.success) {
    return c.json(
      v.parse(InvalidPersonalDataMutationSchema, { error: "Invalid personal data mutation" }),
      400,
    );
  }
  const outcome = await correctPersonalData({
    ...deps,
    sourceRecordId: c.req.param("sourceRecordId") ?? "",
    input: input.output,
  });
  switch (outcome.result.type) {
    case "updated":
    case "unchanged":
      return c.json(
        v.parse(PersonalDataMutationResponseSchema, {
          outcome: outcome.result.type,
          recordId: outcome.result.recordId,
          invalidatedBrainItemCount: outcome.result.invalidatedBrainItemCount,
        }),
      );
    case "not-found":
      return c.json(
        v.parse(PersonalDataRecordNotFoundSchema, { error: "Personal data record not found" }),
        404,
      );
    case "kind-mismatch":
      return c.json(
        v.parse(InvalidPersonalDataMutationSchema, { error: "Invalid personal data mutation" }),
        400,
      );
    case "immutable-diagnosis":
      return c.json(
        v.parse(ImmutableDiagnosisAnswerSchema, { error: "Diagnosis answer is immutable" }),
        409,
      );
    case "deleted":
      throw new Error("Correction returned an unsupported deleted result");
  }
}

export async function deletePersonalDataRecordContents(c: Context<AppEnv>): Promise<Response> {
  const deps = dependencies(c);
  if (!deps) return unavailable(c);
  const outcome = await deletePersonalData({
    ...deps,
    sourceRecordId: c.req.param("sourceRecordId") ?? "",
  });
  if (outcome.result.type === "not-found") {
    return c.json(
      v.parse(PersonalDataRecordNotFoundSchema, { error: "Personal data record not found" }),
      404,
    );
  }
  if (outcome.result.type === "immutable-diagnosis") {
    return c.json(
      v.parse(ImmutableDiagnosisAnswerSchema, { error: "Diagnosis answer is immutable" }),
      409,
    );
  }
  if (outcome.result.type !== "deleted") {
    throw new Error("Deletion returned an unsupported result");
  }
  return c.json(
    v.parse(PersonalDataMutationResponseSchema, {
      outcome: "deleted",
      recordId: outcome.result.recordId,
      invalidatedBrainItemCount: outcome.result.invalidatedBrainItemCount,
    }),
  );
}
