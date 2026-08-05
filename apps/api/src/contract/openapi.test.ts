import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { app } from "../app";

describe("GET /api/openapi.json", () => {
  it("Web UIが利用するAPI契約をOpenAPI 3.1として公開する", async () => {
    const response = await app.request("/api/openapi.json");
    const document = (await response.json()) as {
      openapi: string;
      paths: Record<string, Record<string, unknown>>;
      components: { securitySchemes: Record<string, unknown> };
    };

    expect(response.status).toBe(200);
    expect(document.openapi).toBe("3.1.0");
    expect(document.paths["/api/diagnoses"]?.get).toBeDefined();
    expect(document.paths["/api/diagnoses/{diagnosisId}/answers"]?.get).toBeDefined();
    expect(document.paths["/api/line/liff/session"]?.post).toBeDefined();
    expect(document.paths["/api/line/liff/session"]?.post).toMatchObject({
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["idToken"],
            },
          },
        },
      },
    });
    expect(document.paths["/api/openapi.json"]).toBeUndefined();
    expect(document.components.securitySchemes.liffIdToken).toMatchObject({
      type: "http",
      scheme: "bearer",
    });

    const generatedDocument = JSON.parse(
      await readFile(new URL("../../openapi.json", import.meta.url), "utf8"),
    );
    expect(document).toEqual(generatedDocument);
  });
});
