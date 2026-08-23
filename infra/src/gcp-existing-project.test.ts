import { describe, expect, it } from "vitest";
import { verifyExistingGcpProject, verifyExistingGcpProjectBilling } from "./gcp-existing-project";

const existingProject = {
  projectId: "existing-project",
  number: "123456789",
};

describe("verifyExistingGcpProject", () => {
  it("既存projectを参照情報として検証する", () => {
    expect(
      verifyExistingGcpProject(
        {
          projectId: "existing-project",
        },
        existingProject,
      ),
    ).toEqual({ projectId: "existing-project", projectNumber: "123456789" });
  });

  it("取得したproject IDが設定と異なる場合は拒否する", () => {
    expect(() =>
      verifyExistingGcpProject(
        { projectId: "configured-project" },
        { projectId: "different-project", number: "123456789" },
      ),
    ).toThrow("does not match configured projectId");
  });

  it("既存projectのnumberを取得できない場合は拒否する", () => {
    expect(() =>
      verifyExistingGcpProject(
        { projectId: "existing-project" },
        { ...existingProject, number: "" },
      ),
    ).toThrow("has no project number");
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
