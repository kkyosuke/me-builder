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
        applicationSession: {
          type: "apiKey",
          in: "cookie",
          name: "__Host-me_builder_session",
          description: "HttpOnlyのprovider非依存application session",
        },
        csrfToken: {
          type: "apiKey",
          in: "header",
          name: "X-CSRF-Token",
          description: "application sessionによる状態変更requestで要求するCSRF token",
        },
        liffIdToken: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "LIFF ID token",
          description: "段階移行中の旧LIFF Bearer認証。認証交換以外の新規経路では使用しない",
        },
      },
    },
  },
  exclude: ["/api/openapi.json"],
} satisfies Partial<GenerateSpecOptions>;
