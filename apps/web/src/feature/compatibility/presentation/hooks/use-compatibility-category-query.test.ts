// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useCompatibilityCategoryQuery } from "./use-compatibility-category-query";

describe("useCompatibilityCategoryQuery", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
  });

  it("URLのカテゴリを初期表示し、変更時は他のURL要素を保ったまま同期する", () => {
    window.history.replaceState({}, "", "/compatibility/share?category=family&from=test#scope");
    const { result } = renderHook(() => useCompatibilityCategoryQuery("category"));

    expect(result.current.relationshipCategory).toBe("family");
    act(() => result.current.changeRelationshipCategory("work"));

    expect(result.current.relationshipCategory).toBe("work");
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      "/compatibility/share?category=work&from=test#scope",
    );
  });

  it("ブラウザ履歴のカテゴリ変更へ追従し、定義外の値はパートナーへ戻す", () => {
    window.history.replaceState({}, "", "/me?shareCategory=friend");
    const { result } = renderHook(() => useCompatibilityCategoryQuery("shareCategory"));
    expect(result.current.relationshipCategory).toBe("friend");

    act(() => {
      window.history.pushState({}, "", "/me?shareCategory=family");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.relationshipCategory).toBe("family");

    act(() => {
      window.history.pushState({}, "", "/me?shareCategory=general");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.relationshipCategory).toBe("partner");
  });
});
