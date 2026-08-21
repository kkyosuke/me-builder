import { describe, expect, it } from "vitest";
import { gcpPlatformCommand } from "./gcp-platform-command";

describe("gcpPlatformCommand", () => {
  it("共有backendを明示したpreview commandを返す", () => {
    expect(
      gcpPlatformCommand("preview", "development", {
        PULUMI_BACKEND_URL: "s3://me-builder-pulumi-state",
        PULUMI_CONFIG_PASSPHRASE: "test-only-passphrase",
      }),
    ).toEqual([
      "pulumi",
      "-C",
      "gcp-platform",
      "preview",
      "--stack",
      "development",
      "--non-interactive",
    ]);
  });

  it.each([undefined, "", "file:///tmp/pulumi-state", "relative-state"])(
    "backend %sを拒否する",
    (backend) => {
      expect(() =>
        gcpPlatformCommand("preview", "development", { PULUMI_BACKEND_URL: backend }),
      ).toThrow();
    },
  );

  it("対象環境と一致する明示確認なしのupを拒否する", () => {
    expect(() =>
      gcpPlatformCommand("up", "production", {
        PULUMI_BACKEND_URL: "https://api.pulumi.com",
        ALLOW_GCP_PLATFORM_UP: "development",
      }),
    ).toThrow("ALLOW_GCP_PLATFORM_UP=production");
  });

  it("DIY backendへ暗号化設定なしでsecret stateを書かない", () => {
    expect(() =>
      gcpPlatformCommand("preview", "development", {
        PULUMI_BACKEND_URL: "gs://me-builder-pulumi-state",
      }),
    ).toThrow("passphrase");
  });
});
