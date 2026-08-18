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
        lineWebhookSignature: {
          type: "apiKey",
          in: "header",
          name: "x-line-signature",
          description: "LINEチャネルシークレットで検証するHMAC-SHA256署名",
        },
        stripeWebhookSignature: {
          type: "apiKey",
          in: "header",
          name: "stripe-signature",
          description: "Stripe Webhook endpoint secretで検証する署名",
        },
      },
    },
  },
  exclude: ["/api/openapi.json"],
} satisfies Partial<GenerateSpecOptions>;
