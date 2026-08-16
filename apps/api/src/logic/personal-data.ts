import { type AccountDataNamespace, type D1, type DO, accountDataFor } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import { createLiffSession } from "./liff-session";

type CorrectPersonalDataRecordInput = Parameters<
  typeof DO.account.action.source.correctPersonalDataRecord
>[3];

type CommonParams = {
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: D1.shared.Client;
  accountData: AccountDataNamespace;
};

export type PersonalDataOutcome<T> =
  | ({ type: "resolved" } & T)
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

export async function listPersonalData(
  params: CommonParams,
): Promise<PersonalDataOutcome<{ records: Awaited<ReturnType<typeof listRecords>> }>> {
  const session = await createLiffSession(params);
  if (session.type !== "resolved") return session;
  return {
    type: "resolved",
    records: await listRecords(params.accountData, session.session.accountId),
  };
}

function listRecords(accountData: AccountDataNamespace, accountId: string) {
  return accountDataFor(accountData, accountId).execute("source.listPersonalData");
}

export async function correctPersonalData(
  params: CommonParams & {
    sourceRecordId: string;
    input: CorrectPersonalDataRecordInput;
    at?: Date;
  },
): Promise<PersonalDataOutcome<{ result: Awaited<ReturnType<typeof correctRecord>> }>> {
  const session = await createLiffSession(params);
  if (session.type !== "resolved") return session;
  const accountId = session.session.accountId;
  const result = await correctRecord(
    params.accountData,
    accountId,
    params.sourceRecordId,
    params.input,
    params.at,
  );
  if (result.type === "updated" && result.diagnosisId) {
    await processDiagnosisProjection(
      params.accountData,
      accountId,
      result.diagnosisId,
      params.at,
      "correction",
    );
  }
  return { type: "resolved", result };
}

function correctRecord(
  accountData: AccountDataNamespace,
  accountId: string,
  sourceRecordId: string,
  input: CorrectPersonalDataRecordInput,
  at?: Date,
) {
  return accountDataFor(accountData, accountId).execute(
    "source.correctPersonalData",
    sourceRecordId,
    input,
    at,
  );
}

export async function deletePersonalData(
  params: CommonParams & { sourceRecordId: string; at?: Date },
): Promise<PersonalDataOutcome<{ result: Awaited<ReturnType<typeof deleteRecord>> }>> {
  const session = await createLiffSession(params);
  if (session.type !== "resolved") return session;
  const accountId = session.session.accountId;
  const result = await deleteRecord(
    params.accountData,
    accountId,
    params.sourceRecordId,
    params.at,
  );
  if (result.type === "deleted" && result.diagnosisId) {
    await processDiagnosisProjection(
      params.accountData,
      accountId,
      result.diagnosisId,
      params.at,
      "deletion",
    );
  }
  return { type: "resolved", result };
}

async function processDiagnosisProjection(
  accountData: AccountDataNamespace,
  accountId: string,
  diagnosisId: string,
  at: Date | undefined,
  trigger: "correction" | "deletion",
): Promise<void> {
  try {
    await accountDataFor(accountData, accountId).execute(
      "diagnosisProjection.processLatest",
      diagnosisId,
      at,
    );
  } catch (error) {
    logger.error(
      {
        diagnosisId,
        trigger,
        reason: error instanceof Error ? error.name : "unknown",
      },
      "Personal data diagnosis projection failed; AccountData alarm will retry it",
    );
  }
}

function deleteRecord(
  accountData: AccountDataNamespace,
  accountId: string,
  sourceRecordId: string,
  at?: Date,
) {
  return accountDataFor(accountData, accountId).execute(
    "source.deletePersonalData",
    sourceRecordId,
    at,
  );
}
