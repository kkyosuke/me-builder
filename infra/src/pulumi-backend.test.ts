import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { pulumiGcsBackends, requirePulumiGcsBackend } from "./pulumi-backend";

describe("requirePulumiGcsBackend", () => {
  it("Pulumi.yamlの固定GCS backendを使用する", () => {
    expect(
      requirePulumiGcsBackend(
        { PULUMI_CONFIG_PASSPHRASE: "test-only-passphrase" },
        pulumiGcsBackends.cloudflare,
      ),
    ).toBe("gs://kagami-infra/kagami/cloudflare");
  });

  it.each([
    "file:///tmp/pulumi-state",
    "https://api.pulumi.com",
    "s3://me-builder-pulumi-state",
    "gs://kagami-infra/kagami/other",
    "relative-state",
  ])("backend %sを拒否する", (backendUrl) => {
    expect(() =>
      requirePulumiGcsBackend(
        {
          PULUMI_BACKEND_URL: backendUrl,
          PULUMI_CONFIG_PASSPHRASE: "test-only-passphrase",
        },
        pulumiGcsBackends.cloudflare,
      ),
    ).toThrow();
  });

  it.each([undefined, "", "   "])("passphrase %sを拒否する", (configPassphrase) => {
    expect(() =>
      requirePulumiGcsBackend(
        { PULUMI_CONFIG_PASSPHRASE: configPassphrase },
        pulumiGcsBackends.gcpPlatform,
      ),
    ).toThrow("PULUMI_CONFIG_PASSPHRASE");
  });

  it("Pulumi projectとGitHub Actionsの固定backendを一致させる", async () => {
    const [
      cloudflareProject,
      gcpPlatformProject,
      gcpPlatformProgram,
      gcpPlatformScript,
      gcpPlatformWorkflow,
      resetWorkflow,
      stripeWorkflow,
    ] = await Promise.all([
      readFile(new URL("../Pulumi.yaml", import.meta.url), "utf8"),
      readFile(new URL("../gcp-platform/Pulumi.yaml", import.meta.url), "utf8"),
      readFile(new URL("../gcp-platform/index.ts", import.meta.url), "utf8"),
      readFile(new URL("../scripts/gcp-platform.ts", import.meta.url), "utf8"),
      readFile(new URL("../../.github/workflows/deploy-gcp-platform.yml", import.meta.url), "utf8"),
      readFile(
        new URL("../../.github/workflows/reset-preview-migrations.yml", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../../.github/workflows/setup-stripe-billing.yml", import.meta.url),
        "utf8",
      ),
    ]);

    expect(cloudflareProject).toContain(`url: ${pulumiGcsBackends.cloudflare}`);
    expect(gcpPlatformProject).toContain(`url: ${pulumiGcsBackends.gcpPlatform}`);
    expect(gcpPlatformProgram).toContain('from "../src/gcp-authorization-key-policy.ts"');
    expect(gcpPlatformProgram).toContain('from "../src/gcp-existing-project.ts"');
    expect(gcpPlatformProgram).toContain('from "../src/pulumi-backend.ts"');
    expect(gcpPlatformProgram).toContain("gcp.organizations.getProjectOutput({ projectId })");
    expect(gcpPlatformProgram).toContain('service: "cloudbilling.googleapis.com"');
    expect(gcpPlatformProgram).toContain("cloudBillingApi.id.apply(() => projectId)");
    expect(gcpPlatformProgram).toContain("{ dependsOn: cloudBillingApi }");
    expect(gcpPlatformProgram).toContain("verifyExistingGcpProjectBilling");
    expect(gcpPlatformProgram).not.toContain("new gcp.organizations.Project");
    expect(gcpPlatformProgram).not.toContain("import: projectId");
    expect(gcpPlatformProgram).not.toContain("autoCreateNetwork");
    expect(gcpPlatformScript).toContain(
      'await run(["pulumi", "-C", "gcp-platform", "whoami", "--verbose"]);',
    );
    expect(gcpPlatformWorkflow).toContain(`pulumi login ${pulumiGcsBackends.gcpPlatform}`);
    expect(gcpPlatformWorkflow).toContain('task "infra:gcp-platform:preview:${TARGET}"');
    expect(gcpPlatformWorkflow).toContain('task "infra:gcp-platform:up:${TARGET}"');
    expect(gcpPlatformWorkflow).toContain(
      "environment: ${{ inputs.target == 'development' && 'infra-dev' || 'infra-prd' }}",
    );
    expect(gcpPlatformWorkflow).toContain(
      'if [ -n "${GCP_ORGANIZATION_ID}" ] && [ -n "${GCP_FOLDER_ID}" ]; then',
    );
    expect(gcpPlatformWorkflow).toContain("remove_config_if_present organizationId");
    expect(gcpPlatformWorkflow).toContain("remove_config_if_present folderId");
    expect(gcpPlatformWorkflow).toContain("Existing standalone project");
    expect(gcpPlatformWorkflow).toContain("remove_config_if_present projectName");
    expect(gcpPlatformWorkflow).not.toContain("GCP_PLATFORM_PROJECT_NAME");
    expect(gcpPlatformWorkflow).not.toContain("gcloud storage buckets");
    expect(gcpPlatformWorkflow).not.toContain("gcloud storage managed-folders");
    expect(resetWorkflow).toContain("environment: infra-dev");
    expect(resetWorkflow).toContain('[ "${REF_NAME}" != "main" ]');
    expect(stripeWorkflow).toContain("inputs.environment == 'dev' && 'infra-dev' || 'stripe-prd'");
    for (const workflow of [gcpPlatformWorkflow, resetWorkflow]) {
      expect(workflow).toContain("uses: google-github-actions/auth@v2");
      expect(workflow).toContain(
        "workload_identity_provider: ${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}",
      );
      expect(workflow).not.toContain("service_account:");
    }
  });
});
