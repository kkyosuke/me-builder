// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { resolveRequestedPathname } from "./requested-pathname";

describe("resolveRequestedPathname", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("LIFF endpoint配下でもdeep linkのpathnameを優先する", () => {
    window.history.replaceState({}, "", "/app?liff.state=%2Fcompatibility%2Finvitations%2Fexample");

    expect(resolveRequestedPathname()).toBe("/compatibility/invitations/example");
  });

  it("pathなしのLIFF起動ではendpointの/appを維持する", () => {
    window.history.replaceState({}, "", "/app?liff.state=%2F");

    expect(resolveRequestedPathname()).toBe("/app");
  });
});
