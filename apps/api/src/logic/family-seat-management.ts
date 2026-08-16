import { D1 } from "@me-builder/lib";
import { createLiffSession } from "./liff-session";

const INVITATION_TTL_MS = 48 * 60 * 60 * 1000;

export type PublicFamilySeat = Readonly<{
  id: string;
  slotNumber: number;
  role: "payer" | "member";
  status: "invited" | "active" | "left" | "cancelled" | "removed" | "ended";
  createdAt: string;
  updatedAt: string;
}>;

type AuthFailure =
  | Readonly<{ type: "not-configured" }>
  | Readonly<{ type: "unauthenticated"; reason: string }>;

type Params = Readonly<{
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: D1.shared.Client;
}>;

type Dependencies = Readonly<{ createSession: typeof createLiffSession; now: () => Date }>;
const defaults: Dependencies = { createSession: createLiffSession, now: () => new Date() };

const publicSeat = (seat: {
  id: string;
  slotNumber: number;
  role: "payer" | "member";
  status: PublicFamilySeat["status"];
  createdAt: string;
  updatedAt: string;
}): PublicFamilySeat => ({
  id: seat.id,
  slotNumber: seat.slotNumber,
  role: seat.role,
  status: seat.status,
  createdAt: seat.createdAt,
  updatedAt: seat.updatedAt,
});

async function authenticate(params: Params, dependencies: Dependencies) {
  return dependencies.createSession({
    idToken: params.idToken,
    lineLoginChannelId: params.lineLoginChannelId,
    db: params.db,
  });
}

function rawToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function hashFamilyInvitationToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getFamilySeatManagement(
  params: Params,
  dependencies: Dependencies = defaults,
): Promise<
  | Readonly<{
      type: "resolved";
      role: "payer" | "member";
      maxSeats: 4;
      seats: readonly PublicFamilySeat[];
    }>
  | Readonly<{ type: "no-membership" }>
  | AuthFailure
> {
  const auth = await authenticate(params, dependencies);
  if (auth.type !== "resolved") return auth;
  const payerPack = await D1.shared.action.familySeat.readFamilyPackByPayer(
    params.db,
    auth.session.accountId,
  );
  if (payerPack) {
    return {
      type: "resolved",
      role: "payer",
      maxSeats: 4,
      seats: payerPack.seats.map(publicSeat),
    };
  }
  const membership = await D1.shared.action.familySeat.readActiveFamilySeatByMember(
    params.db,
    auth.session.accountId,
  );
  return membership
    ? { type: "resolved", role: "member", maxSeats: 4, seats: [publicSeat(membership.seat)] }
    : { type: "no-membership" };
}

export async function issueFamilySeatInvitation(
  params: Params,
  dependencies: Dependencies = defaults,
): Promise<
  | Readonly<{ type: "created"; token: string; expiresAt: string; seat: PublicFamilySeat }>
  | Readonly<{ type: "no-membership" | "capacity-reached" }>
  | AuthFailure
> {
  const auth = await authenticate(params, dependencies);
  if (auth.type !== "resolved") return auth;
  const token = rawToken();
  const tokenHash = await hashFamilyInvitationToken(token);
  const at = dependencies.now();
  const expiresAt = new Date(at.getTime() + INVITATION_TTL_MS);
  const result = await D1.shared.action.familySeat.createFamilySeatInvitation(params.db, {
    payerAccountId: auth.session.accountId,
    tokenHash,
    expiresAt,
    at,
  });
  if (result.type === "not-found") return { type: "no-membership" };
  if (result.type === "capacity-reached") return result;
  if (result.type !== "created") return { type: "no-membership" };
  return {
    type: "created",
    token,
    expiresAt: result.invitation.expiresAt,
    seat: publicSeat(result.seat),
  };
}

type InvitationActionOutcome =
  | Readonly<{ type: "updated"; seat: PublicFamilySeat }>
  | Readonly<{
      type: "not-found" | "expired" | "token-used" | "account-already-assigned" | "forbidden";
    }>
  | AuthFailure;

function invitationResult(
  result: Awaited<ReturnType<typeof D1.shared.action.familySeat.acceptFamilySeatInvitation>>,
): Exclude<InvitationActionOutcome, AuthFailure> {
  switch (result.type) {
    case "updated":
      return { type: "updated", seat: publicSeat(result.seat) };
    case "not-found":
    case "expired":
    case "token-used":
    case "account-already-assigned":
    case "forbidden":
      return result;
    case "created":
    case "capacity-reached":
      return { type: "forbidden" };
  }
}

export async function acceptFamilyInvitation(
  params: Params & Readonly<{ token: string }>,
  dependencies: Dependencies = defaults,
): Promise<InvitationActionOutcome> {
  const auth = await authenticate(params, dependencies);
  if (auth.type !== "resolved") return auth;
  const result = await D1.shared.action.familySeat.acceptFamilySeatInvitation(
    params.db,
    await hashFamilyInvitationToken(params.token),
    auth.session.accountId,
    dependencies.now(),
  );
  return invitationResult(result);
}

export async function declineFamilyInvitation(
  params: Params & Readonly<{ token: string }>,
  dependencies: Dependencies = defaults,
): Promise<InvitationActionOutcome> {
  const auth = await authenticate(params, dependencies);
  if (auth.type !== "resolved") return auth;
  const result = await D1.shared.action.familySeat.declineFamilySeatInvitation(
    params.db,
    await hashFamilyInvitationToken(params.token),
    auth.session.accountId,
    dependencies.now(),
  );
  return invitationResult(result);
}

export async function cancelFamilyInvitation(
  params: Params & Readonly<{ seatId: string }>,
  dependencies: Dependencies = defaults,
): Promise<InvitationActionOutcome> {
  const auth = await authenticate(params, dependencies);
  if (auth.type !== "resolved") return auth;
  const result = await D1.shared.action.familySeat.cancelFamilySeatInvitation(
    params.db,
    auth.session.accountId,
    params.seatId,
    dependencies.now(),
  );
  return invitationResult(result);
}

export async function removeFamilyMember(
  params: Params & Readonly<{ seatId: string }>,
  dependencies: Dependencies = defaults,
): Promise<InvitationActionOutcome> {
  const auth = await authenticate(params, dependencies);
  if (auth.type !== "resolved") return auth;
  const pack = await D1.shared.action.familySeat.readFamilyPackByPayer(
    params.db,
    auth.session.accountId,
  );
  if (!pack) return { type: "forbidden" };
  const target = pack.seats.find(({ id }) => id === params.seatId);
  if (!target || target.role !== "member" || target.status !== "active") {
    return { type: "forbidden" };
  }
  const result = await D1.shared.action.familySeat.removeFamilySeat(
    params.db,
    params.seatId,
    dependencies.now(),
  );
  return result.type === "updated"
    ? { type: "updated", seat: publicSeat(result.seat) }
    : { type: "forbidden" };
}

export async function leaveFamilyPack(
  params: Params,
  dependencies: Dependencies = defaults,
): Promise<InvitationActionOutcome> {
  const auth = await authenticate(params, dependencies);
  if (auth.type !== "resolved") return auth;
  const result = await D1.shared.action.familySeat.leaveFamilySeat(
    params.db,
    auth.session.accountId,
    dependencies.now(),
  );
  return result.type === "updated"
    ? { type: "updated", seat: publicSeat(result.seat) }
    : { type: result.type === "not-found" ? "not-found" : "forbidden" };
}
