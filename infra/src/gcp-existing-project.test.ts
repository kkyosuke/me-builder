import { describe, expect, it } from "vitest";
import { verifyExistingGcpProject, verifyExistingGcpProjectBilling } from "./gcp-existing-project";

const standaloneProject = {
  projectId: "existing-project",
  number: "123456789",
  orgId: "",
  folderId: "",
};

describe("verifyExistingGcpProject", () => {
  it("既存projectを参照情報として検証する", () => {
    expect(
      verifyExistingGcpProject(
        {
          projectId: "existing-project",
        },
        standaloneProject,
      ),
    ).toEqual({ projectId: "existing-project", projectNumber: "123456789" });
  });

  it("projectの親が設定と異なる場合は更新せず拒否する", () => {
    expect(() =>
      verifyExistingGcpProject(
        {
          projectId: "existing-project",
          organizationId: "1234",
        },
        standaloneProject,
      ),
    ).toThrow("parent does not match");
  });

  it("Cloud Billing API有効化後に請求先を検証する", () => {
    expect(
      verifyExistingGcpProjectBilling(
        "existing-project",
        "AAAAAA-BBBBBB-CCCCCC",
        "billingAccounts/AAAAAA-BBBBBB-CCCCCC",
      ),
    ).toEqual({ billingAccount: "AAAAAA-BBBBBB-CCCCCC" });
  });

  it("請求先が異なる場合は更新せず拒否する", () => {
    expect(() =>
      verifyExistingGcpProjectBilling(
        "existing-project",
        "OTHER-BILLING-ACCOUNT",
        "billingAccounts/AAAAAA-BBBBBB-CCCCCC",
      ),
    ).toThrow("uses billing account");
  });
});
