import { describe, expect, it } from "vitest";
import { operationalHttpPath } from "./operational-http-path";

describe("operationalHttpPath", () => {
  it.each([
    `/api/compatibility/invitations/${"a".repeat(64)}`,
    `/api/compatibility/invitations/${"a".repeat(64)}/`,
    `/api/compatibility/invitations/${"a".repeat(64)}/unexpected`,
    "/api/compatibility/invitations/invalid",
  ])("招待IDを含み得るpathを登録routeへ置き換える: %s", (path) => {
    expect(operationalHttpPath(path)).toBe("/api/compatibility/invitations/:relationshipId");
  });

  it.each(["/api/compatibility/invitations", "/api/compatibility/share-preview", "/api/health"])(
    "招待IDを含まないpathは変更しない: %s",
    (path) => expect(operationalHttpPath(path)).toBe(path),
  );

  it.each([
    `/api/compatibility/relationships/${"a".repeat(64)}`,
    "/api/compatibility/relationships/invalid",
  ])("相性関係IDを運用ログへ含めない: %s", (path) => {
    expect(operationalHttpPath(path)).toBe("/api/compatibility/relationships/:relationshipId");
  });
});
