import {
  type ActivateCompatibilityReferenceResult,
  type CompatibilityReference,
  type CompatibilityReferenceRole,
  DIAGNOSIS_CATALOG_ID,
  type ReleaseCompatibilityReservationResult,
  type ReserveCompatibilityReferenceResult,
  accountData,
  accountDataSchema,
  sharedD1,
} from "@me-builder/lib";
import { and, asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import migrations from "../../../../packages/lib/drizzle-account-data/migrations.js";

const { accountDataIdentity, compatibilityReferences, catalogVersions } = accountData.schema;
const SESSION_INACTIVITY_MS = 6 * 60 * 60 * 1000;
const SESSION_HARD_CAP_MS = 24 * 60 * 60 * 1000;
type ExecutableStatement = { all(): unknown };

export type DiagnosisCatalogSnapshot = Readonly<{
  version: number;
  questions: (typeof sharedD1.schema.questions.$inferSelect)[];
  questionVersions: (typeof sharedD1.schema.questionVersions.$inferSelect)[];
  questionChoices: (typeof sharedD1.schema.questionChoices.$inferSelect)[];
  scoringConfigs: (typeof sharedD1.schema.diagnosisScoringConfigs.$inferSelect)[];
  diagnoses: (typeof sharedD1.schema.diagnoses.$inferSelect)[];
  diagnosisQuestions: (typeof sharedD1.schema.diagnosisQuestions.$inferSelect)[];
}>;

/** AccountDataのprivate SQLiteを所有し、domain actionへdatabaseだけを渡す。 */
export class AccountDataRepository {
  private readonly storage: DurableObjectStorage;
  readonly client: accountData.Database;

  constructor(storage: DurableObjectStorage) {
    this.storage = storage;
    const database = drizzle(storage, { schema: accountDataSchema });
    this.client = database as unknown as accountData.Database;
    Object.defineProperty(this.client, "batch", {
      configurable: false,
      value: async (statements: ExecutableStatement[]) =>
        this.storage.transactionSync(() => statements.map((statement) => statement.all())),
    });
  }

  private get database(): accountData.Database {
    return this.client;
  }

  async initialize(): Promise<void> {
    await migrate(this.client as never, migrations);
  }

  bindAccount(accountId: string): void {
    const existing = this.database
      .select({ accountId: accountDataIdentity.accountId })
      .from(accountDataIdentity)
      .where(eq(accountDataIdentity.singleton, 1))
      .get();
    if (existing && existing.accountId !== accountId) {
      throw new Error("AccountData Object cannot be used by another account");
    }
    if (existing) return;

    this.database.insert(accountDataIdentity).values({ singleton: 1, accountId }).run();
  }

  /** 共有D1が公開している版と、最後に同期した版が同じかを返す。 */
  isDiagnosisCatalogCurrent(version: number): boolean {
    const synced = this.database
      .select({ version: catalogVersions.version })
      .from(catalogVersions)
      .where(eq(catalogVersions.catalogId, DIAGNOSIS_CATALOG_ID))
      .get();
    return synced?.version === version;
  }

  syncDiagnosisCatalog(snapshot: DiagnosisCatalogSnapshot, at = new Date()): void {
    this.storage.transactionSync(() => {
      for (const row of snapshot.questions) {
        this.database
          .insert(sharedD1.schema.questions)
          .values(row)
          .onConflictDoUpdate({ target: sharedD1.schema.questions.id, set: row })
          .run();
      }
      for (const row of snapshot.questionVersions) {
        this.database
          .insert(sharedD1.schema.questionVersions)
          .values(row)
          .onConflictDoUpdate({
            target: [
              sharedD1.schema.questionVersions.questionId,
              sharedD1.schema.questionVersions.version,
            ],
            set: row,
          })
          .run();
      }
      for (const row of snapshot.questionChoices) {
        this.database
          .insert(sharedD1.schema.questionChoices)
          .values(row)
          .onConflictDoUpdate({
            target: [
              sharedD1.schema.questionChoices.questionId,
              sharedD1.schema.questionChoices.questionVersion,
              sharedD1.schema.questionChoices.choiceId,
            ],
            set: row,
          })
          .run();
      }
      for (const row of snapshot.scoringConfigs) {
        this.database
          .insert(sharedD1.schema.diagnosisScoringConfigs)
          .values(row)
          .onConflictDoUpdate({ target: sharedD1.schema.diagnosisScoringConfigs.id, set: row })
          .run();
      }
      for (const row of snapshot.diagnoses) {
        this.database
          .insert(sharedD1.schema.diagnoses)
          .values(row)
          .onConflictDoUpdate({ target: sharedD1.schema.diagnoses.id, set: row })
          .run();
      }
      for (const row of snapshot.diagnosisQuestions) {
        this.database
          .insert(sharedD1.schema.diagnosisQuestions)
          .values(row)
          .onConflictDoUpdate({ target: sharedD1.schema.diagnosisQuestions.id, set: row })
          .run();
      }
      const synced = { catalogId: DIAGNOSIS_CATALOG_ID, version: snapshot.version, updatedAt: at };
      this.database
        .insert(catalogVersions)
        .values(synced)
        .onConflictDoUpdate({ target: catalogVersions.catalogId, set: synced })
        .run();
    });
  }

  addOutgoingCompatibilityReference(
    accountId: string,
    input: Readonly<{ relationshipId: string; createdAt: Date }>,
  ): CompatibilityReference {
    const existing = this.database
      .select()
      .from(compatibilityReferences)
      .where(eq(compatibilityReferences.relationshipId, input.relationshipId))
      .get();
    if (existing) {
      if (
        existing.accountId !== accountId ||
        existing.role !== "inviter" ||
        existing.status !== "pending" ||
        existing.partnerAccountId !== null
      ) {
        throw new Error("Compatibility reference conflicts with persisted outgoing invitation");
      }
      return existing;
    }

    const reference = {
      relationshipId: input.relationshipId,
      accountId,
      role: "inviter" as const,
      partnerAccountId: null,
      status: "pending" as const,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    this.database.insert(compatibilityReferences).values(reference).run();
    return reference;
  }

  reserveIncomingCompatibilityReference(
    accountId: string,
    input: Readonly<{ relationshipId: string; partnerAccountId: string; createdAt: Date }>,
  ): ReserveCompatibilityReferenceResult {
    const existing = this.database
      .select()
      .from(compatibilityReferences)
      .where(eq(compatibilityReferences.relationshipId, input.relationshipId))
      .get();
    if (existing) {
      if (
        existing.accountId === accountId &&
        existing.role === "invitee" &&
        existing.partnerAccountId === input.partnerAccountId &&
        (existing.status === "reserved" || existing.status === "active")
      ) {
        return { outcome: "unchanged", reference: existing };
      }
      return { outcome: "conflict", reference: existing };
    }

    const competing = this.findOpenCompatibilityReference(input.partnerAccountId);
    if (competing) return { outcome: "conflict", reference: competing };
    const reference = {
      relationshipId: input.relationshipId,
      accountId,
      role: "invitee" as const,
      partnerAccountId: input.partnerAccountId,
      status: "reserved" as const,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    this.database.insert(compatibilityReferences).values(reference).run();
    return { outcome: "reserved", reference };
  }

  reserveOutgoingCompatibilityReference(
    accountId: string,
    input: Readonly<{ relationshipId: string; partnerAccountId: string; updatedAt: Date }>,
  ): ReserveCompatibilityReferenceResult {
    const existing = this.database
      .select()
      .from(compatibilityReferences)
      .where(eq(compatibilityReferences.relationshipId, input.relationshipId))
      .get();
    if (!existing) {
      throw new Error("Outgoing compatibility reference to reserve was not found");
    }
    if (
      existing.accountId !== accountId ||
      existing.role !== "inviter" ||
      existing.status === "ended" ||
      (existing.partnerAccountId !== null && existing.partnerAccountId !== input.partnerAccountId)
    ) {
      return { outcome: "conflict", reference: existing };
    }
    if (
      (existing.status === "reserved" || existing.status === "active") &&
      existing.partnerAccountId === input.partnerAccountId
    ) {
      return { outcome: "unchanged", reference: existing };
    }

    const competing = this.findOpenCompatibilityReference(input.partnerAccountId);
    if (competing) return { outcome: "conflict", reference: competing };
    this.database
      .update(compatibilityReferences)
      .set({
        partnerAccountId: input.partnerAccountId,
        status: "reserved",
        updatedAt: input.updatedAt,
      })
      .where(eq(compatibilityReferences.relationshipId, input.relationshipId))
      .run();
    const reference = this.database
      .select()
      .from(compatibilityReferences)
      .where(eq(compatibilityReferences.relationshipId, input.relationshipId))
      .get();
    if (!reference) throw new Error("Reserved outgoing compatibility reference was not persisted");
    return { outcome: "reserved", reference };
  }

  releaseCompatibilityReservation(
    accountId: string,
    relationshipId: string,
    releasedAt: Date,
  ): ReleaseCompatibilityReservationResult {
    const existing = this.database
      .select()
      .from(compatibilityReferences)
      .where(eq(compatibilityReferences.relationshipId, relationshipId))
      .get();
    if (!existing || existing.accountId !== accountId || existing.status !== "reserved") {
      return { outcome: "unchanged", reference: existing ?? null };
    }

    if (existing.role === "invitee") {
      this.database
        .delete(compatibilityReferences)
        .where(eq(compatibilityReferences.relationshipId, relationshipId))
        .run();
      return { outcome: "released", reference: null };
    }

    this.database
      .update(compatibilityReferences)
      .set({ partnerAccountId: null, status: "pending", updatedAt: releasedAt })
      .where(eq(compatibilityReferences.relationshipId, relationshipId))
      .run();
    return {
      outcome: "released",
      reference: { ...existing, partnerAccountId: null, status: "pending", updatedAt: releasedAt },
    };
  }

  hasCompatibilityReservation(
    accountId: string,
    input: Readonly<{
      relationshipId: string;
      partnerAccountId: string;
      role: CompatibilityReferenceRole;
    }>,
  ): boolean {
    return Boolean(
      this.database
        .select({ relationshipId: compatibilityReferences.relationshipId })
        .from(compatibilityReferences)
        .where(
          and(
            eq(compatibilityReferences.relationshipId, input.relationshipId),
            eq(compatibilityReferences.accountId, accountId),
            eq(compatibilityReferences.partnerAccountId, input.partnerAccountId),
            eq(compatibilityReferences.role, input.role),
            inArray(compatibilityReferences.status, ["reserved", "active"]),
          ),
        )
        .get(),
    );
  }

  activateCompatibilityReference(
    accountId: string,
    input: Readonly<{
      relationshipId: string;
      partnerAccountId: string;
      role: CompatibilityReferenceRole;
      updatedAt: Date;
    }>,
  ): ActivateCompatibilityReferenceResult {
    const existing = this.database
      .select()
      .from(compatibilityReferences)
      .where(eq(compatibilityReferences.relationshipId, input.relationshipId))
      .get();
    if (!existing || existing.accountId !== accountId || existing.role !== input.role) {
      throw new Error("Compatibility reference to activate was not found");
    }
    if (existing.status === "active" && existing.partnerAccountId === input.partnerAccountId) {
      return { outcome: "unchanged", reference: existing };
    }
    if (
      existing.status === "ended" ||
      (existing.partnerAccountId !== null && existing.partnerAccountId !== input.partnerAccountId)
    ) {
      return { outcome: "conflict", reference: existing };
    }
    const competing = this.findOpenCompatibilityReference(input.partnerAccountId);
    if (competing && competing.relationshipId !== input.relationshipId) {
      return { outcome: "conflict", reference: competing };
    }

    this.database
      .update(compatibilityReferences)
      .set({
        partnerAccountId: input.partnerAccountId,
        status: "active",
        updatedAt: input.updatedAt,
      })
      .where(eq(compatibilityReferences.relationshipId, input.relationshipId))
      .run();
    const reference = this.database
      .select()
      .from(compatibilityReferences)
      .where(eq(compatibilityReferences.relationshipId, input.relationshipId))
      .get();
    if (!reference) throw new Error("Activated compatibility reference was not persisted");
    return { outcome: "activated", reference };
  }

  endCompatibilityReference(
    accountId: string,
    relationshipId: string,
    endedAt: Date,
  ): CompatibilityReference | null {
    const existing = this.database
      .select()
      .from(compatibilityReferences)
      .where(eq(compatibilityReferences.relationshipId, relationshipId))
      .get();
    if (!existing || existing.accountId !== accountId) return null;
    if (existing.status === "ended") return existing;
    this.database
      .update(compatibilityReferences)
      .set({ status: "ended", updatedAt: endedAt })
      .where(eq(compatibilityReferences.relationshipId, relationshipId))
      .run();
    return {
      ...existing,
      status: "ended",
      updatedAt: endedAt,
    };
  }

  listVisibleCompatibilityReferences(accountId: string): CompatibilityReference[] {
    return this.database
      .select()
      .from(compatibilityReferences)
      .where(
        and(
          eq(compatibilityReferences.accountId, accountId),
          inArray(compatibilityReferences.status, ["pending", "active"]),
        ),
      )
      .orderBy(asc(compatibilityReferences.createdAt))
      .all();
  }

  listReconciliableCompatibilityReferences(accountId: string): CompatibilityReference[] {
    return this.database
      .select()
      .from(compatibilityReferences)
      .where(
        and(
          eq(compatibilityReferences.accountId, accountId),
          inArray(compatibilityReferences.status, ["pending", "reserved", "active"]),
        ),
      )
      .orderBy(asc(compatibilityReferences.createdAt))
      .all();
  }

  private findOpenCompatibilityReference(partnerAccountId: string) {
    return this.database
      .select()
      .from(compatibilityReferences)
      .where(
        and(
          eq(compatibilityReferences.partnerAccountId, partnerAccountId),
          inArray(compatibilityReferences.status, ["reserved", "active"]),
        ),
      )
      .get();
  }

  /** Active diary sessionと未処理projectionのうち、最も早いmaintenance時刻を返す。 */
  nextMaintenanceAt(): number | null {
    const session = this.database
      .select({
        startedAt: accountData.schema.conversationSessions.startedAt,
        lastUserMessageAt: accountData.schema.conversationSessions.lastUserMessageAt,
      })
      .from(accountData.schema.conversationSessions)
      .where(eq(accountData.schema.conversationSessions.status, "active"))
      .get();
    const projection = this.database
      .select({ nextAttemptAt: accountData.schema.diagnosisBrainProjectionRequests.nextAttemptAt })
      .from(accountData.schema.diagnosisBrainProjectionRequests)
      .where(
        and(
          inArray(accountData.schema.diagnosisBrainProjectionRequests.status, [
            "pending",
            "failed",
          ]),
          eq(accountData.schema.diagnosisBrainProjectionRequests.isDeleted, false),
        ),
      )
      .orderBy(asc(accountData.schema.diagnosisBrainProjectionRequests.nextAttemptAt))
      .limit(1)
      .get();
    const diaryBrainCheckpoint = this.database
      .select({ nextAttemptAt: accountData.schema.diaryBrainCheckpoints.nextAttemptAt })
      .from(accountData.schema.diaryBrainCheckpoints)
      .where(
        and(
          inArray(accountData.schema.diaryBrainCheckpoints.status, ["pending", "queued"]),
          eq(accountData.schema.diaryBrainCheckpoints.isDeleted, false),
        ),
      )
      .orderBy(asc(accountData.schema.diaryBrainCheckpoints.nextAttemptAt))
      .limit(1)
      .get();
    const candidates = [
      session
        ? Math.min(
            session.startedAt.getTime() + SESSION_HARD_CAP_MS,
            session.lastUserMessageAt.getTime() + SESSION_INACTIVITY_MS,
          )
        : null,
      projection?.nextAttemptAt.getTime() ?? null,
      diaryBrainCheckpoint?.nextAttemptAt.getTime() ?? null,
    ].filter((value): value is number => value !== null);
    return candidates.length > 0 ? Math.min(...candidates) : null;
  }
}
