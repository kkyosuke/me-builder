import { type AccountDataNamespace, type DO, accountDataFor } from "@me-builder/lib";
import type { AuthenticatedActor } from "./authentication/types";

type CorrectPersonalDataRecordInput = Parameters<
  typeof DO.account.action.source.correctPersonalDataRecord
>[3];

type CommonParams = {
  actor: AuthenticatedActor;
  accountData: AccountDataNamespace;
};

export type PersonalDataOutcome<T> = { type: "resolved" } & T;

export async function listPersonalData(
  params: CommonParams,
): Promise<PersonalDataOutcome<{ records: Awaited<ReturnType<typeof listRecords>> }>> {
  return {
    type: "resolved",
    records: await listRecords(params.accountData, params.actor.accountId),
  };
}

export async function getPersonalDataFeatures(
  params: CommonParams & { at?: Date },
): Promise<PersonalDataOutcome<{ features: Awaited<ReturnType<typeof readFeatures>> }>> {
  return {
    type: "resolved",
    features: await readFeatures(params.accountData, params.actor.accountId, params.at),
  };
}

function readFeatures(accountData: AccountDataNamespace, accountId: string, at?: Date) {
  return accountDataFor(accountData, accountId).execute("brain.readPersonalDataFeatures", at);
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
  const result = await correctRecord(
    params.accountData,
    params.actor.accountId,
    params.sourceRecordId,
    params.input,
    params.at,
  );
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
  const result = await deleteRecord(
    params.accountData,
    params.actor.accountId,
    params.sourceRecordId,
    params.at,
  );
  return { type: "resolved", result };
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
