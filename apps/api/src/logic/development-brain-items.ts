import {
  type AccountDataNamespace,
  type ActiveBrainVectorEntry,
  type D1,
  type DO,
  accountDataFor,
} from "@me-builder/lib";
import { createLiffSession } from "./liff-session";

type DevelopmentBrainItems = Awaited<
  ReturnType<typeof DO.account.action.brain.listActiveBrainItems>
>;
type BrainVectorIndex = ApiBindings["BRAIN_VECTOR_INDEX"];
type DevelopmentBrainVectorMetadata = {
  category?: string;
  derivation?: "ai" | "deterministic";
  embeddingVersion?: number;
  schemaVersion?: number;
};

export type DevelopmentBrainItemsOutcome =
  | ({ type: "resolved" } & DevelopmentBrainItems)
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type Params = {
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: D1.shared.Client;
  accountData?: AccountDataNamespace;
};

type Dependencies = {
  createSession: typeof createLiffSession;
  listActive: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
  ) => Promise<DevelopmentBrainItems>;
};

export type DevelopmentBrainVectorOutcome =
  | {
      type: "resolved";
      result:
        | { state: "not-synced"; checkedAt: Date }
        | { state: "missing"; entryRevision: number; checkedAt: Date }
        | {
            state: "present";
            entryRevision: number;
            dimensions: number;
            metadata: DevelopmentBrainVectorMetadata;
            checkedAt: Date;
          };
    }
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type VectorDependencies = {
  createSession: typeof createLiffSession;
  findEntry: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
    brainItemId: string,
  ) => Promise<ActiveBrainVectorEntry | undefined>;
  getByIds: (index: BrainVectorIndex, ids: string[]) => ReturnType<BrainVectorIndex["getByIds"]>;
  now: () => Date;
};

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  listActive: (accountData, accountId) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute("brain.listActive");
  },
};

const defaultVectorDependencies: VectorDependencies = {
  createSession: createLiffSession,
  findEntry: (accountData, accountId, brainItemId) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute(
      "brain.findActiveVectorEntry",
      brainItemId,
    );
  },
  getByIds: (index, ids) => index.getByIds(ids),
  now: () => new Date(),
};

/** 本人確認済みAccountのactive Brain Itemを開発用確認画面へ返す。 */
export async function getDevelopmentBrainItems(
  { idToken, lineLoginChannelId, db, accountData }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<DevelopmentBrainItemsOutcome> {
  const session = await dependencies.createSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") return session;

  const result = await dependencies.listActive(accountData, session.session.accountId);
  return { type: "resolved", ...result };
}

function scalarMetadata(
  metadata: Record<string, unknown> | undefined,
): DevelopmentBrainVectorMetadata {
  const category = typeof metadata?.category === "string" ? metadata.category : undefined;
  const derivation =
    metadata?.derivation === "ai" || metadata?.derivation === "deterministic"
      ? metadata.derivation
      : undefined;
  const embeddingVersion =
    typeof metadata?.embedding_version === "number" ? metadata.embedding_version : undefined;
  const schemaVersion =
    typeof metadata?.schema_version === "number" ? metadata.schema_version : undefined;
  return {
    ...(category ? { category } : {}),
    ...(derivation ? { derivation } : {}),
    ...(embeddingVersion ? { embeddingVersion } : {}),
    ...(schemaVersion ? { schemaVersion } : {}),
  };
}

/** AccountDataの対応表を本人scopeで引き、Vectorize上の実体をオンデマンドで照合する。 */
export async function getDevelopmentBrainVector(
  {
    idToken,
    lineLoginChannelId,
    db,
    accountData,
    vectorIndex,
    brainItemId,
  }: Params & { vectorIndex: BrainVectorIndex; brainItemId: string },
  dependencies: VectorDependencies = defaultVectorDependencies,
): Promise<DevelopmentBrainVectorOutcome> {
  const session = await dependencies.createSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") return session;

  const entry = await dependencies.findEntry(accountData, session.session.accountId, brainItemId);
  if (!entry) {
    return {
      type: "resolved",
      result: { state: "not-synced", checkedAt: dependencies.now() },
    };
  }

  const vectors = await dependencies.getByIds(vectorIndex, [entry.vectorId]);
  const vector = vectors.find((candidate: { id: string }) => candidate.id === entry.vectorId);
  const checkedAt = dependencies.now();
  if (!vector) {
    return {
      type: "resolved",
      result: { state: "missing", entryRevision: entry.itemRevision, checkedAt },
    };
  }
  return {
    type: "resolved",
    result: {
      state: "present",
      entryRevision: entry.itemRevision,
      dimensions: vector.values.length,
      metadata: scalarMetadata(vector.metadata as Record<string, unknown> | undefined),
      checkedAt,
    },
  };
}
