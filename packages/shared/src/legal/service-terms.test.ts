import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  currentRequiredServiceTerms,
  currentServiceTerms,
  serviceTermsDocuments,
  serviceTermsDocumentsSatisfyingCurrentRequirement,
} from "./service-terms";

describe("service terms documents", () => {
  it("公開済み本文と運用属性に一致するSHA-256を保持する", () => {
    for (const document of serviceTermsDocuments) {
      const { contentHash, ...content } = document;
      const expected = `sha256:${createHash("sha256")
        .update(JSON.stringify(content))
        .digest("hex")}`;
      expect(contentHash).toBe(expected);
    }
  });

  it("最新の同意必須version以降を有効な同意対象にする", () => {
    expect(serviceTermsDocumentsSatisfyingCurrentRequirement[0]).toBe(currentRequiredServiceTerms);
    expect(serviceTermsDocumentsSatisfyingCurrentRequirement).toContain(currentServiceTerms);
  });
});
