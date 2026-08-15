import { D1 } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { Context } from "hono";
import * as v from "valibot";
import { getConfig } from "../config";
import {
  PersonalDataExportExpiredSchema,
  PersonalDataExportNotFoundSchema,
  PersonalDataExportNotReadySchema,
  PersonalDataExportResponseSchema,
} from "../contract/personal-data/exports";
import {
  CorrectPersonalDataRecordRequestSchema,
  InvalidPersonalDataMutationSchema,
  PersonalDataMutationResponseSchema,
  PersonalDataRecordNotFoundSchema,
  PersonalDataRecordsResponseSchema,
} from "../contract/personal-data/records";
import {
  AccountNotFoundErrorSchema,
  ServiceUnavailableErrorSchema,
  UnauthorizedErrorSchema,
} from "../contract/shared/errors";
import {
  correctPersonalData,
  deletePersonalData,
  downloadPersonalDataExport,
  getPersonalDataExport,
  listPersonalData,
  requestPersonalDataExport,
} from "../logic/personal-data";
import type { AppEnv } from "../types";
import { bearerToken } from "./auth";

function dependencies(c: Context<AppEnv>) {
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) return undefined;
  return {
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: getConfig(c.env).lineLoginChannelId,
    db: D1.shared.client.create(c.env.DB),
    accountData: c.env.ACCOUNT_DATA,
  };
}

function unavailable(c: Context<AppEnv>) {
  logger.error({ path: c.req.path }, "Personal data binding is not configured");
  return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
}

function authError(
  c: Context<AppEnv>,
  type: "account-not-found" | "unauthenticated" | "not-configured",
) {
  return type === "account-not-found"
    ? c.json(
        v.parse(AccountNotFoundErrorSchema, {
          error: "Account not found",
          reason: "friendship_required",
        }),
        404,
      )
    : c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
}

export async function getPersonalDataRecords(c: Context<AppEnv>): Promise<Response> {
  const deps = dependencies(c);
  if (!deps) return unavailable(c);
  const outcome = await listPersonalData(deps);
  if (outcome.type !== "resolved") return authError(c, outcome.type);
  c.header("Cache-Control", "no-store");
  return c.json(v.parse(PersonalDataRecordsResponseSchema, { records: outcome.records }));
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
  if (outcome.type !== "resolved") return authError(c, outcome.type);
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
    case "invalid-choice":
      return c.json(
        v.parse(InvalidPersonalDataMutationSchema, { error: "Invalid personal data mutation" }),
        422,
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
  if (outcome.type !== "resolved") return authError(c, outcome.type);
  if (outcome.result.type === "not-found") {
    return c.json(
      v.parse(PersonalDataRecordNotFoundSchema, { error: "Personal data record not found" }),
      404,
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

function exportResponse(result: {
  id: string;
  status: "queued" | "generating" | "ready" | "failed" | "expired";
  requestedAt: string;
  completedAt: string | null;
  expiresAt: string | null;
}) {
  return v.parse(PersonalDataExportResponseSchema, {
    export: {
      ...result,
      ...(result.status === "ready"
        ? { downloadUrl: `/api/personal-data/exports/${encodeURIComponent(result.id)}/download` }
        : {}),
    },
  });
}

export async function postPersonalDataExport(c: Context<AppEnv>): Promise<Response> {
  const deps = dependencies(c);
  if (!deps) return unavailable(c);
  const outcome = await requestPersonalDataExport(deps);
  if (outcome.type !== "resolved") return authError(c, outcome.type);
  c.header("Cache-Control", "no-store");
  return c.json({ ...exportResponse(outcome.result.export), outcome: outcome.result.outcome }, 202);
}

export async function getPersonalDataExportStatus(c: Context<AppEnv>): Promise<Response> {
  const deps = dependencies(c);
  if (!deps) return unavailable(c);
  const outcome = await getPersonalDataExport({
    ...deps,
    exportId: c.req.param("exportId") ?? "",
  });
  if (outcome.type !== "resolved") return authError(c, outcome.type);
  if (!outcome.result) {
    return c.json(
      v.parse(PersonalDataExportNotFoundSchema, { error: "Personal data export not found" }),
      404,
    );
  }
  c.header("Cache-Control", "no-store");
  return c.json(exportResponse(outcome.result));
}

export async function downloadPersonalDataExportContents(c: Context<AppEnv>): Promise<Response> {
  const deps = dependencies(c);
  if (!deps) return unavailable(c);
  const exportId = c.req.param("exportId") ?? "";
  const outcome = await downloadPersonalDataExport({ ...deps, exportId });
  if (outcome.type !== "resolved") return authError(c, outcome.type);
  if (outcome.result.type === "not-found") {
    return c.json(
      v.parse(PersonalDataExportNotFoundSchema, { error: "Personal data export not found" }),
      404,
    );
  }
  if (outcome.result.type === "expired") {
    return c.json(
      v.parse(PersonalDataExportExpiredSchema, { error: "Personal data export expired" }),
      410,
    );
  }
  if (outcome.result.type === "not-ready") {
    return c.json(
      v.parse(PersonalDataExportNotReadySchema, { error: "Personal data export is not ready" }),
      409,
    );
  }
  return new Response(JSON.stringify(outcome.result.archive), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="me-builder-personal-data-${exportId}.json"`,
      "Content-Type": "application/json; charset=utf-8",
      Expires: new Date(outcome.result.expiresAt).toUTCString(),
    },
  });
}
