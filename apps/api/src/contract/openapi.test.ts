import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { requireAuthentication } from "../middleware/authentication";
import {
  requireAdmin,
  requireCurrentTerms,
  requireDevelopmentEnvironment,
} from "../middleware/authorization";

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

const BODYLESS_RESPONSE_FIXTURES = new Set([
  "delete /api/account 204",
  "post /api/observability/web-errors 204",
  "post /api/observability/web-errors 400",
  "post /api/observability/web-errors 413",
  "post /api/observability/web-errors 429",
  "delete /api/auth/sso/identity 204",
  "get /api/auth/sso/callback 302",
  "get /api/mcp/oauth/authorize 302",
  "delete /api/auth/session 204",
  "delete /api/mcp/connections/{connectionId} 204",
  "get /api/profile/avatar 204",
  "get /api/compatibility/invitations/{relationshipId}/avatar 204",
  "delete /api/compatibility/invitations/{relationshipId} 204",
  "delete /api/compatibility/relationships/{relationshipId} 204",
]);

const NON_JSON_RESPONSE_FIXTURES = new Map([
  ["get /api/profile/avatar 200", ["image/jpeg", "image/png", "image/webp"]],
  [
    "get /api/compatibility/invitations/{relationshipId}/avatar 200",
    ["image/jpeg", "image/png", "image/webp"],
  ],
]);

type SecurityRequirement = Record<string, unknown[]>;
type OpenApiResponse = {
  description?: string;
  content?: Record<string, { schema?: Record<string, unknown> }>;
};
type OpenApiOperation = {
  operationId?: string;
  tags?: string[];
  summary?: string;
  security?: SecurityRequirement[];
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: Record<string, unknown> }>;
  };
  responses?: Record<string, OpenApiResponse>;
};
type OpenApiDocument = {
  openapi: string;
  paths: Record<string, Partial<Record<(typeof HTTP_METHODS)[number], OpenApiOperation>>>;
  components: { securitySchemes: Record<string, unknown> };
};

function operations(document: OpenApiDocument) {
  return Object.entries(document.paths).flatMap(([path, pathItem]) =>
    HTTP_METHODS.flatMap((method) => {
      const operation = pathItem[method];
      return operation ? [{ method, path, operation }] : [];
    }),
  );
}

function runtimeOperations() {
  return [
    ...new Set(
      app.routes
        .filter(
          (route) =>
            route.method !== "ALL" &&
            route.path.startsWith("/api/") &&
            route.path !== "/api/openapi.json",
        )
        .map((route) => `${route.method.toLowerCase()} ${route.path.replace(/:([^/]+)/g, "{$1}")}`),
    ),
  ].sort();
}

function runtimeHandlersByOperation() {
  const handlers = new Map<string, Set<(typeof app.routes)[number]["handler"]>>();
  for (const route of app.routes) {
    if (
      route.method === "ALL" ||
      !route.path.startsWith("/api/") ||
      route.path === "/api/openapi.json"
    ) {
      continue;
    }
    const operation = `${route.method.toLowerCase()} ${route.path.replace(/:([^/]+)/g, "{$1}")}`;
    const operationHandlers = handlers.get(operation) ?? new Set();
    operationHandlers.add(route.handler);
    handlers.set(operation, operationHandlers);
  }
  return handlers;
}

describe("GET /api/openapi.json", () => {
  it("Web UIが利用するAPI契約をOpenAPI 3.1として公開する", async () => {
    const response = await app.request("/api/openapi.json");
    const document = (await response.json()) as OpenApiDocument;

    expect(response.status).toBe(200);
    expect(document.openapi).toBe("3.1.0");
    expect(document.paths["/api/diagnoses"]?.get).toBeDefined();
    expect(document.paths["/api/auth/liff/exchange"]?.post).toBeDefined();
    expect(document.paths["/api/observability/web-errors"]?.post).toMatchObject({
      responses: { "204": { description: "ブラウザエラーを受理した" } },
      security: [{ applicationSession: [], csrfToken: [] }],
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: [
                "schemaVersion",
                "kind",
                "route",
                "release",
                "errorType",
                "online",
                "recovered",
              ],
            },
          },
        },
      },
    });
    expect(document.paths["/api/auth/session"]?.get).toMatchObject({
      security: [{ applicationSession: [] }],
    });
    expect(document.paths["/api/auth/session"]?.delete).toMatchObject({
      security: [{ applicationSession: [], csrfToken: [] }],
    });
    expect(document.paths["/api/account"]?.delete).toMatchObject({
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: { confirmed: { type: "boolean", const: true } },
              required: ["confirmed"],
            },
          },
        },
      },
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
              type: "object",
              properties: {
                kind: { type: "string", const: "diary" },
                value: { type: "string", minLength: 1, maxLength: 5_000 },
              },
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
    expect(document.components.securitySchemes.liffIdToken).toBeUndefined();
    expect(JSON.stringify(document.paths)).not.toContain('"liffIdToken"');
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
      security: [{ applicationSession: [] }],
    });
    expect(document.paths["/api/account-recovery/complete"]?.post).toMatchObject({
      security: [{ applicationSession: [], csrfToken: [] }],
    });
    expect(document.paths["/api/family/seats"]?.get).toMatchObject({
      security: [{ applicationSession: [] }],
    });

    for (const [path, pathItem] of Object.entries(document.paths)) {
      for (const method of HTTP_METHODS) {
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

  it("runtime routeとOpenAPI operationを双方向かつ全契約項目で一致させる", async () => {
    const response = await app.request("/api/openapi.json");
    const document = (await response.json()) as OpenApiDocument;
    const documentedOperations = operations(document);

    expect(documentedOperations.map(({ method, path }) => `${method} ${path}`).sort()).toEqual(
      runtimeOperations(),
    );

    const operationIds = new Set<string>();
    const runtimeHandlers = runtimeHandlersByOperation();
    const signedOperations = new Map([
      ["post /api/line/webhook", "lineWebhookSignature"],
      ["post /api/billing/webhook", "stripeWebhookSignature"],
    ]);

    for (const { method, path, operation } of documentedOperations) {
      const route = `${method} ${path}`;
      expect(operation.operationId, `${route} must have operationId`).toBeTruthy();
      expect(
        operationIds.has(operation.operationId as string),
        `${route} has duplicate operationId`,
      ).toBe(false);
      operationIds.add(operation.operationId as string);
      expect(operation.tags?.length, `${route} must have at least one tag`).toBeGreaterThan(0);
      expect(operation.summary, `${route} must have summary`).toBeTruthy();
      expect(operation.security, `${route} must explicitly declare security`).toBeDefined();

      const handlers = runtimeHandlers.get(route);
      expect(handlers, `${route} must be registered at runtime`).toBeDefined();
      const requiresAuthentication = handlers?.has(requireAuthentication) ?? false;
      const requiresCurrentTerms = handlers?.has(requireCurrentTerms) ?? false;
      const requiresAdmin = handlers?.has(requireAdmin) ?? false;
      const requiresDevelopmentEnvironment = handlers?.has(requireDevelopmentEnvironment) ?? false;
      const signedScheme = signedOperations.get(route);
      if (signedScheme) {
        expect(operation.security).toEqual([{ [signedScheme]: [] }]);
        expect(requiresAuthentication, `${route} must not use application-session auth`).toBe(
          false,
        );
      } else if (requiresAuthentication) {
        expect(operation.security).toEqual([
          method === "get" ? { applicationSession: [] } : { applicationSession: [], csrfToken: [] },
        ]);
      } else {
        expect(operation.security).toEqual([]);
      }
      for (const requirement of operation.security ?? []) {
        for (const securityScheme of Object.keys(requirement)) {
          expect(
            document.components.securitySchemes,
            `${route} references an unknown security scheme`,
          ).toHaveProperty(securityScheme);
        }
      }

      expect(
        operation.tags?.includes("Admin") ?? false,
        `${route} Admin tag must match its runtime authorization middleware`,
      ).toBe(requiresAdmin);
      expect(
        operation.tags?.includes("Development") ?? false,
        `${route} Development tag must match its runtime environment middleware`,
      ).toBe(requiresDevelopmentEnvironment);
      if (operation.requestBody) {
        expect(operation.requestBody.required, `${route} request body must be required`).toBe(true);
      }

      const responses = operation.responses ?? {};
      expect(Object.keys(responses).length, `${route} must declare responses`).toBeGreaterThan(0);
      if (operation.security?.some((requirement) => "csrfToken" in requirement)) {
        expect(
          responses["403"],
          `${route} must declare its Origin and CSRF validation response`,
        ).toBeDefined();
      }
      expect(
        Boolean(responses["428"]),
        `${route} 428 response must match its runtime current-terms middleware`,
      ).toBe(requiresCurrentTerms);
      if (requiresAdmin) {
        expect(
          responses["403"],
          `${route} must declare its admin authorization response`,
        ).toBeDefined();
      }
      if (requiresDevelopmentEnvironment) {
        expect(
          responses["404"],
          `${route} must declare its production-hidden response`,
        ).toBeDefined();
      }
      expect(
        Object.keys(responses).some((status) => /^[23]\d{2}$/.test(status)),
        `${route} must declare a successful response or redirect`,
      ).toBe(true);
      expect(responses["500"], `${route} must declare the global error response`).toBeDefined();
      for (const [status, documentedResponse] of Object.entries(responses)) {
        const responseFixture = `${route} ${status}`;
        expect(status, `${responseFixture} must use an explicit HTTP status`).toMatch(
          /^[1-5]\d{2}$/,
        );
        expect(
          documentedResponse.description,
          `${route} ${status} must have description`,
        ).toBeTruthy();
        const contentTypes = Object.keys(documentedResponse.content ?? {}).sort();
        const expectedNonJsonContentTypes = NON_JSON_RESPONSE_FIXTURES.get(responseFixture);
        if (BODYLESS_RESPONSE_FIXTURES.has(responseFixture)) {
          expect(contentTypes, `${responseFixture} must have an empty body`).toEqual([]);
        } else if (expectedNonJsonContentTypes) {
          expect(contentTypes, `${responseFixture} must declare its binary content types`).toEqual(
            expectedNonJsonContentTypes,
          );
        } else {
          expect(contentTypes, `${responseFixture} must be an application/json response`).toEqual([
            "application/json",
          ]);
        }
        for (const [contentType, mediaType] of Object.entries(documentedResponse.content ?? {})) {
          expect(
            mediaType.schema,
            `${route} ${status} ${contentType} must declare schema`,
          ).toBeDefined();
        }
      }
    }

    for (const path of [
      "/api/profile/avatar",
      "/api/compatibility/invitations/{relationshipId}/avatar",
    ]) {
      expect(document.paths[path]?.get?.responses?.["200"]?.content).toMatchObject({
        "image/jpeg": { schema: { type: "string", format: "binary" } },
        "image/png": { schema: { type: "string", format: "binary" } },
        "image/webp": { schema: { type: "string", format: "binary" } },
      });
    }
    expect(
      document.paths["/api/personal-data/features"]?.get?.responses?.["200"]?.content,
    ).toHaveProperty("application/json");
    expect(document.paths["/api/personal-data/exports"]).toBeUndefined();
  });
});
