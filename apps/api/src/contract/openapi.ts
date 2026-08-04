import type { GenerateSpecOptions } from "hono-openapi";

export const openApiOptions = {
  documentation: {
    info: {
      title: "me-builder API",
      version: "0.1.0",
      description: "me-builder Web UIが利用するHTTP API契約",
    },
    components: {
      securitySchemes: {
        liffIdToken: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "LIFF ID token",
        },
      },
    },
  },
  exclude: ["/api/openapi.json"],
} satisfies Partial<GenerateSpecOptions>;
