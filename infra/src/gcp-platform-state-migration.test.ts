import { describe, expect, it } from "vitest";
import { prepareGcpPlatformStateMigration } from "./gcp-platform-state-migration";

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
  return prepareGcpPlatformStateMigration(
    JSON.stringify({ version: 3, deployment: { resources } }),
  );
}

describe("prepareGcpPlatformStateMigration", () => {
  it("旧resourceのPulumi protectを解除する", () => {
    const obsoleteResources: [string, string][] = [
      ["iam-googleapis-com", "gcp:projects/service:Service"],
      ["orgpolicy-googleapis-com", "gcp:projects/service:Service"],
      ["vertex-inference-binding", "gcp:projects/iAMMember:IAMMember"],
      ["vertex-service-usage-binding", "gcp:projects/iAMMember:IAMMember"],
      ["vertexRuntime", "gcp:serviceaccount/account:Account"],
    ];
    const resources = obsoleteResources.map(([name, type]) => resource(name, type));
    const result = prepare(resources);
    const deployment = JSON.parse(result.deployment);

    expect(deployment.deployment.resources).toEqual(
      resources.map((value) => ({ ...value, protect: false })),
    );
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
    const deployment = JSON.parse(result.deployment);

    for (const migrated of deployment.deployment.resources) {
      expect(migrated.protect).toBe(false);
      expect(migrated.inputs.deletionPolicy).toBe("DELETE");
      expect(migrated.outputs.deletionPolicy).toBe("DELETE");
    }
  });

  it("現行resource、他project、類似名を変更しない", () => {
    const current = resource("identityPlatformTenant", "gcp:identityplatform/tenant:Tenant");
    const similar = resource("vertexRuntimeBackup", "gcp:serviceaccount/account:Account");
    const wrongType = resource("vertexRuntime", "gcp:test/resource:Resource");
    const otherProject = resource("vertexRuntime", "gcp:serviceaccount/account:Account", {
      urn: "urn:pulumi:development::other-project::gcp:serviceaccount/account:Account::vertexRuntime",
    });
    const external = resource("vertexRuntime", "gcp:serviceaccount/account:Account", {
      external: true,
    });
    const result = prepare([current, similar, wrongType, otherProject, external]);

    expect(JSON.parse(result.deployment).deployment.resources).toEqual([
      current,
      similar,
      wrongType,
      otherProject,
      external,
    ]);
    expect(result.migratedResourceCount).toBe(0);
  });

  it("不完全なStack exportと想定外の削除policyを拒否する", () => {
    expect(() => prepareGcpPlatformStateMigration("{}")).toThrow(
      "Pulumi Stack export has no deployment resources",
    );
    expect(() =>
      prepare([
        resource("vertexInferenceRole", "gcp:projects/iAMCustomRole:IAMCustomRole", {
          inputs: undefined,
        }),
      ]),
    ).toThrow("has unexpected deletion policy");
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
