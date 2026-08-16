// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceTermsGate } from "./service-terms-gate";

const mocks = vi.hoisted(() => ({
  acquireIdToken: vi.fn(),
  fetchStatus: vi.fn(),
  accept: vi.fn(),
}));

vi.mock("../../liff", () => ({
  useLiffSession: () => ({ acquireIdToken: mocks.acquireIdToken }),
}));
vi.mock("../infrastructure/service-terms-api", () => ({
  ServiceTermsVersionConflictError: class extends Error {},
  fetchServiceTermsStatus: mocks.fetchStatus,
  acceptServiceTerms: mocks.accept,
}));

const document = {
  documentKey: "terms_of_service" as const,
  version: "2026-08-15",
  contentHash: "sha256:test",
  requiresReacceptance: true,
  publishedAt: "2026-08-15T00:00:00+09:00",
  title: "かがみ サービス利用規約",
  summary: "サービスの説明",
  sections: [{ heading: "1. 規約への同意", paragraphs: ["規約本文です。"] }],
};

describe("ServiceTermsGate", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    mocks.acquireIdToken.mockResolvedValue("id-token");
    mocks.accept.mockResolvedValue({
      acceptedAt: "2026-08-15T01:23:45.000Z",
      version: document.version,
      documentHash: document.contentHash,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("未同意では主機能をマウントせず、保存完了後に表示する", async () => {
    mocks.fetchStatus.mockResolvedValue({
      document,
      acceptance: { required: true, acceptedVersion: null, documentHash: null, acceptedAt: null },
    });

    render(
      <ServiceTermsGate>
        <p>主機能</p>
      </ServiceTermsGate>,
    );

    expect(await screen.findByRole("heading", { name: document.title })).toBeTruthy();
    expect(screen.queryByText("主機能")).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: /利用規約の内容を確認/ }));
    fireEvent.click(screen.getByRole("button", { name: "同意して利用を始める" }));

    await waitFor(() => expect(screen.getByText("主機能")).toBeTruthy());
    expect(mocks.accept).toHaveBeenCalledWith(undefined, "id-token", document.version);
    expect(window.location.pathname).toBe("/me");
  });

  it("共有リンクからの初回同意後は元の招待画面へ復帰する", async () => {
    const relationshipId = "1".repeat(64);
    const invitationPath = `/compatibility/invitations/${relationshipId}`;
    window.history.replaceState(null, "", `/app?liff.state=${encodeURIComponent(invitationPath)}`);
    mocks.fetchStatus.mockResolvedValue({
      document,
      acceptance: { required: true, acceptedVersion: null, documentHash: null, acceptedAt: null },
    });

    render(
      <ServiceTermsGate>
        <p>招待画面</p>
      </ServiceTermsGate>,
    );

    expect(await screen.findByRole("heading", { name: document.title })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /利用規約の内容を確認/ }));
    fireEvent.click(screen.getByRole("button", { name: "同意して利用を始める" }));

    expect(await screen.findByText("招待画面")).toBeTruthy();
    expect(window.location.pathname).toBe(invitationPath);
    expect(window.location.search).toBe("");
  });

  it("現在versionへ同意済みなら規約を再表示せず主機能を表示する", async () => {
    mocks.fetchStatus.mockResolvedValue({
      document,
      acceptance: {
        required: false,
        acceptedVersion: document.version,
        documentHash: document.contentHash,
        acceptedAt: "2026-08-15T01:23:45.000Z",
      },
    });

    render(
      <ServiceTermsGate>
        <p>主機能</p>
      </ServiceTermsGate>,
    );

    expect(await screen.findByText("主機能")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: document.title })).toBeNull();
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it("LIFF deep linkのterms指定では同意済みでも規約を表示する", async () => {
    window.history.replaceState(null, "", "/?liff.state=%2Fterms");
    mocks.fetchStatus.mockResolvedValue({
      document,
      acceptance: {
        required: false,
        acceptedVersion: document.version,
        documentHash: document.contentHash,
        acceptedAt: "2026-08-15T01:23:45.000Z",
      },
    });

    render(
      <ServiceTermsGate>
        <p>主機能</p>
      </ServiceTermsGate>,
    );

    expect(await screen.findByRole("heading", { name: document.title })).toBeTruthy();
    expect(screen.queryByText("主機能")).toBeNull();
  });

  it("表示中にversionが変わったら最新本文を再取得する", async () => {
    const latestDocument = { ...document, version: "2026-08-15-2", summary: "改定後の説明" };
    mocks.fetchStatus
      .mockResolvedValueOnce({
        document,
        acceptance: {
          required: true,
          acceptedVersion: null,
          documentHash: null,
          acceptedAt: null,
        },
      })
      .mockResolvedValueOnce({
        document: latestDocument,
        acceptance: {
          required: true,
          acceptedVersion: null,
          documentHash: null,
          acceptedAt: null,
        },
      });
    const { ServiceTermsVersionConflictError } = await import(
      "../infrastructure/service-terms-api"
    );
    mocks.accept.mockRejectedValueOnce(new ServiceTermsVersionConflictError());

    render(
      <ServiceTermsGate>
        <p>主機能</p>
      </ServiceTermsGate>,
    );
    expect(await screen.findByText(document.summary)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /利用規約の内容を確認/ }));
    fireEvent.click(screen.getByRole("button", { name: "同意して利用を始める" }));

    expect(await screen.findByText(latestDocument.summary)).toBeTruthy();
    expect(mocks.fetchStatus).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("主機能")).toBeNull();
  });
});
