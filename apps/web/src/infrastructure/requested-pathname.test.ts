// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  hasLiffDeepLinkLocation,
  resolveRequestedLocation,
  resolveRequestedPathname,
} from "./requested-pathname";

describe("resolveRequestedPathname", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("LIFF endpoint配下でもdeep linkのpathnameを優先する", () => {
    window.history.replaceState({}, "", "/app?liff.state=%2Fcompatibility%2Finvitations%2Fexample");

    expect(resolveRequestedPathname()).toBe("/compatibility/invitations/example");
    expect(hasLiffDeepLinkLocation()).toBe(true);
  });

  it("pathなしのLIFF起動ではendpointの/appを維持する", () => {
    window.history.replaceState({}, "", "/app?liff.state=%2F");

    expect(resolveRequestedPathname()).toBe("/app");
    expect(hasLiffDeepLinkLocation()).toBe(false);
  });

  it("LIFF deep linkのqueryとhashを復帰先へ引き継ぐ", () => {
    window.history.replaceState(
      {},
      "",
      `/app?liff.state=${encodeURIComponent("/compatibility/share?category=family#scope")}`,
    );

    expect(resolveRequestedLocation()).toBe("/compatibility/share?category=family#scope");
  });

  it("protocol-relativeなLIFF stateは復帰先として受け付けない", () => {
    window.history.replaceState({}, "", "/app?liff.state=%2F%2Fevil.example%2Fpath");

    expect(resolveRequestedLocation()).toBe("/app?liff.state=%2F%2Fevil.example%2Fpath");
    expect(resolveRequestedPathname()).toBe("/app");
    expect(hasLiffDeepLinkLocation()).toBe(false);
  });
});
