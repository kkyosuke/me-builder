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
    expect(document.paths["/api/auth/liff/exchange"]?.post).toBeDefined();
    expect(document.paths["/api/auth/session"]?.get).toMatchObject({
      security: [{ applicationSession: [] }],
    });
    expect(document.paths["/api/auth/session"]?.delete).toMatchObject({
      security: [{ applicationSession: [], csrfToken: [] }],
    });
    expect(document.paths["/api/compatibility/share-consent"]?.get).toBeDefined();
    expect(document.paths["/api/compatibility/share-content"]?.get).toBeDefined();
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
    expect(document.paths["/api/compatibility/share-content"]?.get).toMatchObject({
      parameters: [
        {
          name: "relationshipCategory",
          in: "query",
          required: true,
          schema: {
            type: "string",
            enum: ["partner", "family", "friend", "work"],
          },
        },
      ],
    });
    expect(document.paths["/api/diagnoses/{diagnosisId}/answers"]?.get).toBeDefined();
    expect(document.paths["/api/profile"]?.get).toBeDefined();
    expect(document.paths["/api/profile/progression"]?.get).toBeDefined();
    expect(document.paths["/api/profile/avatar"]?.get).toBeDefined();
    expect(document.paths["/api/profile/avatar"]?.put).toBeDefined();
    expect(document.paths["/api/profile/avatar"]?.delete).toBeDefined();
    expect(document.paths["/api/personal-data/records"]?.get).toBeDefined();
    expect(document.paths["/api/personal-data/records/{sourceRecordId}"]?.patch).toMatchObject({
      requestBody: {
        content: {
          "application/json": {
            schema: {
              oneOf: [
                {
                  properties: {
                    kind: { const: "diagnosis" },
                    choiceId: { type: "string", minLength: 1 },
                  },
                },
                {
                  properties: {
                    kind: { const: "diary" },
                    value: { type: "string", minLength: 1, maxLength: 5_000 },
                  },
                },
              ],
              discriminator: { propertyName: "kind" },
            },
          },
        },
      },
    });
    expect(document.paths["/api/personal-data/records/{sourceRecordId}"]?.delete).toBeDefined();
    expect(document.paths["/api/legal/terms/acceptances"]?.get).toBeDefined();
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
    expect(document.components.securitySchemes.applicationSession).toMatchObject({
      type: "apiKey",
      in: "cookie",
      name: "__Host-me_builder_session",
    });
    expect(document.components.securitySchemes.csrfToken).toMatchObject({
      type: "apiKey",
      in: "header",
      name: "X-CSRF-Token",
    });
    expect(document.paths["/api/diagnoses"]?.get).toMatchObject({
      security: [{ applicationSession: [] }, { liffIdToken: [] }],
    });
    expect(document.paths["/api/family/seats"]?.get).toMatchObject({
      security: [{ applicationSession: [] }, { liffIdToken: [] }],
    });

    for (const [path, pathItem] of Object.entries(document.paths)) {
      for (const method of ["get", "post", "put", "patch", "delete"] as const) {
        const operation = pathItem[method] as
          | { operationId?: string; security?: Array<Record<string, unknown>> }
          | undefined;
        const liffRequirements = operation?.security?.filter(
          (requirement) => "liffIdToken" in requirement,
        );
        const applicationSessionRequirements = operation?.security?.filter(
          (requirement) => "applicationSession" in requirement,
        );
        if (liffRequirements?.length && !applicationSessionRequirements?.length) {
          expect(operation?.operationId).toBe("completeAccountRecovery");
        }
        if (method === "get") continue;
        if (!applicationSessionRequirements?.length) continue;
        expect(
          applicationSessionRequirements.every((requirement) => "csrfToken" in requirement),
          `${method.toUpperCase()} ${path} must document its application-session CSRF requirement`,
        ).toBe(true);
      }
    }

    const generatedDocument = JSON.parse(
      await readFile(new URL("../../openapi.json", import.meta.url), "utf8"),
    );
    expect(document).toEqual(generatedDocument);
  });
});
