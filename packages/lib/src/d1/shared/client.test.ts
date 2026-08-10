import type { D1Database } from "@cloudflare/workers-types";
import { describe, expect, it } from "vitest";
import { D1 } from "../index";
import { accountIdentities, accounts } from "./schema";

describe("shared D1 client with Drizzle", () => {
  it("should initialize Drizzle client from D1Database binding", () => {
    // Mock Cloudflare D1Database binding
    const mockD1: D1Database = {
      prepare: () => ({
        bind: () => ({}),
        first: async () => null,
        run: async () => ({ success: true, meta: {} }),
        all: async () => ({ results: [], success: true, meta: {} }),
        raw: async () => [],
      }),
      batch: async () => [],
      exec: async () => ({ count: 0, duration: 0 }),
      dump: async () => new ArrayBuffer(0),
    } as unknown as D1Database;

    const db = D1.shared.client.create(mockD1);
    expect(db).toBeDefined();
    expect(db.select).toBeTypeOf("function");

    expect(accounts).toBeDefined();
    expect(accountIdentities).toBeDefined();
  });
});
