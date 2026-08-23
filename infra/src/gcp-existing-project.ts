export type ExistingGcpProject = {
  projectId?: string | undefined;
  number?: string | undefined;
};

export type ExpectedGcpProject = {
  projectId: string;
};

export type VerifiedGcpProject = {
  projectId: string;
  projectNumber: string;
};

export type VerifiedGcpProjectBilling = {
  billingAccount: string;
};

function normalizeBillingAccount(value: string): string {
  return value.replace(/^billingAccounts\//u, "");
}

function normalizeOptionalId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

/**
 * 既存projectを更新せず、Stack設定が実際のprojectと一致することだけを検証する。
 */
export function verifyExistingGcpProject(
  expected: ExpectedGcpProject,
  actual: ExistingGcpProject,
): VerifiedGcpProject {
  const actualProjectId = normalizeOptionalId(actual.projectId);
  if (actualProjectId && actualProjectId !== expected.projectId) {
    throw new Error(
      `Existing GCP project ID ${actualProjectId} does not match configured projectId ${expected.projectId}`,
    );
  }

  const projectNumber = actual.number?.trim() ?? "";
  if (!projectNumber) {
    throw new Error(`Existing GCP project ${expected.projectId} has no project number`);
  }

  return { projectId: expected.projectId, projectNumber };
}

/**
 * Cloud Billing API有効化後に、既存projectの請求先を更新せず検証する。
 */
export function verifyExistingGcpProjectBilling(
  projectId: string,
  expectedBillingAccount: string,
  actualBillingAccount: string | undefined,
): VerifiedGcpProjectBilling {
  const actual = normalizeBillingAccount(actualBillingAccount?.trim() ?? "");
  const expected = normalizeBillingAccount(expectedBillingAccount.trim());
  if (actual !== expected) {
    throw new Error(
      `Existing GCP project ${projectId} uses billing account ${actual || "none"}, expected ${expected}`,
    );
  }

  return { billingAccount: expected };
}
