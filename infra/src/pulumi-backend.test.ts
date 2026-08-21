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

  it("Pulumi projectとbootstrap workflowの固定backendを一致させる", async () => {
    const [
      cloudflareProject,
      gcpPlatformProject,
      bootstrapWorkflow,
      resetWorkflow,
      stripeWorkflow,
    ] = await Promise.all([
      readFile(new URL("../Pulumi.yaml", import.meta.url), "utf8"),
      readFile(new URL("../gcp-platform/Pulumi.yaml", import.meta.url), "utf8"),
      readFile(new URL("../../.github/workflows/setup-pulumi-state.yml", import.meta.url), "utf8"),
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
    expect(bootstrapWorkflow).toContain('bucket_uri="gs://kagami-infra"');
    expect(bootstrapWorkflow).toContain("--default-storage-class=STANDARD");
    expect(bootstrapWorkflow).not.toContain("NEARLINE");
    expect(bootstrapWorkflow).toContain("environment: infra-dev");
    expect(resetWorkflow).toContain("environment: infra-dev");
    expect(resetWorkflow).toContain('[ "${REF_NAME}" != "main" ]');
    expect(stripeWorkflow).toContain("inputs.environment == 'dev' && 'infra-dev' || 'stripe-prd'");
    for (const workflow of [bootstrapWorkflow, resetWorkflow]) {
      expect(workflow).toContain("uses: google-github-actions/auth@v2");
      expect(workflow).toContain(
        "workload_identity_provider: ${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}",
      );
      expect(workflow).not.toContain("service_account:");
    }
  });
});
