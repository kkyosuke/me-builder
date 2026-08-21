import { D1 } from "@me-builder/lib";
import {
  getEffectiveServiceTerms,
  getServiceTermsNotice,
  serviceTermsAnnouncements,
  serviceTermsDocuments,
} from "@me-builder/shared";
import type { AuthenticatedActor } from "./authentication/types";

type Params = {
  actor: AuthenticatedActor;
  db: D1.shared.Client;
};

type Dependencies = {
  findAcceptance: typeof D1.shared.action.agreement.findCurrentTermsAcceptance;
  listAcceptanceHistory: typeof D1.shared.action.agreement.listTermsAcceptanceHistory;
  accept: typeof D1.shared.action.agreement.acceptCurrentTerms;
  now?: () => Date;
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
  const now = dependencies.now?.() ?? new Date();
  const document = getEffectiveServiceTerms(serviceTermsDocuments, now);
  const acceptance = await dependencies.findAcceptance(params.db, params.actor.accountId, now);
  return {
    type: "resolved" as const,
    document,
    notice: getServiceTermsNotice(serviceTermsDocuments, serviceTermsAnnouncements, now),
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
  const now = dependencies.now?.() ?? new Date();
  const document = getEffectiveServiceTerms(serviceTermsDocuments, now);
  if (params.version !== document.version) {
    return { type: "version-conflict" as const, currentVersion: document.version };
  }
  const acceptance = await dependencies.accept(params.db, params.actor.accountId, now, now);
  return { type: "accepted" as const, acceptance };
}

export async function getServiceTermsAcceptanceHistory(
  params: Params,
  dependencies: Dependencies = defaultDependencies,
) {
  const now = dependencies.now?.() ?? new Date();
  const [currentAcceptance, history] = await Promise.all([
    dependencies.findAcceptance(params.db, params.actor.accountId, now),
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
