import { describe, expect, it } from "vitest";
import { type RuntimeContractDocument, assertRuntimeResponseContract } from "./runtime-response";

const document = {
  paths: {
    "/api/items/{itemId}": {
      get: {
        responses: {
          200: { content: { "application/json": {} } },
          204: {},
        },
      },
    },
  },
} satisfies RuntimeContractDocument;

describe("assertRuntimeResponseContract", () => {
  it("statusとcharsetを除いたcontent typeが契約に一致するresponseを受理する", () => {
    expect(() =>
      assertRuntimeResponseContract(
        document,
        "GET",
        "/api/items/:itemId",
        Response.json({ id: "item-1" }),
      ),
    ).not.toThrow();
    expect(() =>
      assertRuntimeResponseContract(
        document,
        "GET",
        "/api/items/:itemId",
        new Response(null, { status: 204 }),
      ),
    ).not.toThrow();
  });

  it("未登録route、status、content type、空body契約の違反を拒否する", () => {
    expect(() =>
      assertRuntimeResponseContract(document, "POST", "/api/items/:itemId", Response.json({})),
    ).toThrow("is not registered");
    expect(() =>
      assertRuntimeResponseContract(
        document,
        "GET",
        "/api/items/:itemId",
        Response.json({}, { status: 201 }),
      ),
    ).toThrow("undocumented status");
    expect(() =>
      assertRuntimeResponseContract(
        document,
        "GET",
        "/api/items/:itemId",
        new Response("ok", { headers: { "content-type": "text/plain" } }),
      ),
    ).toThrow("undocumented content type");
    expect(() =>
      assertRuntimeResponseContract(
        document,
        "GET",
        "/api/items/:itemId",
        new Response(null, { status: 204, headers: { "content-type": "application/json" } }),
      ),
    ).toThrow("bodyless status");
  });
});
