import { D1, accountDataFor } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { Context } from "hono";
import * as v from "valibot";
import { getConfig, isDevelopmentEnvironment } from "../config";
import { ProfileEntitlementResponseSchema } from "../contract/profile/entitlement";
import {
  AgreeGoalFollowUpRequestSchema,
  GoalFollowUpListSchema,
  GoalFollowUpMutationSchema,
  GoalFollowUpUnavailableSchema,
  InvalidGoalFollowUpSchema,
  UpdateGoalFollowUpRequestSchema,
} from "../contract/profile/goal-follow-up";
import { ProfileProgressionResponseSchema } from "../contract/profile/progression";
import {
  ProfileSummaryGenerationAcceptedSchema,
  ProfileSummaryGenerationUnavailableSchema,
  ProfileSummaryInsightSelfViewRequestSchema,
  ProfileSummaryInsightSelfViewResponseSchema,
  ProfileSummaryResponseSchema,
} from "../contract/profile/summary";
import {
  WeeklyReflectionGenerationAcceptedSchema,
  WeeklyReflectionGenerationUnavailableSchema,
  WeeklyReflectionResponseSchema,
} from "../contract/profile/weekly-reflection";
import { ServiceUnavailableErrorSchema } from "../contract/shared/errors";
import { agreeGoalFollowUp, getGoalFollowUps, updateGoalFollowUp } from "../logic/goal-follow-up";
import { getProfileEntitlement } from "../logic/profile-entitlement";
import { getProfileProgression } from "../logic/profile-progression";
import { getProfileSummary } from "../logic/profile-summary";
import { requestProfileSummaryGeneration } from "../logic/profile-summary-generation";
import {
  getWeeklyReflections,
  requestWeeklyReflectionGeneration,
} from "../logic/weekly-reflection";
import { authenticatedActor } from "../middleware/authentication";
import type { AppEnv } from "../types";

function planAssignmentProvider(c: Context<AppEnv>, db: D1.shared.Client) {
  return (
    c.env.ACCOUNT_PLAN_ASSIGNMENT_PROVIDER ??
    new D1.shared.action.billing.D1AccountPlanAssignmentProvider(db)
  );
}

function goalFollowUpParams(c: Context<AppEnv>) {
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) return undefined;
  const db = D1.shared.client.create(c.env.DB);
  return {
    actor: authenticatedActor(c),
    db,
    accountData: c.env.ACCOUNT_DATA,
    planAssignmentProvider: planAssignmentProvider(c, db),
  };
}

export async function getGoalFollowUpContents(c: Context<AppEnv>): Promise<Response> {
  const params = goalFollowUpParams(c);
  if (!params) {
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const outcome = await getGoalFollowUps(params);
  c.header("Cache-Control", "no-store");
  return c.json(v.parse(GoalFollowUpListSchema, outcome));
}

export async function postGoalFollowUpAgreement(c: Context<AppEnv>): Promise<Response> {
  const params = goalFollowUpParams(c);
  if (!params) {
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const parsed = v.safeParse(AgreeGoalFollowUpRequestSchema, await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(v.parse(InvalidGoalFollowUpSchema, { error: "Invalid goal follow-up" }), 400);
  }
  const outcome = await agreeGoalFollowUp({ ...params, ...parsed.output });
  if (outcome.type === "unavailable") {
    return c.json(
      v.parse(GoalFollowUpUnavailableSchema, {
        error: "Goal follow-up unavailable",
        reason: outcome.reason,
      }),
      409,
    );
  }
  if (outcome.result.type !== "agreed") {
    return c.json(
      v.parse(GoalFollowUpUnavailableSchema, {
        error: "Goal follow-up unavailable",
        reason:
          outcome.result.type === "goal-not-found"
            ? "goal_not_found"
            : outcome.result.type === "active-limit-reached"
              ? "active_limit"
              : "goal_not_confirmed",
      }),
      409,
    );
  }
  return c.json(v.parse(GoalFollowUpMutationSchema, { item: outcome.result.item }));
}

export async function patchGoalFollowUp(c: Context<AppEnv>): Promise<Response> {
  const params = goalFollowUpParams(c);
  if (!params) {
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const parsed = v.safeParse(UpdateGoalFollowUpRequestSchema, await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(v.parse(InvalidGoalFollowUpSchema, { error: "Invalid goal follow-up" }), 400);
  }
  const outcome = await updateGoalFollowUp({
    ...params,
    id: c.req.param("goalFollowUpId") ?? "",
    input: {
      ...(parsed.output.status ? { status: parsed.output.status } : {}),
      ...(parsed.output.nextStep ? { nextStep: parsed.output.nextStep } : {}),
    },
  });
  if (outcome.type === "unavailable") {
    return c.json(
      v.parse(GoalFollowUpUnavailableSchema, {
        error: "Goal follow-up unavailable",
        reason: outcome.reason,
      }),
      409,
    );
  }
  if (outcome.result.type !== "updated") {
    return c.json(
      v.parse(GoalFollowUpUnavailableSchema, {
        error: "Goal follow-up unavailable",
        reason: outcome.result.type === "active-limit-reached" ? "active_limit" : "goal_not_found",
      }),
      409,
    );
  }
  return c.json(v.parse(GoalFollowUpMutationSchema, { item: outcome.result.item }));
}

export async function getProfileProgressionContents(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) {
    logger.error({ path: c.req.path }, "Profile progression storage binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const outcome = await getProfileProgression({
    actor: authenticatedActor(c),
    accountData: c.env.ACCOUNT_DATA,
  });
  c.header("Cache-Control", "no-store");
  return c.json(v.parse(ProfileProgressionResponseSchema, outcome));
}

export async function getProfileEntitlementContents(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) {
    logger.error({ path: c.req.path }, "Profile entitlement storage binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const db = D1.shared.client.create(c.env.DB);
  const outcome = await getProfileEntitlement({
    actor: authenticatedActor(c),
    db,
    accountData: c.env.ACCOUNT_DATA,
    planAssignmentProvider: planAssignmentProvider(c, db),
  });
  c.header("Cache-Control", "no-store");
  return c.json(v.parse(ProfileEntitlementResponseSchema, outcome));
}

export async function getProfileSummaryContents(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) {
    logger.error({ path: c.req.path }, "Profile storage binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }

  const currentConfig = getConfig(c.env);
  const outcome = await getProfileSummary({
    actor: authenticatedActor(c),
    accountData: c.env.ACCOUNT_DATA,
    allowUnchangedRegeneration: isDevelopmentEnvironment(currentConfig.environment),
  });

  switch (outcome.type) {
    case "resolved":
      c.header("Cache-Control", "no-store");
      return c.json(
        v.parse(ProfileSummaryResponseSchema, {
          versions: outcome.versions,
          availableDataCounts: outcome.availableDataCounts,
          generation: outcome.generation,
          diagnosisThemes: outcome.diagnosisThemes,
          nextAction: outcome.nextAction,
        }),
      );
  }
}

export async function postProfileSummaryGeneration(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB || !c.env.ACCOUNT_DATA || !c.env.PROFILE_SUMMARY_QUEUE) {
    logger.error({ path: c.req.path }, "Profile Summary generation binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const currentConfig = getConfig(c.env);
  const db = D1.shared.client.create(c.env.DB);
  const outcome = await requestProfileSummaryGeneration({
    actor: authenticatedActor(c),
    db,
    accountData: c.env.ACCOUNT_DATA,
    queue: c.env.PROFILE_SUMMARY_QUEUE,
    allowUnchangedRegeneration: isDevelopmentEnvironment(currentConfig.environment),
  });
  switch (outcome.type) {
    case "accepted":
      return c.json(v.parse(ProfileSummaryGenerationAcceptedSchema, outcome), 202);
    case "unavailable":
      return c.json(
        v.parse(ProfileSummaryGenerationUnavailableSchema, {
          error: "Profile summary generation unavailable",
          reason: outcome.reason,
        }),
        409,
      );
  }
}

export async function putProfileSummaryInsightSelfView(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.ACCOUNT_DATA) {
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const input = v.parse(ProfileSummaryInsightSelfViewRequestSchema, await c.req.json());
  const account = accountDataFor(c.env.ACCOUNT_DATA, authenticatedActor(c).accountId);
  const updated = await account.execute(
    "profileSummary.setInsightSelfView",
    input.versionId,
    input.insightKey,
    input.selfView,
  );
  if (!updated) return c.json({ error: "Not Found" }, 404);
  return c.json(v.parse(ProfileSummaryInsightSelfViewResponseSchema, { updated: true }));
}

export async function getWeeklyReflectionContents(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) {
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const db = D1.shared.client.create(c.env.DB);
  const outcome = await getWeeklyReflections({
    actor: authenticatedActor(c),
    db,
    accountData: c.env.ACCOUNT_DATA,
    planAssignmentProvider: planAssignmentProvider(c, db),
  });
  switch (outcome.type) {
    case "resolved":
      c.header("Cache-Control", "no-store");
      return c.json(v.parse(WeeklyReflectionResponseSchema, outcome));
  }
}

export async function postWeeklyReflectionGeneration(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB || !c.env.ACCOUNT_DATA || !c.env.PROFILE_SUMMARY_QUEUE) {
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const db = D1.shared.client.create(c.env.DB);
  const outcome = await requestWeeklyReflectionGeneration({
    actor: authenticatedActor(c),
    db,
    accountData: c.env.ACCOUNT_DATA,
    queue: c.env.PROFILE_SUMMARY_QUEUE,
    planAssignmentProvider: planAssignmentProvider(c, db),
  });
  switch (outcome.type) {
    case "accepted":
      return c.json(v.parse(WeeklyReflectionGenerationAcceptedSchema, outcome), 202);
    case "unavailable":
      return c.json(
        v.parse(WeeklyReflectionGenerationUnavailableSchema, {
          error: "Weekly reflection generation unavailable",
          reason: outcome.reason,
        }),
        409,
      );
  }
}
