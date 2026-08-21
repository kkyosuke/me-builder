// @vitest-environment jsdom

import { currentServiceTerms, serviceTermsDocuments } from "@me-builder/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authSessionRuntime } from "../feature/auth/infrastructure/auth-session-runtime";
import { ServiceTermsGate } from "../feature/legal";

const auth = vi.hoisted(() => ({
  state: { status: "authenticated", revision: 1 } as const,
  retry: vi.fn(),
}));

vi.mock("../config", () => ({
  config: { apiUrl: "https://api.example.com" },
}));
vi.mock("../feature/auth", () => ({
  useAuthSession: () => auth,
}));

const oldImportantVersion = serviceTermsDocuments[0];
const acceptedAt = "2026-08-18T01:23:45.000Z";

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(String(input), "https://web.example.com");
}

function installTermsApi(initialAcceptedVersion: string | null) {
  let acceptedVersion = initialAcceptedVersion;
  let acceptanceRequests = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = init?.method ?? "GET";
    if (url.pathname === "/api/legal/terms" && method === "GET") {
      const accepted = acceptedVersion === currentServiceTerms.version;
      return Response.json({
        document: currentServiceTerms,
        notice: null,
        acceptance: {
          required: !accepted,
          acceptedVersion: accepted ? currentServiceTerms.version : null,
          documentHash: accepted ? currentServiceTerms.contentHash : null,
          acceptedAt: accepted ? acceptedAt : null,
        },
      });
    }
    if (url.pathname === "/api/legal/terms/acceptance" && method === "PUT") {
      acceptanceRequests += 1;
      const headers = new Headers(init?.headers);
      expect(init?.credentials).toBe("include");
      expect(headers.get("X-CSRF-Token")).toBe("csrf-terms-e2e");
      expect(JSON.parse(String(init?.body))).toEqual({ version: currentServiceTerms.version });
      acceptedVersion = currentServiceTerms.version;
      return Response.json({
        documentKey: "terms_of_service",
        version: currentServiceTerms.version,
        documentHash: currentServiceTerms.contentHash,
        acceptedAt,
      });
    }
    throw new Error(`Unexpected terms E2E request: ${method} ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { acceptanceRequests: () => acceptanceRequests };
}

function renderGate() {
  return render(
    <ServiceTermsGate>
      <p>本人向け主機能</p>
    </ServiceTermsGate>,
  );
}

async function acceptDisplayedTerms() {
  expect(await screen.findByRole("heading", { name: currentServiceTerms.title })).toBeTruthy();
  expect(screen.queryByText("本人向け主機能")).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: /利用規約の内容を確認/ }));
  fireEvent.click(screen.getByRole("button", { name: "同意して利用を始める" }));
  await waitFor(() => expect(screen.getByText("本人向け主機能")).toBeTruthy());
}

describe("service terms consent Web E2E", () => {
  beforeEach(() => {
    authSessionRuntime.reset();
    authSessionRuntime.setCsrfToken("csrf-terms-e2e");
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    authSessionRuntime.reset();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("初回同意では主機能を隠し、現行versionの保存完了後だけ開始する", async () => {
    const api = installTermsApi(null);
    renderGate();

    await acceptDisplayedTerms();

    expect(api.acceptanceRequests()).toBe(1);
    expect(window.location.pathname).toBe("/me");
  });

  it("重要改定前の同意では現行versionへの再同意を要求する", async () => {
    expect(oldImportantVersion.requiresReacceptance).toBe(true);
    expect(oldImportantVersion.version).not.toBe(currentServiceTerms.version);
    const api = installTermsApi(oldImportantVersion.version);
    renderGate();

    await acceptDisplayedTerms();

    expect(api.acceptanceRequests()).toBe(1);
  });

  it("現行versionへ同意済みなら同意APIを再送せず利用を継続する", async () => {
    const api = installTermsApi(currentServiceTerms.version);
    renderGate();

    expect(await screen.findByText("本人向け主機能")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: currentServiceTerms.title })).toBeNull();
    expect(api.acceptanceRequests()).toBe(0);
  });
});
