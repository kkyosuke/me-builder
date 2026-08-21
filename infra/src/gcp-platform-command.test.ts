import { describe, expect, it } from "vitest";
import { gcpPlatformCommand } from "./gcp-platform-command";

describe("gcpPlatformCommand", () => {
  it("GCS backendを明示したpreview commandを返す", () => {
    expect(
      gcpPlatformCommand("preview", "development", {
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

  it("対象環境と一致する明示確認なしのupを拒否する", () => {
    expect(() =>
      gcpPlatformCommand("up", "production", {
        PULUMI_CONFIG_PASSPHRASE: "test-only-passphrase",
        ALLOW_GCP_PLATFORM_UP: "development",
      }),
    ).toThrow("ALLOW_GCP_PLATFORM_UP=production");
  });

  it("GCS backendへ暗号化設定なしでsecret stateを書かない", () => {
    expect(() => gcpPlatformCommand("preview", "development", {})).toThrow(
      "PULUMI_CONFIG_PASSPHRASE",
    );
  });
});
