import * as v from "valibot";
import type { operations } from "../../../generated/api";
import { createAuthenticatedHttpClient } from "../../../infrastructure/http-client";
import type { FamilyInvitation, FamilySeat, FamilySeatManagement } from "../model/family-seat";

type ManagementResponse =
  operations["getFamilySeatManagement"]["responses"][200]["content"]["application/json"];
type InvitationResponse =
  operations["issueFamilyInvitation"]["responses"][201]["content"]["application/json"];
type MutationResponse =
  operations["acceptFamilyInvitation"]["responses"][200]["content"]["application/json"];

const SeatSchema = v.object({
  id: v.string(),
  slotNumber: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(4)),
  role: v.picklist(["payer", "member"]),
  status: v.picklist(["invited", "active", "left", "cancelled", "removed", "ended"]),
  displayName: v.nullable(v.pipe(v.string(), v.nonEmpty())),
}) satisfies v.GenericSchema<FamilySeat>;
const ManagementSchema = v.object({
  role: v.picklist(["payer", "member"]),
  maxSeats: v.literal(4),
  seats: v.array(SeatSchema),
}) satisfies v.GenericSchema<ManagementResponse>;
const InvitationSchema = v.object({
  token: v.string(),
  expiresAt: v.pipe(v.string(), v.isoTimestamp()),
  seat: SeatSchema,
}) satisfies v.GenericSchema<InvitationResponse>;
const MutationSchema = v.object({ seat: SeatSchema }) satisfies v.GenericSchema<MutationResponse>;

async function familyError(response: Response, fallback: string): Promise<Error> {
  if (response.status === 401)
    return new Error("本人確認の有効期限が切れました。もう一度お試しください。");
  if (response.status === 403) return new Error("この操作を行う権限がありません。");
  const body = (await response.json().catch(() => null)) as { reason?: string } | null;
  const message = body?.reason
    ? {
        no_membership: "現在参加しているファミリーパックはありません。",
        capacity_reached: "4 Accountすべての席が使用中です。",
        invitation_unavailable: "この招待は利用できません。",
        invitation_expired: "この招待の有効期限は切れています。",
        token_used: "この招待はすでに使用されています。",
        account_already_assigned: "このAccountは別のファミリーパックに参加中です。",
      }[body.reason]
    : undefined;
  return new Error(message ?? `${fallback} (HTTP ${response.status})`);
}

export async function fetchFamilySeats(
  apiUrl: string | undefined,
  signal?: AbortSignal,
): Promise<FamilySeatManagement> {
  const response = await createAuthenticatedHttpClient(apiUrl).request("/api/family/seats", {
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw await familyError(response, "席状態を取得できませんでした");
  return v.parse(ManagementSchema, await response.json());
}

export async function issueFamilyInvitation(
  apiUrl: string | undefined,
  signal?: AbortSignal,
): Promise<FamilyInvitation> {
  const response = await createAuthenticatedHttpClient(apiUrl).request("/api/family/invitations", {
    method: "POST",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw await familyError(response, "招待を発行できませんでした");
  return v.parse(InvitationSchema, await response.json());
}

async function tokenMutation(
  apiUrl: string | undefined,
  action: "accept" | "decline",
  token: string,
): Promise<FamilySeat> {
  const response = await createAuthenticatedHttpClient(apiUrl).request(
    `/api/family/invitations/${action}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    },
  );
  if (!response.ok) throw await familyError(response, "招待を更新できませんでした");
  return v.parse(MutationSchema, await response.json()).seat;
}

export const acceptFamilyInvitation = (apiUrl: string | undefined, token: string) =>
  tokenMutation(apiUrl, "accept", token);

export const declineFamilyInvitation = (apiUrl: string | undefined, token: string) =>
  tokenMutation(apiUrl, "decline", token);

async function deleteSeat(apiUrl: string | undefined, path: string): Promise<FamilySeat> {
  const response = await createAuthenticatedHttpClient(apiUrl).request(path, {
    method: "DELETE",
  });
  if (!response.ok) throw await familyError(response, "席を更新できませんでした");
  return v.parse(MutationSchema, await response.json()).seat;
}

export const cancelFamilyInvitation = (apiUrl: string | undefined, seatId: string) =>
  deleteSeat(apiUrl, `/api/family/invitations/${encodeURIComponent(seatId)}`);

export const removeFamilyMember = (apiUrl: string | undefined, seatId: string) =>
  deleteSeat(apiUrl, `/api/family/seats/${encodeURIComponent(seatId)}`);

export const leaveFamilyPack = (apiUrl: string | undefined) =>
  deleteSeat(apiUrl, "/api/family/membership");
