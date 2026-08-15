import {
  type AccountDataNamespace,
  type D1,
  type UtsushiProgression,
  accountDataFor,
} from "@me-builder/lib";
import { createLiffSession } from "./liff-session";

export type ProfileProgressionOutcome =
  | ({ type: "resolved" } & UtsushiProgression)
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type Params = Readonly<{
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: D1.shared.Client;
  accountData?: AccountDataNamespace;
  at?: Date;
}>;

type Dependencies = Readonly<{
  createSession: typeof createLiffSession;
  readProgression: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
    at: Date,
  ) => Promise<UtsushiProgression>;
}>;

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  readProgression: (accountData, accountId, at) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute("progression.read", at);
  },
};

export async function getProfileProgression(
  { idToken, lineLoginChannelId, db, accountData, at = new Date() }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<ProfileProgressionOutcome> {
  const session = await dependencies.createSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") return session;
  return {
    type: "resolved",
    ...(await dependencies.readProgression(accountData, session.session.accountId, at)),
  };
}
