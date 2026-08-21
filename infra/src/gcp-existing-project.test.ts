import { describe, expect, it } from "vitest";
import { verifyExistingGcpProject } from "./gcp-existing-project";

const standaloneProject = {
  projectId: "existing-project",
  number: "123456789",
  billingAccount: "billingAccounts/AAAAAA-BBBBBB-CCCCCC",
  orgId: "",
  folderId: "",
};

describe("verifyExistingGcpProject", () => {
  it("既存projectを参照情報として検証する", () => {
    expect(
      verifyExistingGcpProject(
        {
          projectId: "existing-project",
          billingAccount: "AAAAAA-BBBBBB-CCCCCC",
        },
        standaloneProject,
      ),
    ).toEqual({ projectId: "existing-project", projectNumber: "123456789" });
  });

  it("請求先が異なる場合は更新せず拒否する", () => {
    expect(() =>
      verifyExistingGcpProject(
        { projectId: "existing-project", billingAccount: "OTHER-BILLING-ACCOUNT" },
        standaloneProject,
      ),
    ).toThrow("uses billing account");
  });

  it("projectの親が設定と異なる場合は更新せず拒否する", () => {
    expect(() =>
      verifyExistingGcpProject(
        {
          projectId: "existing-project",
          billingAccount: "AAAAAA-BBBBBB-CCCCCC",
          organizationId: "1234",
        },
        standaloneProject,
      ),
    ).toThrow("parent does not match");
  });
});
