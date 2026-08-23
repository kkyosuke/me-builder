import { describe, expect, it } from "vitest";
import { obsoleteGcpPlatformResourceUrns } from "./gcp-platform-state-migration";

describe("obsoleteGcpPlatformResourceUrns", () => {
  it("旧Vertex credential実装の削除保護resourceを抽出する", () => {
    const obsoleteUrns = [
      "urn:pulumi:development::me-builder-gcp-platform::gcp:serviceaccount/account:Account::vertexRuntime",
      "urn:pulumi:development::me-builder-gcp-platform::gcp:projects/iAMCustomRole:IAMCustomRole::vertexInferenceRole",
      "urn:pulumi:development::me-builder-gcp-platform::gcp:projects/iAMMember:IAMMember::vertex-inference-binding",
      "urn:pulumi:development::me-builder-gcp-platform::gcp:projects/iAMMember:IAMMember::vertex-service-usage-binding",
      "urn:pulumi:development::me-builder-gcp-platform::gcp:orgpolicy/policy:Policy::allowRestrictedServiceAccountApiKeys",
      "urn:pulumi:development::me-builder-gcp-platform::gcp:projects/service:Service::iam-googleapis-com",
      "urn:pulumi:development::me-builder-gcp-platform::gcp:projects/service:Service::orgpolicy-googleapis-com",
    ];

    expect(obsoleteGcpPlatformResourceUrns(obsoleteUrns.join("\n"))).toEqual(obsoleteUrns);
  });

  it("現行resource、類似名、重複を除外する", () => {
    const obsoleteUrn =
      "urn:pulumi:development::me-builder-gcp-platform::gcp:serviceaccount/account:Account::vertexRuntime";
    const currentUrn =
      "urn:pulumi:development::me-builder-gcp-platform::gcp:identityplatform/tenant:Tenant::identityPlatformTenant";
    const similarUrn =
      "urn:pulumi:development::me-builder-gcp-platform::gcp:serviceaccount/account:Account::vertexRuntimeBackup";

    expect(
      obsoleteGcpPlatformResourceUrns(
        [currentUrn, obsoleteUrn, similarUrn, obsoleteUrn].join("\n"),
      ),
    ).toEqual([obsoleteUrn]);
  });
});
