import { D1 } from "@me-builder/lib";
import type { Context } from "hono";
import * as v from "valibot";
import {
  FamilyInvitationResponseSchema,
  FamilyOperationUnavailableSchema,
  FamilySeatManagementResponseSchema,
  FamilySeatMutationResponseSchema,
} from "../contract/family/seats";
import { ForbiddenErrorSchema, ServiceUnavailableErrorSchema } from "../contract/shared/errors";
import {
  acceptFamilyInvitation,
  cancelFamilyInvitation,
  declineFamilyInvitation,
  getFamilySeatManagement,
  issueFamilySeatInvitation,
  leaveFamilyPack,
  removeFamilyMember,
} from "../logic/family-seat-management";
import { authenticatedActor } from "../middleware/authentication";
import type { AppEnv } from "../types";

function params(c: Context<AppEnv>) {
  const database = c.env.DB;
  if (!database) throw new Error("Family storage binding is not configured");
  return {
    actor: authenticatedActor(c),
    db: D1.shared.client.create(database),
  };
}

function unavailable(
  c: Context<AppEnv>,
  reason: v.InferOutput<typeof FamilyOperationUnavailableSchema>["reason"],
) {
  return c.json(
    v.parse(FamilyOperationUnavailableSchema, { error: "Family operation unavailable", reason }),
    409,
  );
}

function missingDb(c: Context<AppEnv>) {
  return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
}

type MutationOutcome = Awaited<ReturnType<typeof acceptFamilyInvitation>>;
function mutationResponse(c: Context<AppEnv>, outcome: MutationOutcome): Response {
  switch (outcome.type) {
    case "updated":
      return c.json(v.parse(FamilySeatMutationResponseSchema, { seat: outcome.seat }));
    case "forbidden":
      return c.json(v.parse(ForbiddenErrorSchema, { error: "Forbidden" }), 403);
    case "not-found":
      return unavailable(c, "invitation_unavailable");
    case "expired":
      return unavailable(c, "invitation_expired");
    case "token-used":
      return unavailable(c, "token_used");
    case "account-already-assigned":
      return unavailable(c, "account_already_assigned");
  }
}

export async function getFamilySeats(c: Context<AppEnv>): Promise<Response> {
  c.header("Cache-Control", "no-store");
  if (!c.env?.DB) return missingDb(c);
  const outcome = await getFamilySeatManagement(params(c));
  if (outcome.type === "resolved") {
    return c.json(
      v.parse(FamilySeatManagementResponseSchema, {
        role: outcome.role,
        maxSeats: outcome.maxSeats,
        seats: outcome.seats,
      }),
    );
  }
  return unavailable(c, "no_membership");
}

export async function postFamilyInvitation(c: Context<AppEnv>): Promise<Response> {
  c.header("Cache-Control", "no-store");
  if (!c.env?.DB) return missingDb(c);
  const outcome = await issueFamilySeatInvitation(params(c));
  if (outcome.type === "created") {
    return c.json(v.parse(FamilyInvitationResponseSchema, outcome), 201);
  }
  if (outcome.type === "capacity-reached") return unavailable(c, "capacity_reached");
  return unavailable(c, "no_membership");
}

async function token(c: Context<AppEnv>): Promise<string> {
  return ((await c.req.json()) as { token: string }).token;
}

export async function postFamilyInvitationAcceptance(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB) return missingDb(c);
  return mutationResponse(c, await acceptFamilyInvitation({ ...params(c), token: await token(c) }));
}

export async function postFamilyInvitationDecline(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB) return missingDb(c);
  return mutationResponse(
    c,
    await declineFamilyInvitation({ ...params(c), token: await token(c) }),
  );
}

export async function deleteFamilyInvitation(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB) return missingDb(c);
  return mutationResponse(
    c,
    await cancelFamilyInvitation({ ...params(c), seatId: c.req.param("seatId") ?? "" }),
  );
}

export async function deleteFamilyMember(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB) return missingDb(c);
  return mutationResponse(
    c,
    await removeFamilyMember({ ...params(c), seatId: c.req.param("seatId") ?? "" }),
  );
}

export async function deleteOwnFamilyMembership(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB) return missingDb(c);
  return mutationResponse(c, await leaveFamilyPack(params(c)));
}
