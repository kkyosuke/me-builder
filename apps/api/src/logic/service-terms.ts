import { D1 } from "@me-builder/lib";
import { currentServiceTerms } from "@me-builder/shared";
import { resolveLiffSession } from "./liff-session";

type Params = {
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: D1.shared.Client;
};

type Dependencies = {
  createSession: typeof resolveLiffSession;
  findAcceptance: typeof D1.shared.action.agreement.findCurrentTermsAcceptance;
  accept: typeof D1.shared.action.agreement.acceptCurrentTerms;
};

const defaultDependencies: Dependencies = {
  createSession: resolveLiffSession,
  findAcceptance: D1.shared.action.agreement.findCurrentTermsAcceptance,
  accept: D1.shared.action.agreement.acceptCurrentTerms,
};

export async function getServiceTermsStatus(
  params: Params,
  dependencies: Dependencies = defaultDependencies,
) {
  const session = await dependencies.createSession(params);
  if (session.type !== "resolved") return session;
  const acceptance = await dependencies.findAcceptance(params.db, session.session.accountId);
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
  const session = await dependencies.createSession(params);
  if (session.type !== "resolved") return session;
  if (params.version !== currentServiceTerms.version) {
    return { type: "version-conflict" as const, currentVersion: currentServiceTerms.version };
  }
  const acceptance = await dependencies.accept(params.db, session.session.accountId);
  return { type: "accepted" as const, acceptance };
}
