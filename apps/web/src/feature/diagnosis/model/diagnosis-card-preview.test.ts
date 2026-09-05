import { describe, expect, it } from "vitest";
import {
  DIAGNOSIS_CARD_PREVIEW_PATHNAME,
  shouldShowDiagnosisCardPreview,
} from "./diagnosis-card-preview";

describe("shouldShowDiagnosisCardPreview", () => {
  it.each(["development", "local", "test"])("%s環境では専用pathの表示を許可する", (environment) => {
    expect(shouldShowDiagnosisCardPreview(environment, DIAGNOSIS_CARD_PREVIEW_PATHNAME)).toBe(true);
    expect(shouldShowDiagnosisCardPreview(environment, `${DIAGNOSIS_CARD_PREVIEW_PATHNAME}/`)).toBe(
      true,
    );
  });

  it.each([undefined, "preview", "production"])("%s環境では専用pathを公開しない", (environment) => {
    expect(shouldShowDiagnosisCardPreview(environment, DIAGNOSIS_CARD_PREVIEW_PATHNAME)).toBe(
      false,
    );
  });

  it("開発環境でも他のpathでは表示しない", () => {
    expect(shouldShowDiagnosisCardPreview("local", "/diagnosis")).toBe(false);
  });
});
