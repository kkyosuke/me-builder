import {
  type AccountDataNamespace,
  type D1,
  type DO,
  type ProfileSummaryReadModel,
  accountDataFor,
} from "@me-builder/lib";
import { createLiffSession } from "./liff-session";

export type ProfileSummaryOutcome =
  | (ProfileSummaryReadModel & { type: "resolved"; nextAction: "diagnosis" | "chat" })
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type Params = {
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: D1.shared.Client;
  accountData?: AccountDataNamespace;
  at?: Date;
  allowUnchangedRegeneration?: boolean;
};

type Dependencies = {
  createSession: typeof createLiffSession;
  listVisibleDiagnoses: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
    at: Date,
  ) => ReturnType<typeof DO.account.action.diagnosis.listVisibleDiagnoses>;
  readProfileSummary: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
    at: Date,
    allowUnchangedRegeneration: boolean,
  ) => Promise<ProfileSummaryReadModel>;
};

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  listVisibleDiagnoses: (accountData, accountId, at) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute("diagnosis.listVisible", at);
  },
  readProfileSummary: (accountData, accountId, at, allowUnchangedRegeneration) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute(
      "profileSummary.read",
      at,
      allowUnchangedRegeneration,
    );
  },
};

/** 本人のまとめを返し、実際の診断進捗だけから次の行動を決める。 */
export async function getProfileSummary(
  {
    idToken,
    lineLoginChannelId,
    db,
    accountData,
    at = new Date(),
    allowUnchangedRegeneration = false,
  }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<ProfileSummaryOutcome> {
  const session = await dependencies.createSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") return session;

  const [diagnoses, readModel] = await Promise.all([
    dependencies.listVisibleDiagnoses(accountData, session.session.accountId, at),
    dependencies.readProfileSummary(
      accountData,
      session.session.accountId,
      at,
      allowUnchangedRegeneration,
    ),
  ]);
  const hasAnswerableDiagnosis = diagnoses.some(
    ({ availability, responseStatus }) => availability === "open" && responseStatus !== "answered",
  );

  return {
    type: "resolved",
    ...readModel,
    nextAction: hasAnswerableDiagnosis ? "diagnosis" : "chat",
  };
}
