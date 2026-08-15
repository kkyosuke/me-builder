import {
  type ActivateCompatibilityReferenceResult,
  type CompatibilityReference,
  type CompatibilityReferenceRole,
  type CompatibilityRelationshipCategory,
  D1,
  DIAGNOSIS_CATALOG_ID,
  DO,
  type ReleaseCompatibilityReservationResult,
  type ReserveCompatibilityReferenceResult,
} from "@me-builder/lib";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
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
    input: Readonly<{
      relationshipId: string;
      relationshipCategory: CompatibilityRelationshipCategory;
      createdAt: Date;
    }>,
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
        existing.partnerAccountId !== null ||
        existing.relationshipCategory !== input.relationshipCategory
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
      relationshipCategory: input.relationshipCategory,
      status: "pending" as const,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    this.database.insert(compatibilityReferences).values(reference).run();
    return reference;
  }

  reserveIncomingCompatibilityReference(
    accountId: string,
    input: Readonly<{
      relationshipId: string;
      partnerAccountId: string;
      relationshipCategory: CompatibilityRelationshipCategory;
      createdAt: Date;
    }>,
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
        existing.relationshipCategory === input.relationshipCategory &&
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
      relationshipCategory: input.relationshipCategory,
      status: "reserved" as const,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    this.database.insert(compatibilityReferences).values(reference).run();
    return { outcome: "reserved", reference };
  }

  reserveOutgoingCompatibilityReference(
    accountId: string,
    input: Readonly<{
      relationshipId: string;
      partnerAccountId: string;
      relationshipCategory: CompatibilityRelationshipCategory;
      updatedAt: Date;
    }>,
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
      (existing.partnerAccountId !== null &&
        existing.partnerAccountId !== input.partnerAccountId) ||
      (existing.relationshipCategory !== null &&
        existing.relationshipCategory !== input.relationshipCategory)
    ) {
      return { outcome: "conflict", reference: existing };
    }
    if (
      (existing.status === "reserved" || existing.status === "active") &&
      existing.partnerAccountId === input.partnerAccountId &&
      existing.relationshipCategory === input.relationshipCategory
    ) {
      return { outcome: "unchanged", reference: existing };
    }

    const competing = this.findOpenCompatibilityReference(input.partnerAccountId);
    if (competing) return { outcome: "conflict", reference: competing };
    this.database
      .update(compatibilityReferences)
      .set({
        partnerAccountId: input.partnerAccountId,
        relationshipCategory: input.relationshipCategory,
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
      relationshipCategory: CompatibilityRelationshipCategory;
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
    if (
      existing.status === "active" &&
      existing.partnerAccountId === input.partnerAccountId &&
      existing.relationshipCategory === input.relationshipCategory
    ) {
      return { outcome: "unchanged", reference: existing };
    }
    if (
      existing.status === "ended" ||
      (existing.partnerAccountId !== null &&
        existing.partnerAccountId !== input.partnerAccountId) ||
      (existing.relationshipCategory !== null &&
        existing.relationshipCategory !== input.relationshipCategory)
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
        relationshipCategory: input.relationshipCategory,
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

  /** 同じ相手・関係カテゴリで最後に終了した参照だけを、再同意時の移送元として返す。 */
  listCompatibilityProgressionHistoryReferences(
    accountId: string,
    input: Readonly<{
      partnerAccountId: string;
      relationshipCategory: CompatibilityRelationshipCategory;
    }>,
  ): CompatibilityReference[] {
    const categorized = this.database
      .select()
      .from(compatibilityReferences)
      .where(
        and(
          eq(compatibilityReferences.accountId, accountId),
          eq(compatibilityReferences.partnerAccountId, input.partnerAccountId),
          eq(compatibilityReferences.relationshipCategory, input.relationshipCategory),
          eq(compatibilityReferences.status, "ended"),
        ),
      )
      .orderBy(desc(compatibilityReferences.updatedAt))
      .limit(1)
      .get();
    // 0025より前の終了参照は関係カテゴリを持たない。初回移送時だけ最大3件を
    // CompatibilityDataで照合し、以後は現在関係のstateがあるため再走査しない。
    const legacy = this.database
      .select()
      .from(compatibilityReferences)
      .where(
        and(
          eq(compatibilityReferences.accountId, accountId),
          eq(compatibilityReferences.partnerAccountId, input.partnerAccountId),
          isNull(compatibilityReferences.relationshipCategory),
          eq(compatibilityReferences.status, "ended"),
        ),
      )
      .orderBy(desc(compatibilityReferences.updatedAt))
      .limit(3)
      .all();
    return [...(categorized ? [categorized] : []), ...legacy];
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

  /** 未処理のAccountData内部処理のうち、最も早いmaintenance時刻を返す。 */
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
          inArray(DO.account.schema.diaryBrainCheckpoints.status, [
            "pending",
            "queued",
            "dispatched",
          ]),
          eq(DO.account.schema.diaryBrainCheckpoints.isDeleted, false),
        ),
      )
      .orderBy(asc(DO.account.schema.diaryBrainCheckpoints.nextAttemptAt))
      .limit(1)
      .get();
    const brainVectorSync = this.database
      .select({ nextAttemptAt: DO.account.schema.brainVectorSyncJobs.nextAttemptAt })
      .from(DO.account.schema.brainVectorSyncJobs)
      .where(
        and(
          inArray(DO.account.schema.brainVectorSyncJobs.status, [
            "pending",
            "submitted",
            "retry_scheduled",
          ]),
          eq(DO.account.schema.brainVectorSyncJobs.isDeleted, false),
        ),
      )
      .orderBy(asc(DO.account.schema.brainVectorSyncJobs.nextAttemptAt))
      .limit(1)
      .get();
    const profileSummaryGeneration = this.database
      .select({ requestedAt: DO.account.schema.profileSummaryGenerations.requestedAt })
      .from(DO.account.schema.profileSummaryGenerations)
      .where(
        and(
          eq(DO.account.schema.profileSummaryGenerations.status, "queued"),
          isNull(DO.account.schema.profileSummaryGenerations.dispatchedAt),
        ),
      )
      .orderBy(asc(DO.account.schema.profileSummaryGenerations.requestedAt))
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
      brainVectorSync?.nextAttemptAt.getTime() ?? null,
      profileSummaryGeneration
        ? profileSummaryGeneration.requestedAt.getTime() +
          DO.account.action.profileSummary.PROFILE_SUMMARY_DISPATCH_RECOVERY_MS
        : null,
    ].filter((value): value is number => value !== null);
    return candidates.length > 0 ? Math.min(...candidates) : null;
  }
}
