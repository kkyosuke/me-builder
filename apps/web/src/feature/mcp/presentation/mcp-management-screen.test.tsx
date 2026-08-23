// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpManagementScreen } from "./mcp-management-screen";

const mocks = vi.hoisted(() => ({
  fetchConnections: vi.fn(),
  fetchAudit: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock("../infrastructure/mcp-api", () => ({
  fetchMcpConnections: mocks.fetchConnections,
  fetchMcpAudit: mocks.fetchAudit,
  revokeMcpConnection: mocks.revoke,
}));

describe("McpManagementScreen", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("本人の接続・取得履歴を表示し、解除失敗を隠さない", async () => {
    mocks.fetchConnections.mockResolvedValue({
      connections: [
        {
          id: "connection-1",
          clientId: "https://client.example/metadata.json",
          clientName: "Example Client",
          scope: "brain:search",
          accessProfile: "owner",
          status: "active",
          authorizedAt: "2026-08-21T00:00:00.000Z",
          lastUsedAt: null,
          revokedAt: null,
        },
      ],
    });
    mocks.fetchAudit.mockResolvedValue({
      records: [
        {
          id: "audit-1",
          connectionId: "connection-1",
          clientName: "Example Client",
          outcome: "success",
          reasonCode: "SEARCH_COMPLETED",
          resultCount: 1,
          brainItemIds: ["brain-1"],
          occurredAt: "2026-08-21T00:10:00.000Z",
        },
      ],
    });
    mocks.revoke.mockRejectedValue(new Error("解除に失敗しました。"));
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );

    render(<McpManagementScreen onBack={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "Example Client" })).toBeTruthy();
    expect(screen.getByText(/SEARCH_COMPLETED/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "解除" }));
    expect((await screen.findByRole("alert")).textContent).toContain("解除に失敗しました。");
  });
});
