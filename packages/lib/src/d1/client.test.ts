import type { D1Database } from "@cloudflare/workers-types";
import { describe, expect, it } from "vitest";
import { createD1Client, d1 } from "./index";
import { accountIdentities, accounts } from "./schema";

describe("D1 Client with Drizzle", () => {
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

    const db = createD1Client(mockD1);
    expect(db).toBeDefined();
    expect(db.select).toBeTypeOf("function");

    const dbViaNamespace = d1.client.create(mockD1);
    expect(dbViaNamespace).toBeDefined();
    expect(dbViaNamespace.select).toBeTypeOf("function");

    expect(accounts).toBeDefined();
    expect(accountIdentities).toBeDefined();
  });
});
