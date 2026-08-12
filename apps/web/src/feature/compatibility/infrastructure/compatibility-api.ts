import { compatibilityRelationshipId } from "@me-builder/lib/compatibility";
import * as v from "valibot";
import type { operations } from "../../../generated/api";
import { createHttpClient } from "../../../infrastructure/http-client";
import type { CompatibilityInvitation } from "../model/compatibility-invitation";
import type { CompatibilityInvitationPreview } from "../model/compatibility-invitation-preview";
import type {
  CompatibilityInvitationAcceptance,
  CompatibilityRelationship,
  CompatibilityRelationshipList,
} from "../model/compatibility-relationship";
import type { CompatibilityShareConsent } from "../model/compatibility-share-consent";

type ApiResponse =
  operations["getCompatibilityShareConsent"]["responses"][200]["content"]["application/json"];
type InvitationApiResponse =
  operations["issueCompatibilityInvitation"]["responses"][201]["content"]["application/json"];
type InvitationPreviewApiResponse =
  operations["getCompatibilityInvitation"]["responses"][200]["content"]["application/json"];

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());
const ParameterSchema = v.object({
  id: NonEmptyStringSchema,
  label: NonEmptyStringSchema,
  lowLabel: NonEmptyStringSchema,
  highLabel: NonEmptyStringSchema,
  position: v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(100)),
  statement: NonEmptyStringSchema,
});
const ShareProfileSchema = v.object({
  profileSummaryVersionId: NonEmptyStringSchema,
  generatedAt: v.pipe(v.string(), v.isoTimestamp()),
  statements: v.pipe(
    v.array(
      v.object({
        key: NonEmptyStringSchema,
        label: NonEmptyStringSchema,
        statement: NonEmptyStringSchema,
      }),
    ),
    v.minLength(1),
    v.maxLength(3),
  ),
});
const ShareThemeSchema = v.object({
  diagnosisId: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  parameters: v.pipe(v.array(ParameterSchema), v.minLength(1)),
});
const ResponseSchema = v.object({
  displayName: v.nullable(NonEmptyStringSchema),
  avatarUrl: v.nullable(NonEmptyStringSchema),
  canShare: v.boolean(),
  blockingReasons: v.array(v.picklist(["display_name_unavailable"])),
  nextAction: v.nullable(v.picklist(["diagnosis", "profile-summary"])),
}) satisfies v.GenericSchema<ApiResponse>;

const InvitationResponseSchema = v.object({
  invitationUrl: v.pipe(v.string(), v.url()),
  expiresAt: v.pipe(v.string(), v.isoTimestamp()),
}) satisfies v.GenericSchema<InvitationApiResponse>;

const InvitationPreviewResponseSchema = v.object({
  inviter: v.object({
    displayName: NonEmptyStringSchema,
    avatarUrl: v.nullable(NonEmptyStringSchema),
  }),
  recipient: v.object({
    displayName: v.nullable(NonEmptyStringSchema),
    avatarUrl: v.nullable(NonEmptyStringSchema),
  }),
  expiresAt: v.pipe(v.string(), v.isoTimestamp()),
  canAccept: v.boolean(),
  blockingReasons: v.array(v.picklist(["display_name_unavailable"])),
  nextAction: v.nullable(v.picklist(["diagnosis", "profile-summary"])),
}) satisfies v.GenericSchema<InvitationPreviewApiResponse>;

const RelationshipIdSchema = compatibilityRelationshipId.schema;
const RelationshipListResponseSchema = v.object({
  items: v.array(
    v.variant("status", [
      v.object({
        relationshipId: RelationshipIdSchema,
        status: v.literal("pending"),
        expiresAt: v.pipe(v.string(), v.isoTimestamp()),
        invitationUrl: v.pipe(v.string(), v.url()),
      }),
      v.object({
        relationshipId: RelationshipIdSchema,
        status: v.literal("accepted"),
        partnerDisplayName: NonEmptyStringSchema,
      }),
    ]),
  ),
}) satisfies v.GenericSchema<CompatibilityRelationshipList>;

const RelationshipPersonSchema = v.object({
  displayName: NonEmptyStringSchema,
  aboutMe: ShareProfileSchema,
  themes: v.pipe(v.array(ShareThemeSchema), v.minLength(1)),
});
const RelationshipResponseSchema = v.variant("status", [
  v.object({
    relationshipId: RelationshipIdSchema,
    status: v.literal("ready"),
    partner: RelationshipPersonSchema,
    viewer: RelationshipPersonSchema,
  }),
  v.object({
    relationshipId: RelationshipIdSchema,
    status: v.literal("waiting"),
    nextAction: v.nullable(v.picklist(["diagnosis", "profile-summary"])),
  }),
]) satisfies v.GenericSchema<CompatibilityRelationship>;

const InvitationAcceptanceResponseSchema = v.object({
  relationshipId: RelationshipIdSchema,
  status: v.literal("accepted"),
}) satisfies v.GenericSchema<CompatibilityInvitationAcceptance>;

const FRIENDSHIP_REQUIRED_MESSAGE =
  "利用するには、先にLINE公式アカウントを友だち追加してください。";

function authenticatedError(response: Response): Error | null {
  if (response.status === 401) {
    return new Error("本人確認に失敗しました。LINEから開き直してください。");
  }
  return null;
}

/**
 * 相性APIは友だち未追加と対象が利用できない状態を同じ`404`で返す。
 *
 * `reason`を見て取り違えないようにし、どちらの場合もHTTP状態コードを見せない。
 */
async function notFoundError(response: Response, unavailableMessage: string): Promise<Error> {
  const body = await response.json().catch(() => null);
  if (
    body &&
    typeof body === "object" &&
    "reason" in body &&
    body.reason === "friendship_required"
  ) {
    return new Error(FRIENDSHIP_REQUIRED_MESSAGE);
  }
  return new Error(unavailableMessage);
}

export async function fetchCompatibilityShareConsent(
  apiUrl: string | undefined,
  idToken: string,
  signal?: AbortSignal,
): Promise<CompatibilityShareConsent> {
  const response = await createHttpClient(apiUrl).request("/api/compatibility/share-consent", {
    headers: { Authorization: `Bearer ${idToken}` },
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("本人確認に失敗しました。LINEから開き直してください。");
    }
    if (response.status === 404) {
      throw new Error("利用するには、先にLINE公式アカウントを友だち追加してください。");
    }
    throw new Error(`共有の確認に失敗しました (HTTP ${response.status})`);
  }

  return v.parse(ResponseSchema, await response.json());
}

export async function issueCompatibilityInvitation(
  apiUrl: string | undefined,
  idToken: string,
  signal?: AbortSignal,
): Promise<CompatibilityInvitation> {
  const response = await createHttpClient(apiUrl).request("/api/compatibility/invitations", {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}` },
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("本人確認に失敗しました。LINEから開き直してください。");
    }
    if (response.status === 404) {
      throw new Error("利用するには、先にLINE公式アカウントを友だち追加してください。");
    }
    if (response.status === 409) {
      throw new Error("いまは共有を始められません。時間をおいて再度お試しください。");
    }
    throw new Error(`招待リンクの発行に失敗しました (HTTP ${response.status})`);
  }

  return v.parse(InvitationResponseSchema, await response.json());
}

export async function fetchCompatibilityInvitation(
  apiUrl: string | undefined,
  idToken: string,
  relationshipId: string,
  signal?: AbortSignal,
): Promise<CompatibilityInvitationPreview> {
  const response = await createHttpClient(apiUrl).request(
    `/api/compatibility/invitations/${encodeURIComponent(relationshipId)}`,
    {
      headers: { Authorization: `Bearer ${idToken}` },
      ...(signal ? { signal } : {}),
    },
  );

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("本人確認に失敗しました。LINEから開き直してください。");
    }
    if (response.status === 404) {
      throw await notFoundError(
        response,
        "この招待は利用できません。期限切れまたは使用済みの可能性があります。",
      );
    }
    if (response.status === 409) {
      throw new Error("自分が発行した招待は承諾できません。相性一覧から確認してください。");
    }
    throw new Error(`招待内容の取得に失敗しました (HTTP ${response.status})`);
  }

  return v.parse(InvitationPreviewResponseSchema, await response.json());
}

export async function fetchCompatibilityRelationships(
  apiUrl: string | undefined,
  idToken: string,
  signal?: AbortSignal,
): Promise<CompatibilityRelationshipList> {
  const response = await createHttpClient(apiUrl).request("/api/compatibility/relationships", {
    headers: { Authorization: `Bearer ${idToken}` },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("利用するには、先にLINE公式アカウントを友だち追加してください。");
    }
    throw (
      authenticatedError(response) ??
      new Error(`相性一覧の取得に失敗しました (HTTP ${response.status})`)
    );
  }
  return v.parse(RelationshipListResponseSchema, await response.json());
}

export async function acceptCompatibilityInvitation(
  apiUrl: string | undefined,
  idToken: string,
  relationshipId: string,
  signal?: AbortSignal,
): Promise<CompatibilityInvitationAcceptance> {
  const response = await createHttpClient(apiUrl).request(
    `/api/compatibility/invitations/${encodeURIComponent(relationshipId)}/accept`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}` },
      ...(signal ? { signal } : {}),
    },
  );
  if (!response.ok) {
    const authenticationError = authenticatedError(response);
    if (authenticationError) throw authenticationError;
    if (response.status === 404) {
      throw await notFoundError(
        response,
        "この招待は利用できません。期限切れまたは取り消された可能性があります。",
      );
    }
    if (response.status === 409) {
      throw new Error("この招待は承諾できません。相性一覧から確認してください。");
    }
    throw new Error(`招待の承諾に失敗しました (HTTP ${response.status})`);
  }
  return v.parse(InvitationAcceptanceResponseSchema, await response.json());
}

export async function fetchCompatibilityRelationship(
  apiUrl: string | undefined,
  idToken: string,
  relationshipId: string,
  signal?: AbortSignal,
): Promise<CompatibilityRelationship> {
  const response = await createHttpClient(apiUrl).request(
    `/api/compatibility/relationships/${encodeURIComponent(relationshipId)}`,
    {
      headers: { Authorization: `Bearer ${idToken}` },
      ...(signal ? { signal } : {}),
    },
  );
  if (!response.ok) {
    const authenticationError = authenticatedError(response);
    if (authenticationError) throw authenticationError;
    if (response.status === 404) {
      throw await notFoundError(
        response,
        "この相性シートは利用できません。共有が終了した可能性があります。",
      );
    }
    throw new Error(`相性シートの取得に失敗しました (HTTP ${response.status})`);
  }
  return v.parse(RelationshipResponseSchema, await response.json());
}

async function deleteCompatibilityResource(
  apiUrl: string | undefined,
  idToken: string,
  path: string,
  messages: Readonly<{ failure: string; gone: string }>,
  signal?: AbortSignal,
): Promise<void> {
  const response = await createHttpClient(apiUrl).request(path, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${idToken}` },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    const authenticationError = authenticatedError(response);
    if (authenticationError) throw authenticationError;
    if (response.status === 404) throw await notFoundError(response, messages.gone);
    throw new Error(`${messages.failure} (HTTP ${response.status})`);
  }
}

export function cancelCompatibilityInvitation(
  apiUrl: string | undefined,
  idToken: string,
  relationshipId: string,
  signal?: AbortSignal,
): Promise<void> {
  return deleteCompatibilityResource(
    apiUrl,
    idToken,
    `/api/compatibility/invitations/${encodeURIComponent(relationshipId)}`,
    {
      failure: "招待の取り消しに失敗しました",
      gone: "この招待はすでに取り消されたか、期限切れです。一覧を再読み込みしてください。",
    },
    signal,
  );
}

export function endCompatibilityRelationship(
  apiUrl: string | undefined,
  idToken: string,
  relationshipId: string,
  signal?: AbortSignal,
): Promise<void> {
  return deleteCompatibilityResource(
    apiUrl,
    idToken,
    `/api/compatibility/relationships/${encodeURIComponent(relationshipId)}`,
    {
      failure: "共有の終了に失敗しました",
      gone: "この共有はすでに終了しています。一覧を再読み込みしてください。",
    },
    signal,
  );
}
