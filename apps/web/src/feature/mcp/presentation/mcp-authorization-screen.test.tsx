// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpAuthorizationScreen } from "./mcp-authorization-screen";

const mocks = vi.hoisted(() => ({
  fetchRequest: vi.fn(),
  decide: vi.fn(),
}));

vi.mock("../infrastructure/mcp-api", () => ({
  fetchMcpAuthorizationRequest: mocks.fetchRequest,
  decideMcpAuthorizationRequest: mocks.decide,
}));

describe("McpAuthorizationScreen", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("検証済みclientと取得・解除の境界を同意前に表示する", async () => {
    window.history.replaceState({}, "", "/mcp/authorize?request=request-1");
    mocks.fetchRequest.mockResolvedValue({
      id: "request-1",
      clientId: "https://client.example/metadata.json",
      clientName: "Example Client",
      scope: "brain:search",
      accessProfile: "owner",
      expiresAt: "2026-08-21T01:00:00.000Z",
    });

    render(<McpAuthorizationScreen />);

    expect(await screen.findByRole("heading", { name: "Example Client" })).toBeTruthy();
    expect(screen.getByText("https://client.example/metadata.json")).toBeTruthy();
    expect(screen.getByText(/外部提供を許可したBrain Itemだけ/)).toBeTruthy();
    expect(screen.getByText(/接続を解除しても削除されません/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "拒否する" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "接続を許可" })).toBeTruthy();
  });
});
