import { describe, expect, it } from "vitest";
import { prepareObsoleteGcpPlatformState } from "./gcp-platform-obsolete-state";

function resource(name: string, type: string, overrides: Record<string, unknown> = {}) {
  return {
    urn: `urn:pulumi:development::me-builder-gcp-platform::${type}::${name}`,
    protect: true,
    inputs: {},
    outputs: {},
    ...overrides,
  };
}

function prepare(resources: Record<string, unknown>[]) {
  return prepareObsoleteGcpPlatformState(JSON.stringify({ version: 3, deployment: { resources } }));
}

describe("prepareObsoleteGcpPlatformState", () => {
  it("廃止済みVertex resourceのPulumi protectを解除する", () => {
    const obsoleteResources: [string, string][] = [
      ["iam-googleapis-com", "gcp:projects/service:Service"],
      ["orgpolicy-googleapis-com", "gcp:projects/service:Service"],
      ["vertex-inference-binding", "gcp:projects/iAMMember:IAMMember"],
      ["vertex-service-usage-binding", "gcp:projects/iAMMember:IAMMember"],
      ["vertexRuntime", "gcp:serviceaccount/account:Account"],
    ];
    const resources = obsoleteResources.map(([name, type]) => resource(name, type));
    const result = prepare(resources);
    const migrated = JSON.parse(result.deployment).deployment.resources;

    expect(migrated).toEqual(resources.map((value) => ({ ...value, protect: false })));
    expect(result.migratedResourceCount).toBe(obsoleteResources.length);
  });

  it("provider側の削除禁止をDELETEへ変更する", () => {
    const result = prepare([
      resource("vertexInferenceRole", "gcp:projects/iAMCustomRole:IAMCustomRole", {
        inputs: { deletionPolicy: "PREVENT" },
        outputs: { deletionPolicy: "PREVENT" },
      }),
      resource("allowRestrictedServiceAccountApiKeys", "gcp:orgpolicy/policy:Policy", {
        inputs: { deletionPolicy: "PREVENT" },
        outputs: { deletionPolicy: "PREVENT" },
      }),
    ]);
    const migrated = JSON.parse(result.deployment).deployment.resources;

    for (const resource of migrated) {
      expect(resource).toMatchObject({
        protect: false,
        inputs: { deletionPolicy: "DELETE" },
        outputs: { deletionPolicy: "DELETE" },
      });
    }
    expect(result.migratedResourceCount).toBe(2);
  });

  it("現行resource、他project、類似名、external resourceを変更しない", () => {
    const resources = [
      resource("identityPlatformTenant", "gcp:identityplatform/tenant:Tenant"),
      resource("vertexRuntimeBackup", "gcp:serviceaccount/account:Account"),
      resource("vertexRuntime", "gcp:test/resource:Resource"),
      resource("vertexRuntime", "gcp:serviceaccount/account:Account", {
        urn: "urn:pulumi:development::other-project::gcp:serviceaccount/account:Account::vertexRuntime",
      }),
      resource("vertexRuntime", "gcp:serviceaccount/account:Account", { external: true }),
    ];
    const result = prepare(resources);

    expect(JSON.parse(result.deployment).deployment.resources).toEqual(resources);
    expect(result.migratedResourceCount).toBe(0);
  });

  it("不完全なexportと想定外の削除policyを拒否する", () => {
    expect(() => prepareObsoleteGcpPlatformState("{}")).toThrow(
      "Pulumi Stack export has no deployment resources",
    );
    expect(() =>
      prepare([
        resource("vertexInferenceRole", "gcp:projects/iAMCustomRole:IAMCustomRole", {
          inputs: { deletionPolicy: "ABANDON" },
          outputs: { deletionPolicy: "ABANDON" },
        }),
      ]),
    ).toThrow("has unexpected deletion policy");
  });
});
