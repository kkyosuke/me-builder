import {
  type ActivateCompatibilityReferenceResult,
  type CompatibilityReference,
  type CompatibilityReferenceRole,
  D1,
  DIAGNOSIS_CATALOG_ID,
  DO,
  type ReleaseCompatibilityReservationResult,
  type ReserveCompatibilityReferenceResult,
} from "@me-builder/lib";
import { and, asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import migrations from "../../../../packages/lib/drizzle-do-account/migrations.js";

const { accountDataIdentity, compatibilityReferences, catalogVersions } = DO.account.schema;
const SESSION_INACTIVITY_MS = 6 * 60 * 60 * 1000;
const SESSION_HARD_CAP_MS = 24 * 60 * 60 * 1000;
type ExecutableStatement = { all(): unknown };

export type DiagnosisCatalogSnapshot = Readonly<{
  version: number;
  questions: (typeof D1.shared.schema.questions.$inferSelect)[];
  questionVersions: (typeof D1.shared.schema.questionVersions.$inferSelect)[];
  questionChoices: (typeof D1.shared.schema.questionChoices.$inferSelect)[];
  scoringConfigs: (typeof D1.shared.schema.diagnosisScoringConfigs.$inferSelect)[];
  diagnoses: (typeof D1.shared.schema.diagnoses.$inferSelect)[];
  diagnosisQuestions: (typeof D1.shared.schema.diagnosisQuestions.$inferSelect)[];
}>;

/** AccountDataのprivate SQLiteを所有し、domain actionへdatabaseだけを渡す。 */
export class AccountDataRepository {
  private readonly storage: DurableObjectStorage;
  readonly client: DO.account.Database;

  constructor(storage: DurableObjectStorage) {
    this.storage = storage;
    const database = drizzle(storage, { schema: DO.account.schema });
    this.client = database as unknown as DO.account.Database;
    Object.defineProperty(this.client, "batch", {
      configurable: false,
      value: async (statements: ExecutableStatement[]) =>
        this.storage.transactionSync(() => statements.map((statement) => statement.all())),
    });
  }

  private get database(): DO.account.Database {
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
          .insert(D1.shared.schema.questions)
          .values(row)
          .onConflictDoUpdate({ target: D1.shared.schema.questions.id, set: row })
          .run();
      }
      for (const row of snapshot.questionVersions) {
        this.database
          .insert(D1.shared.schema.questionVersions)
          .values(row)
          .onConflictDoUpdate({
            target: [
              D1.shared.schema.questionVersions.questionId,
              D1.shared.schema.questionVersions.version,
            ],
            set: row,
          })
          .run();
      }
      for (const row of snapshot.questionChoices) {
        this.database
          .insert(D1.shared.schema.questionChoices)
          .values(row)
          .onConflictDoUpdate({
            target: [
              D1.shared.schema.questionChoices.questionId,
              D1.shared.schema.questionChoices.questionVersion,
              D1.shared.schema.questionChoices.choiceId,
            ],
            set: row,
          })
          .run();
      }
      for (const row of snapshot.scoringConfigs) {
        this.database
          .insert(D1.shared.schema.diagnosisScoringConfigs)
          .values(row)
          .onConflictDoUpdate({ target: D1.shared.schema.diagnosisScoringConfigs.id, set: row })
          .run();
      }
      for (const row of snapshot.diagnoses) {
        this.database
          .insert(D1.shared.schema.diagnoses)
          .values(row)
          .onConflictDoUpdate({ target: D1.shared.schema.diagnoses.id, set: row })
          .run();
      }
      for (const row of snapshot.diagnosisQuestions) {
        this.database
          .insert(D1.shared.schema.diagnosisQuestions)
          .values(row)
          .onConflictDoUpdate({ target: D1.shared.schema.diagnosisQuestions.id, set: row })
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
        startedAt: DO.account.schema.conversationSessions.startedAt,
        lastUserMessageAt: DO.account.schema.conversationSessions.lastUserMessageAt,
      })
      .from(DO.account.schema.conversationSessions)
      .where(eq(DO.account.schema.conversationSessions.status, "active"))
      .get();
    const projection = this.database
      .select({ nextAttemptAt: DO.account.schema.diagnosisBrainProjectionRequests.nextAttemptAt })
      .from(DO.account.schema.diagnosisBrainProjectionRequests)
      .where(
        and(
          inArray(DO.account.schema.diagnosisBrainProjectionRequests.status, ["pending", "failed"]),
          eq(DO.account.schema.diagnosisBrainProjectionRequests.isDeleted, false),
        ),
      )
      .orderBy(asc(DO.account.schema.diagnosisBrainProjectionRequests.nextAttemptAt))
      .limit(1)
      .get();
    const diaryBrainCheckpoint = this.database
      .select({ nextAttemptAt: DO.account.schema.diaryBrainCheckpoints.nextAttemptAt })
      .from(DO.account.schema.diaryBrainCheckpoints)
      .where(
        and(
          inArray(DO.account.schema.diaryBrainCheckpoints.status, ["pending", "queued"]),
          eq(DO.account.schema.diaryBrainCheckpoints.isDeleted, false),
        ),
      )
      .orderBy(asc(DO.account.schema.diaryBrainCheckpoints.nextAttemptAt))
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
