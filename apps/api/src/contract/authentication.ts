import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { ForbiddenErrorSchema, authenticatedErrors, jsonResponse } from "./shared/errors";

export const LiffAuthenticationExchangeRequestSchema = v.object({
  idToken: v.pipe(v.string(), v.nonEmpty(), v.maxLength(8_192)),
});

export const ApplicationSessionResponseSchema = v.object({
  authenticated: v.literal(true),
  authenticationMethod: v.picklist(["liff", "sso"]),
  authenticatedAt: v.pipe(v.string(), v.isoTimestamp()),
  expiresAt: v.pipe(v.string(), v.isoTimestamp()),
  csrfToken: v.pipe(v.string(), v.nonEmpty()),
  role: v.picklist(["user", "admin"]),
  displayProfile: v.optional(
    v.object({
      displayName: v.optional(v.string()),
      pictureUrl: v.optional(v.pipe(v.string(), v.url())),
    }),
  ),
});

export const liffAuthenticationExchangeRoute = describeRoute({
  operationId: "exchangeLiffCredential",
  tags: ["Authentication"],
  summary: "検証済みLIFF credentialをprovider非依存sessionへ交換する",
  security: [],
  requestBody: {
    required: true,
    content: { "application/json": { schema: LiffAuthenticationExchangeRequestSchema } },
  },
  responses: {
    200: jsonResponse("発行したapplication session", ApplicationSessionResponseSchema),
    403: jsonResponse("許可済みWeb Originではない", ForbiddenErrorSchema),
    ...authenticatedErrors,
  },
} satisfies DescribeRouteOptions);

export const applicationSessionRoute = describeRoute({
  operationId: "getApplicationSession",
  tags: ["Authentication"],
  summary: "現在のapplication sessionを確認する",
  security: [{ applicationSession: [] }],
  responses: {
    200: jsonResponse("現在のapplication session", ApplicationSessionResponseSchema),
    ...authenticatedErrors,
  },
} satisfies DescribeRouteOptions);

export const logoutApplicationSessionRoute = describeRoute({
  operationId: "logoutApplicationSession",
  tags: ["Authentication"],
  summary: "現在のapplication sessionを失効する",
  security: [{ applicationSession: [], csrfToken: [] }],
  parameters: [
    {
      name: "X-CSRF-Token",
      in: "header",
      required: true,
      schema: { type: "string", minLength: 1 },
    },
  ],
  responses: {
    204: { description: "sessionを失効した" },
    403: jsonResponse("OriginまたはCSRF tokenが一致しない", ForbiddenErrorSchema),
    ...authenticatedErrors,
  },
} satisfies DescribeRouteOptions);
