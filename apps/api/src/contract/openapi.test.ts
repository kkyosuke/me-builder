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
    expect(document.paths["/api/compatibility/share-consent"]?.get).toBeDefined();
    expect(document.paths["/api/compatibility/invitations"]?.post).toBeDefined();
    // 表示内容の確認tokenは受け取らず、招待時に選ぶ関係カテゴリだけを本文で受け取る。
    expect(document.paths["/api/compatibility/invitations"]?.post).toMatchObject({
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                relationshipCategory: {
                  type: "string",
                  enum: ["partner", "family", "friend", "work"],
                },
              },
              required: ["relationshipCategory"],
            },
          },
        },
      },
    });
    expect(document.paths["/api/compatibility/share-consent"]?.get).toMatchObject({
      parameters: [
        {
          name: "relationshipCategory",
          in: "query",
          required: false,
          schema: {
            type: "string",
            enum: ["partner", "family", "friend", "work"],
          },
        },
      ],
    });
    expect(document.paths["/api/diagnoses/{diagnosisId}/answers"]?.get).toBeDefined();
    expect(document.paths["/api/profile"]?.get).toBeDefined();
    expect(document.paths["/api/profile/avatar"]?.get).toBeDefined();
    expect(document.paths["/api/profile/avatar"]?.put).toBeDefined();
    expect(document.paths["/api/profile/avatar"]?.delete).toBeDefined();
    expect(
      document.paths["/api/compatibility/invitations/{relationshipId}/avatar"]?.get,
    ).toBeDefined();
    expect(document.paths["/api/dev/brain-items"]?.get).toBeDefined();
    expect(document.paths["/api/dev/brain-items/{brainItemId}/vector"]?.get).toBeDefined();
    expect(document.paths["/api/dev/brain-vector-sync-jobs/failed"]?.get).toBeDefined();
    expect(document.paths["/api/dev/brain-vector-sync-jobs/reset-failed"]?.post).toBeDefined();
    expect(document.paths["/api/dev/brain-vector-sync-jobs/{jobId}/reset"]?.post).toBeDefined();
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
