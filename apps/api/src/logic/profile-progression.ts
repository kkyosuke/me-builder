import {
  type AccountDataNamespace,
  type UtsushiProgression,
  accountDataFor,
} from "@me-builder/lib";
import type { AuthenticatedActor } from "./authentication/types";

export type ProfileProgressionOutcome = { type: "resolved" } & UtsushiProgression;

type Params = Readonly<{
  actor: AuthenticatedActor;
  accountData?: AccountDataNamespace;
  at?: Date;
}>;

type Dependencies = Readonly<{
  readProgression: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
    at: Date,
  ) => Promise<UtsushiProgression>;
}>;

const defaultDependencies: Dependencies = {
  readProgression: (accountData, accountId, at) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute("progression.read", at);
  },
};

export async function getProfileProgression(
  { actor, accountData, at = new Date() }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<ProfileProgressionOutcome> {
  return {
    type: "resolved",
    ...(await dependencies.readProgression(accountData, actor.accountId, at)),
  };
}
