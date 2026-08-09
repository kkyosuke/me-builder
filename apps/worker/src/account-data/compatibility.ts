import type { CompatibilityReferenceRole } from "@me-builder/lib";
import type { AccountDataRepository } from "./repository";

/** Account別の相性一覧参照を扱う。相性関係の正本はCompatibilityDataに置く。 */
export const compatibilityActions = {
  "compatibility.addOutgoingReference": (
    repository: AccountDataRepository,
    accountId: string,
    input: Readonly<{ relationshipId: string; createdAt: Date }>,
  ) => repository.addOutgoingCompatibilityReference(accountId, input),
  "compatibility.reserveIncomingReference": (
    repository: AccountDataRepository,
    accountId: string,
    input: Readonly<{ relationshipId: string; partnerAccountId: string; createdAt: Date }>,
  ) => repository.reserveIncomingCompatibilityReference(accountId, input),
  "compatibility.reserveOutgoingReference": (
    repository: AccountDataRepository,
    accountId: string,
    input: Readonly<{ relationshipId: string; partnerAccountId: string; updatedAt: Date }>,
  ) => repository.reserveOutgoingCompatibilityReference(accountId, input),
  "compatibility.releaseReservation": (
    repository: AccountDataRepository,
    accountId: string,
    relationshipId: string,
    releasedAt: Date,
  ) => repository.releaseCompatibilityReservation(accountId, relationshipId, releasedAt),
  "compatibility.activateReference": (
    repository: AccountDataRepository,
    accountId: string,
    input: Readonly<{
      relationshipId: string;
      partnerAccountId: string;
      role: CompatibilityReferenceRole;
      updatedAt: Date;
    }>,
  ) => repository.activateCompatibilityReference(accountId, input),
  "compatibility.endReference": (
    repository: AccountDataRepository,
    accountId: string,
    relationshipId: string,
    endedAt: Date,
  ) => repository.endCompatibilityReference(accountId, relationshipId, endedAt),
} as const;
