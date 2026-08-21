export type ExistingGcpProject = {
  projectId?: string | undefined;
  number?: string | undefined;
  billingAccount?: string | undefined;
  orgId?: string | undefined;
  folderId?: string | undefined;
};

export type ExpectedGcpProject = {
  projectId: string;
  billingAccount: string;
  organizationId?: string | undefined;
  folderId?: string | undefined;
};

export type VerifiedGcpProject = {
  projectId: string;
  projectNumber: string;
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

  const actualBillingAccount = normalizeBillingAccount(actual.billingAccount?.trim() ?? "");
  const expectedBillingAccount = normalizeBillingAccount(expected.billingAccount.trim());
  if (actualBillingAccount !== expectedBillingAccount) {
    throw new Error(
      `Existing GCP project ${expected.projectId} uses billing account ${actualBillingAccount || "none"}, expected ${expectedBillingAccount}`,
    );
  }

  const expectedOrganizationId = normalizeOptionalId(expected.organizationId);
  const expectedFolderId = normalizeOptionalId(expected.folderId);
  const actualOrganizationId = normalizeOptionalId(actual.orgId);
  const actualFolderId = normalizeOptionalId(actual.folderId);
  if (expectedOrganizationId !== actualOrganizationId || expectedFolderId !== actualFolderId) {
    throw new Error(
      `Existing GCP project ${expected.projectId} parent does not match the configured organizationId/folderId`,
    );
  }

  return { projectId: expected.projectId, projectNumber };
}
