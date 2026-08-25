import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../../types";

const mocks = vi.hoisted(() => ({
  createDb: vi.fn(() => ({ db: true })),
  applicationSessionServiceArguments: vi.fn(),
  kvStoreArguments: vi.fn(),
  versionProviderArguments: vi.fn(),
}));

vi.mock("@me-builder/lib", () => ({
  D1: { shared: { client: { create: mocks.createDb } } },
}));
vi.mock("../../logic/authentication/application-session", () => ({
  ApplicationSessionService: class {
    constructor(...args: unknown[]) {
      mocks.applicationSessionServiceArguments(...args);
    }
  },
}));
vi.mock("./kv-application-session-store", () => ({
  KvApplicationSessionStore: class {
    constructor(...args: unknown[]) {
      mocks.kvStoreArguments(...args);
    }
  },
}));
vi.mock("./d1-account-session-version-provider", () => ({
  D1AccountSessionVersionProvider: class {
    constructor(...args: unknown[]) {
      mocks.versionProviderArguments(...args);
    }
  },
}));

import { createApplicationSessionService } from "./application-session-runtime";

describe("createApplicationSessionService", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([undefined, {}, { DB: {} }, { SESSION_STORE: {} }])(
    "必要なbindingが揃わない場合はruntimeを作らない",
    (bindings) => {
      expect(
        createApplicationSessionService(
          bindings as Pick<AppEnv["Bindings"], "DB" | "SESSION_STORE">,
        ),
      ).toBeUndefined();
      expect(mocks.createDb).not.toHaveBeenCalled();
    },
  );

  it("D1とKVのadapterをapplication session serviceへ組み立てる", () => {
    const DB = { binding: "d1" } as unknown as NonNullable<AppEnv["Bindings"]["DB"]>;
    const SESSION_STORE = {
      binding: "kv",
    } as unknown as NonNullable<AppEnv["Bindings"]["SESSION_STORE"]>;

    const result = createApplicationSessionService({ DB, SESSION_STORE });

    expect(result).toEqual({ db: { db: true }, sessions: expect.anything() });
    expect(mocks.createDb).toHaveBeenCalledWith(DB);
    expect(mocks.kvStoreArguments).toHaveBeenCalledWith(SESSION_STORE);
    expect(mocks.versionProviderArguments).toHaveBeenCalledWith({ db: true });
    expect(mocks.applicationSessionServiceArguments).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
    );
  });
});
