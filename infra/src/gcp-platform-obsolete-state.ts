type ObsoleteResource = {
  type: string;
  hasProviderDeletionPolicy: boolean;
};

const obsoleteResources = new Map<string, ObsoleteResource>([
  [
    "vertexInferenceRole",
    { type: "gcp:projects/iAMCustomRole:IAMCustomRole", hasProviderDeletionPolicy: true },
  ],
  [
    "vertexRuntime",
    { type: "gcp:serviceaccount/account:Account", hasProviderDeletionPolicy: false },
  ],
]);
const migratableDeletionPolicies = new Set(["PREVENT", "DELETE"]);

type PulumiResourceState = {
  urn?: unknown;
  protect?: unknown;
  external?: unknown;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
};

type PulumiStackExport = {
  deployment?: {
    resources?: PulumiResourceState[];
  };
};

export type PreparedObsoleteGcpPlatformState = {
  deployment: string;
  migratedResourceCount: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function obsoleteResource(resource: PulumiResourceState): ObsoleteResource | undefined {
  if (typeof resource.urn !== "string" || resource.external === true) return undefined;
  const parts = resource.urn.split("::");
  if (parts.length !== 4 || parts[1] !== "me-builder-gcp-platform") return undefined;
  const expected = obsoleteResources.get(parts[3] ?? "");
  return expected?.type === parts[2] ? expected : undefined;
}

/**
 * 廃止済みVertex resourceのstateだけを削除可能にする。
 * Pulumiのprotectに加えてprovider側のPREVENTも解除し、続くupで実体を削除する。
 */
export function prepareObsoleteGcpPlatformState(
  stackExport: string,
): PreparedObsoleteGcpPlatformState {
  const parsed = JSON.parse(stackExport) as PulumiStackExport;
  const resources = parsed.deployment?.resources;
  if (!Array.isArray(resources)) {
    throw new Error("Pulumi Stack export has no deployment resources");
  }

  let migratedResourceCount = 0;
  for (const resource of resources) {
    const obsolete = obsoleteResource(resource);
    if (!obsolete || typeof resource.urn !== "string") continue;

    resource.protect = false;
    if (obsolete.hasProviderDeletionPolicy) {
      const inputs = resource.inputs;
      const outputs = resource.outputs;
      if (
        !isRecord(inputs) ||
        !isRecord(outputs) ||
        !migratableDeletionPolicies.has(String(inputs.deletionPolicy)) ||
        !migratableDeletionPolicies.has(String(outputs.deletionPolicy))
      ) {
        throw new Error(`Obsolete Pulumi resource ${resource.urn} has unexpected deletion policy`);
      }
      inputs.deletionPolicy = "DELETE";
      outputs.deletionPolicy = "DELETE";
    }
    migratedResourceCount += 1;
  }

  return {
    deployment: JSON.stringify(parsed),
    migratedResourceCount,
  };
}
