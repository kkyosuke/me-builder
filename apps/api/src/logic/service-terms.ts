import { D1 } from "@me-builder/lib";
import { currentServiceTerms } from "@me-builder/shared";
import type { AuthenticatedActor } from "./authentication/types";

type Params = {
  actor: AuthenticatedActor;
  db: D1.shared.Client;
};

type Dependencies = {
  findAcceptance: typeof D1.shared.action.agreement.findCurrentTermsAcceptance;
  listAcceptanceHistory: typeof D1.shared.action.agreement.listTermsAcceptanceHistory;
  accept: typeof D1.shared.action.agreement.acceptCurrentTerms;
};

const defaultDependencies: Dependencies = {
  findAcceptance: D1.shared.action.agreement.findCurrentTermsAcceptance,
  listAcceptanceHistory: D1.shared.action.agreement.listTermsAcceptanceHistory,
  accept: D1.shared.action.agreement.acceptCurrentTerms,
};

export async function getServiceTermsStatus(
  params: Params,
  dependencies: Dependencies = defaultDependencies,
) {
  const acceptance = await dependencies.findAcceptance(params.db, params.actor.accountId);
  return {
    type: "resolved" as const,
    document: currentServiceTerms,
    acceptance: {
      required: !acceptance,
      acceptedVersion: acceptance?.documentVersion ?? null,
      documentHash: acceptance?.documentHash ?? null,
      acceptedAt: acceptance?.acceptedAt ?? null,
    },
  };
}

export async function acceptServiceTerms(
  params: Params & { version: string },
  dependencies: Dependencies = defaultDependencies,
) {
  if (params.version !== currentServiceTerms.version) {
    return { type: "version-conflict" as const, currentVersion: currentServiceTerms.version };
  }
  const acceptance = await dependencies.accept(params.db, params.actor.accountId);
  return { type: "accepted" as const, acceptance };
}

export async function getServiceTermsAcceptanceHistory(
  params: Params,
  dependencies: Dependencies = defaultDependencies,
) {
  const [currentAcceptance, history] = await Promise.all([
    dependencies.findAcceptance(params.db, params.actor.accountId),
    dependencies.listAcceptanceHistory(params.db, params.actor.accountId),
  ]);
  return {
    type: "resolved" as const,
    acceptances: history.map((acceptance) => ({
      documentKey: acceptance.documentKey,
      version: acceptance.documentVersion,
      documentHash: acceptance.documentHash,
      acceptedAt: acceptance.acceptedAt,
      status: currentAcceptance?.id === acceptance.id ? ("current" as const) : ("past" as const),
    })),
  };
}
