// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServiceSiteFooter } from "./service-site-footer";

afterEach(cleanup);

describe("ServiceSiteFooter", () => {
  it("正式な運営者を表示し、Free限定中は特商法への公開導線を出さない", () => {
    render(<ServiceSiteFooter />);

    expect(screen.getByText("運営者: つきうさぎ（運営者：河村 京介）")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "特定商取引法に基づく表記" })).toBeNull();
    expect(screen.getByRole("link", { name: "プライバシーポリシー" })).toBeTruthy();
  });
});
