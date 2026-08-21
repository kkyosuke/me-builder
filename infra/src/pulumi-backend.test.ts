import { describe, expect, it } from "vitest";
import { requirePulumiGcsBackend } from "./pulumi-backend";

describe("requirePulumiGcsBackend", () => {
  it.each(["gs://me-builder-pulumi-state", "gs://me-builder-pulumi-state/repository"])(
    "%sをGCS backendとして受け入れる",
    (backendUrl) => {
      expect(
        requirePulumiGcsBackend({
          PULUMI_BACKEND_URL: backendUrl,
          PULUMI_CONFIG_PASSPHRASE: "test-only-passphrase",
        }),
      ).toBe(backendUrl);
    },
  );

  it.each([
    undefined,
    "",
    "file:///tmp/pulumi-state",
    "https://api.pulumi.com",
    "s3://me-builder-pulumi-state",
    "gs://",
    "relative-state",
  ])("backend %sを拒否する", (backendUrl) => {
    expect(() =>
      requirePulumiGcsBackend({
        PULUMI_BACKEND_URL: backendUrl,
        PULUMI_CONFIG_PASSPHRASE: "test-only-passphrase",
      }),
    ).toThrow();
  });

  it.each([undefined, "", "   "])("passphrase %sを拒否する", (configPassphrase) => {
    expect(() =>
      requirePulumiGcsBackend({
        PULUMI_BACKEND_URL: "gs://me-builder-pulumi-state",
        PULUMI_CONFIG_PASSPHRASE: configPassphrase,
      }),
    ).toThrow("PULUMI_CONFIG_PASSPHRASE");
  });
});
