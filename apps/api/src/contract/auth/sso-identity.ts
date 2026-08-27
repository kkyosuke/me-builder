import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import {
  ServiceUnavailableErrorSchema,
  UnauthorizedErrorSchema,
  csrfValidationError,
  internalServerError,
  jsonResponse,
} from "../shared/errors";

export const SsoIdentityStatusSchema = v.object({
  linked: v.boolean(),
  canUnlink: v.boolean(),
});

export const SsoLinkAuthorizationUrlSchema = v.variant("flow", [
  v.object({
    flow: v.literal("liff-handoff"),
    authorizationUrl: v.pipe(v.string(), v.url()),
    attemptId: v.pipe(v.string(), v.nonEmpty()),
    confirmationSecret: v.pipe(v.string(), v.nonEmpty()),
  }),
  v.object({
    flow: v.literal("same-browser"),
    authorizationUrl: v.pipe(v.string(), v.url()),
  }),
]);

export const SsoAuthorizationUrlSchema = v.object({
  flow: v.literal("same-browser"),
  authorizationUrl: v.pipe(v.string(), v.url()),
});

export const SsoLinkAttemptStatusSchema = v.object({
  status: v.picklist(["waiting", "ready", "cancelled", "failed", "expired"]),
});

export const LastIdentityConflictSchema = v.object({
  error: v.literal("Last login identity cannot be unlinked"),
});
export const SsoLinkAttemptConflictSchema = v.object({
  error: v.literal("SSO link attempt cannot be confirmed"),
});

const applicationSessionSecurity = [{ applicationSession: [] }];
const applicationSessionMutationSecurity = [{ applicationSession: [], csrfToken: [] }];
const returnToParameter = {
  name: "returnTo",
  in: "query",
  required: false,
  schema: { type: "string", maxLength: 2048 },
  description: "認証後に復元する同一originの相対path",
} as const;
const attemptIdParameter = {
  name: "attemptId",
  in: "path",
  required: true,
  schema: { type: "string", minLength: 1 },
} as const;
const confirmationSecretParameter = {
  name: "X-SSO-Link-Confirmation",
  in: "header",
  required: true,
  schema: { type: "string", minLength: 1 },
  description: "link開始時に元のLIFFへだけ返した確認secret",
} as const;
const commonErrors = {
  401: jsonResponse("application sessionが無効", UnauthorizedErrorSchema),
  503: jsonResponse("SSOまたはstorage bindingが未設定", ServiceUnavailableErrorSchema),
  ...internalServerError,
};

export const getSsoIdentityStatusRoute = describeRoute({
  operationId: "getSsoIdentityStatus",
  tags: ["Authentication"],
  summary: "本人のSSO Identity接続状態を取得する",
  security: applicationSessionSecurity,
  responses: {
    200: jsonResponse("subjectを含まないSSO接続状態", SsoIdentityStatusSchema),
    ...commonErrors,
  },
} satisfies DescribeRouteOptions);

export const startSsoIdentityLinkRoute = describeRoute({
  operationId: "startSsoIdentityLink",
  tags: ["Authentication"],
  summary: "認証済みAccountへのSSO Identity追加を開始する",
  security: applicationSessionMutationSecurity,
  parameters: [
    returnToParameter,
    {
      name: "handoff",
      in: "query",
      required: false,
      schema: { type: "string", enum: ["liff"] },
    },
  ],
  responses: {
    200: jsonResponse(
      "Google認可URLと、LIFF handoff時だけ返す確認情報",
      SsoLinkAuthorizationUrlSchema,
    ),
    ...csrfValidationError,
    ...commonErrors,
  },
} satisfies DescribeRouteOptions);

export const getSsoLinkAttemptRoute = describeRoute({
  operationId: "getSsoLinkAttempt",
  tags: ["Authentication"],
  summary: "元のLIFFからGoogle認証の完了状態を確認する",
  security: applicationSessionSecurity,
  parameters: [attemptIdParameter, confirmationSecretParameter],
  responses: {
    200: jsonResponse("Identityを含まないlink attempt状態", SsoLinkAttemptStatusSchema),
    ...commonErrors,
  },
} satisfies DescribeRouteOptions);

export const confirmSsoLinkAttemptRoute = describeRoute({
  operationId: "confirmSsoLinkAttempt",
  tags: ["Authentication"],
  summary: "元のLIFF AccountでGoogle Identity追加を確定する",
  security: applicationSessionMutationSecurity,
  parameters: [attemptIdParameter, confirmationSecretParameter],
  responses: {
    200: jsonResponse("確定後の接続状態", SsoIdentityStatusSchema),
    409: jsonResponse("attemptが確定可能でない", SsoLinkAttemptConflictSchema),
    ...csrfValidationError,
    ...commonErrors,
  },
} satisfies DescribeRouteOptions);

export const startSsoLoginRoute = describeRoute({
  operationId: "startSsoLogin",
  tags: ["Authentication"],
  summary: "外部ブラウザのSSOログインを開始する",
  security: [],
  parameters: [returnToParameter],
  responses: {
    200: jsonResponse("同じbrowserで開くGoogle認可URL", SsoAuthorizationUrlSchema),
    503: jsonResponse("SSOまたはstorage bindingが未設定", ServiceUnavailableErrorSchema),
    ...internalServerError,
  },
} satisfies DescribeRouteOptions);

export const completeSsoCallbackRoute = describeRoute({
  operationId: "completeSsoCallback",
  tags: ["Authentication"],
  summary: "SSO callbackを一度だけ処理する",
  security: [],
  responses: {
    200: {
      description: "LIFF handoff完了案内",
      content: { "text/html": { schema: { type: "string" } } },
    },
    302: { description: "保存済みの同一origin相対pathへredirect" },
    503: jsonResponse("SSOまたはstorage bindingが未設定", ServiceUnavailableErrorSchema),
    ...internalServerError,
  },
} satisfies DescribeRouteOptions);

export const unlinkSsoIdentityRoute = describeRoute({
  operationId: "unlinkSsoIdentity",
  tags: ["Authentication"],
  summary: "本人のSSO Identityを解除する",
  security: applicationSessionMutationSecurity,
  responses: {
    204: { description: "解除済み" },
    409: jsonResponse("最後のログイン方法なので解除不可", LastIdentityConflictSchema),
    ...csrfValidationError,
    ...commonErrors,
  },
} satisfies DescribeRouteOptions);
