import { type PlanCode, planCodes } from "./account-plan-assignment";
import capabilityCatalogJson from "./capability-catalog.json";
import planCapabilityMappingJson from "./plan-capability-mapping.json";

const capabilityKinds = ["toggle", "quota", "mode", "lookback", "limit"] as const;
type CapabilityKind = (typeof capabilityKinds)[number];

export type CapabilityId = keyof typeof capabilityCatalogJson.capabilities;

type CapabilityOption = Readonly<{
  display: string;
  value: unknown;
}>;

type CapabilityDefinition = Readonly<{
  order: number;
  label: string;
  description: string;
  kind: CapabilityKind;
  options: Readonly<Record<string, CapabilityOption>>;
}>;

type CapabilityCatalog = Readonly<{
  schemaVersion: 1;
  capabilities: Readonly<Record<CapabilityId, CapabilityDefinition>>;
}>;

type PlanCapabilityMapping = Readonly<{
  schemaVersion: 1;
  plans: Readonly<
    Record<
      PlanCode,
      Readonly<{
        displayName: string;
        capabilities: Readonly<Record<CapabilityId, string>>;
      }>
    >
  >;
}>;

export type PublicPlanCapability = Readonly<{
  id: CapabilityId;
  label: string;
  description: string;
  plans: Readonly<Record<PlanCode, Readonly<{ optionId: string; display: string }>>>;
}>;

export type PublicPlan = Readonly<{
  code: PlanCode;
  displayName: string;
}>;

export type PlanCapabilityComparison = Readonly<{
  plans: readonly PublicPlan[];
  capabilities: readonly PublicPlanCapability[];
}>;

type Quota = Readonly<{
  limit: number;
  period: "assignment-month" | "rolling-90-days";
}>;

type AiReplyQuota = Readonly<{
  limit: number;
  period: "assignment-month";
}>;

export type ResolvedPlanCapabilityValues = Readonly<{
  diaryStorage: boolean;
  diagnosisBasicResults: boolean;
  aiReply: AiReplyQuota;
  profileSummary: Quota;
  semanticSearchDays: number | null;
  relationshipQuestionContext: "current-message" | "session-and-diagnosis" | "confirmed-history";
  weeklyReflection: boolean;
  monthlyChange: "none" | "brief" | "full";
  goalFollowUp: "none" | "selected-one" | "relevant-active";
  selfCareContext: "general" | "confirmed" | "personalized-history";
  basicCompatibilitySheet: boolean;
  concurrentRelationshipLimit: number;
  accountSeatLimit: number;
}>;

validatePlanCapabilityConfiguration(capabilityCatalogJson, planCapabilityMappingJson);

const capabilityCatalog = capabilityCatalogJson as unknown as CapabilityCatalog;
const planCapabilityMapping = planCapabilityMappingJson as unknown as PlanCapabilityMapping;

/** 公開サイトと実行時判定が同じPlanマッピングを読むための表示用projection。 */
export function getPlanCapabilityComparison(): PlanCapabilityComparison {
  const plans = planCodes.map((code) =>
    Object.freeze({ code, displayName: planCapabilityMapping.plans[code].displayName }),
  );
  const capabilities = (Object.keys(capabilityCatalog.capabilities) as CapabilityId[])
    .sort(
      (left, right) =>
        capabilityCatalog.capabilities[left].order - capabilityCatalog.capabilities[right].order,
    )
    .map((id) => {
      const definition = capabilityCatalog.capabilities[id];
      const values = Object.fromEntries(
        planCodes.map((plan) => {
          const optionId = planCapabilityMapping.plans[plan].capabilities[id];
          return [plan, Object.freeze({ optionId, display: selectedOption(plan, id).display })];
        }),
      ) as Record<PlanCode, Readonly<{ optionId: string; display: string }>>;
      return Object.freeze({
        id,
        label: definition.label,
        description: definition.description,
        plans: Object.freeze(values),
      });
    });
  return Object.freeze({ plans: Object.freeze(plans), capabilities: Object.freeze(capabilities) });
}

/** Planを機能固有の実行値へ変換する唯一のresolver。 */
export function resolvePlanCapabilityValues(plan: PlanCode): ResolvedPlanCapabilityValues {
  return Object.freeze({
    diaryStorage: toggle(plan, "diary-storage"),
    diagnosisBasicResults: toggle(plan, "diagnosis-basic-results"),
    aiReply: aiReplyQuota(plan),
    profileSummary: quota(plan, "profile-summary"),
    semanticSearchDays: lookback(plan, "semantic-search"),
    relationshipQuestionContext: mode(plan, "relationship-question-context", [
      "current-message",
      "session-and-diagnosis",
      "confirmed-history",
    ] as const),
    weeklyReflection: toggle(plan, "weekly-reflection"),
    monthlyChange: mode(plan, "monthly-change", ["none", "brief", "full"] as const),
    goalFollowUp: mode(plan, "goal-follow-up", [
      "none",
      "selected-one",
      "relevant-active",
    ] as const),
    selfCareContext: mode(plan, "personalized-self-care", [
      "general",
      "confirmed",
      "personalized-history",
    ] as const),
    basicCompatibilitySheet: toggle(plan, "basic-compatibility-sheet"),
    concurrentRelationshipLimit: limit(plan, "relationship-reflection"),
    accountSeatLimit: limit(plan, "account-seats"),
  });
}

function selectedValue(plan: PlanCode, capabilityId: CapabilityId): unknown {
  return selectedOption(plan, capabilityId).value;
}

function selectedOption(plan: PlanCode, capabilityId: CapabilityId): CapabilityOption {
  const definition = capabilityCatalog.capabilities[capabilityId];
  const optionId = planCapabilityMapping.plans[plan].capabilities[capabilityId];
  const option = definition.options[optionId];
  if (!option) throw new Error(`Plan ${plan} selects an unknown option for ${capabilityId}`);
  return option;
}

function quota(plan: PlanCode, capabilityId: CapabilityId): Quota {
  const value = selectedValue(plan, capabilityId);
  if (
    !isRecord(value) ||
    typeof value.limit !== "number" ||
    !Number.isInteger(value.limit) ||
    value.limit < 0 ||
    (value.period !== "assignment-month" && value.period !== "rolling-90-days")
  ) {
    throw new Error(`${capabilityId} must resolve to a quota`);
  }
  return Object.freeze({ limit: value.limit, period: value.period });
}

function aiReplyQuota(plan: PlanCode): AiReplyQuota {
  const value = quota(plan, "ai-reply");
  if (value.period !== "assignment-month") {
    throw new Error("ai-reply must use assignment-month");
  }
  return Object.freeze({ limit: value.limit, period: value.period });
}

function toggle(plan: PlanCode, capabilityId: CapabilityId): boolean {
  const value = selectedValue(plan, capabilityId);
  if (typeof value !== "boolean") throw new Error(`${capabilityId} must resolve to a toggle`);
  return value;
}

function lookback(plan: PlanCode, capabilityId: CapabilityId): number | null {
  const value = selectedValue(plan, capabilityId);
  if (value !== null && (typeof value !== "number" || !Number.isInteger(value) || value <= 0)) {
    throw new Error(`${capabilityId} must resolve to a lookback`);
  }
  return value;
}

function limit(plan: PlanCode, capabilityId: CapabilityId): number {
  const value = selectedValue(plan, capabilityId);
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${capabilityId} must resolve to a limit`);
  }
  return value;
}

function mode<const Values extends readonly string[]>(
  plan: PlanCode,
  capabilityId: CapabilityId,
  allowed: Values,
): Values[number] {
  const value = selectedValue(plan, capabilityId);
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${capabilityId} has an unsupported mode`);
  }
  return value as Values[number];
}

export function validatePlanCapabilityConfiguration(
  catalogValue: unknown,
  mappingValue: unknown,
): void {
  if (!isRecord(catalogValue) || catalogValue.schemaVersion !== 1) {
    throw new Error("Capability catalog schemaVersion must be 1");
  }
  if (!isRecord(catalogValue.capabilities)) {
    throw new Error("Capability catalog must define capabilities");
  }
  const capabilityIds = Object.keys(catalogValue.capabilities);
  if (capabilityIds.length === 0) throw new Error("Capability catalog cannot be empty");
  const orders = new Set<number>();
  for (const capabilityId of capabilityIds) {
    const definition = catalogValue.capabilities[capabilityId];
    validateCapabilityDefinition(capabilityId, definition, orders);
  }

  if (
    !isRecord(mappingValue) ||
    mappingValue.schemaVersion !== 1 ||
    !isRecord(mappingValue.plans)
  ) {
    throw new Error("Plan capability mapping schemaVersion must be 1");
  }
  assertExactKeys("plan mapping", mappingValue.plans, planCodes);
  for (const plan of planCodes) {
    const planDefinition = mappingValue.plans[plan];
    if (
      !isRecord(planDefinition) ||
      !isNonEmptyString(planDefinition.displayName) ||
      !isRecord(planDefinition.capabilities)
    ) {
      throw new Error(`Plan ${plan} must define displayName and capabilities`);
    }
    assertExactKeys(`plan ${plan}`, planDefinition.capabilities, capabilityIds);
    for (const capabilityId of capabilityIds) {
      const optionId = planDefinition.capabilities[capabilityId];
      const definition = catalogValue.capabilities[capabilityId];
      if (
        typeof optionId !== "string" ||
        !isRecord(definition) ||
        !isRecord(definition.options) ||
        !Object.prototype.hasOwnProperty.call(definition.options, optionId)
      ) {
        throw new Error(`Plan ${plan} selects an unknown option for ${capabilityId}`);
      }
    }
  }
}

function validateCapabilityDefinition(
  capabilityId: string,
  value: unknown,
  orders: Set<number>,
): void {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.order) ||
    typeof value.order !== "number" ||
    !isNonEmptyString(value.label) ||
    !isNonEmptyString(value.description) ||
    typeof value.kind !== "string" ||
    !(capabilityKinds as readonly string[]).includes(value.kind) ||
    !isRecord(value.options) ||
    Object.keys(value.options).length === 0
  ) {
    throw new Error(`Capability ${capabilityId} is invalid`);
  }
  if (orders.has(value.order)) throw new Error(`Capability order ${value.order} is duplicated`);
  orders.add(value.order);
  for (const [optionId, option] of Object.entries(value.options)) {
    if (!isRecord(option) || !isNonEmptyString(option.display)) {
      throw new Error(`Capability ${capabilityId} option ${optionId} is invalid`);
    }
    validateOptionValue(capabilityId, optionId, value.kind as CapabilityKind, option.value);
  }
}

function validateOptionValue(
  capabilityId: string,
  optionId: string,
  kind: CapabilityKind,
  value: unknown,
): void {
  const valid =
    (kind === "toggle" && typeof value === "boolean") ||
    (kind === "mode" && isNonEmptyString(value)) ||
    (kind === "lookback" &&
      (value === null || (typeof value === "number" && Number.isInteger(value) && value > 0))) ||
    (kind === "limit" && typeof value === "number" && Number.isInteger(value) && value >= 0) ||
    (kind === "quota" &&
      isRecord(value) &&
      typeof value.limit === "number" &&
      Number.isInteger(value.limit) &&
      value.limit >= 0 &&
      (value.period === "assignment-month" || value.period === "rolling-90-days"));
  if (!valid) throw new Error(`Capability ${capabilityId} option ${optionId} has an invalid value`);
}

function assertExactKeys(
  label: string,
  value: Record<string, unknown>,
  expected: readonly string[],
) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new Error(`${label} must map every known key exactly once`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// 公開表示だけをimportする場合も、既知機能の実行値がresolver契約を満たすことを起動時に確認する。
for (const plan of planCodes) resolvePlanCapabilityValues(plan);
