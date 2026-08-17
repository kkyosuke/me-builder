import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import {
  ServiceUnavailableErrorSchema,
  UnauthorizedErrorSchema,
  jsonResponse,
} from "../shared/errors";

export const SsoIdentityStatusSchema = v.object({
  linked: v.boolean(),
  canUnlink: v.boolean(),
});

export const SsoAuthorizationUrlSchema = v.object({
  authorizationUrl: v.pipe(v.string(), v.url()),
});

export const LastIdentityConflictSchema = v.object({
  error: v.literal("Last login identity cannot be unlinked"),
});

const applicationSessionSecurity = [{ applicationSession: [] }];
const returnToParameter = {
  name: "returnTo",
  in: "query",
  required: false,
  schema: { type: "string", maxLength: 2048 },
  description: "認証後に復元する同一originの相対path",
} as const;
const commonErrors = {
  401: jsonResponse("application sessionが無効", UnauthorizedErrorSchema),
  503: jsonResponse("SSOまたはstorage bindingが未設定", ServiceUnavailableErrorSchema),
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
  security: applicationSessionSecurity,
  parameters: [returnToParameter],
  responses: {
    200: jsonResponse("同じbrowserで開くAuth0認可URL", SsoAuthorizationUrlSchema),
    ...commonErrors,
  },
} satisfies DescribeRouteOptions);

export const completeSsoCallbackRoute = describeRoute({
  operationId: "completeSsoCallback",
  tags: ["Authentication"],
  summary: "SSO callbackを一度だけ処理する",
  responses: {
    302: { description: "保存済みの同一origin相対pathへredirect" },
    503: jsonResponse("SSOまたはstorage bindingが未設定", ServiceUnavailableErrorSchema),
  },
} satisfies DescribeRouteOptions);

export const unlinkSsoIdentityRoute = describeRoute({
  operationId: "unlinkSsoIdentity",
  tags: ["Authentication"],
  summary: "本人のSSO Identityを解除する",
  security: applicationSessionSecurity,
  responses: {
    204: { description: "解除済み" },
    409: jsonResponse("最後のログイン方法なので解除不可", LastIdentityConflictSchema),
    ...commonErrors,
  },
} satisfies DescribeRouteOptions);
