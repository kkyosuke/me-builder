import { describe, expect, it } from "vitest";
import { parseAdminLineUserIds, resolveLineAccountRole } from "./admin-line-user";

describe("parseAdminLineUserIds", () => {
  it("カンマ区切りのIDをtrimし、空の要素を除く", () => {
    expect(parseAdminLineUserIds(" user-1, ,user-2, ")).toEqual(["user-1", "user-2"]);
  });

  it("未設定なら空配列を返す", () => {
    expect(parseAdminLineUserIds(undefined)).toEqual([]);
  });
});

describe("resolveLineAccountRole", () => {
  it("管理者IDに含まれる場合だけadminを返す", () => {
    expect(resolveLineAccountRole("user-1", ["user-1"])).toBe("admin");
    expect(resolveLineAccountRole("user-2", ["user-1"])).toBe("user");
  });
});
