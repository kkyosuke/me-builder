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
  it("廃止済みVertex resourceを削除可能にする", () => {
    const resources = [
      resource("vertexInferenceRole", "gcp:projects/iAMCustomRole:IAMCustomRole", {
        inputs: { deletionPolicy: "PREVENT" },
        outputs: { deletionPolicy: "PREVENT" },
      }),
      resource("vertexRuntime", "gcp:serviceaccount/account:Account"),
    ];
    const result = prepare(resources);
    const migrated = JSON.parse(result.deployment).deployment.resources;

    expect(migrated[0]).toMatchObject({
      protect: false,
      inputs: { deletionPolicy: "DELETE" },
      outputs: { deletionPolicy: "DELETE" },
    });
    expect(migrated[1]).toMatchObject({ protect: false });
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
