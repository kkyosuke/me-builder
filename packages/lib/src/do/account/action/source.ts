import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { AccountDataDatabase } from "../database";
import { brainItemEvidenceEdges, brainItems, brainVectorSyncJobs } from "../schema/brain";
import { diagnoses, questionChoices, questionVersions } from "../schema/catalog-snapshot";
import {
  diagnosisAnswers,
  diagnosisBrainProjectionHeads,
  diagnosisBrainProjectionRequests,
  diagnosisResponses,
} from "../schema/diagnosis";
import {
  chatTurns,
  conversationMessages,
  conversationSessions,
  diaryChatBrainUsageAudits,
  sourceRecordTextPayloads,
} from "../schema/diary";
import {
  profileSummaryGenerations,
  profileSummaryShareProjections,
  profileSummaryVersions,
} from "../schema/profile-summary";
import { sourceRecordRevisions, sourceRecords } from "../schema/source";

type D1BatchStatement = Parameters<AccountDataDatabase["batch"]>[0][number];

export type PersonalDataRecord =
  | Readonly<{
      id: string;
      kind: "diagnosis";
      title: string;
      value: string;
      recordedAt: string;
      diagnosisId: string;
      choices: readonly Readonly<{ id: string; label: string }>[];
    }>
  | Readonly<{
      id: string;
      kind: "diary";
      title: "日記";
      value: string;
      recordedAt: string;
    }>;

export type CorrectPersonalDataRecordInput = Readonly<
  { kind: "diagnosis"; choiceId: string } | { kind: "diary"; value: string }
>;

export type MutatePersonalDataRecordResult =
  | Readonly<{
      type: "updated" | "deleted" | "unchanged";
      recordId: string;
      diagnosisId?: string;
      invalidatedBrainItemCount: number;
    }>
  | Readonly<{ type: "not-found" }>
  | Readonly<{ type: "kind-mismatch" }>
  | Readonly<{ type: "invalid-choice" }>;

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 本人に現在有効な入力記録が1件以上あるかだけを返す。本文は読み出さない。 */
export async function hasActiveSourceRecords(
  db: AccountDataDatabase,
  accountId: string,
): Promise<boolean> {
  const record = await db
    .select({ id: sourceRecords.id })
    .from(sourceRecords)
    .where(and(eq(sourceRecords.accountId, accountId), eq(sourceRecords.isDeleted, false)))
    .limit(1)
    .get();
  return record !== undefined;
}

/** Webで本人が訂正・削除できる、現在有効な診断回答と日記原本を返す。 */
export async function listPersonalDataRecords(
  db: AccountDataDatabase,
  accountId: string,
): Promise<readonly PersonalDataRecord[]> {
  const [answerRows, diaryRows] = await Promise.all([
    db
      .select({
        id: sourceRecords.id,
        diagnosisId: diagnoses.id,
        questionId: diagnosisAnswers.questionId,
        questionVersion: diagnosisAnswers.questionVersion,
        title: questionVersions.text,
        value: questionChoices.label,
        recordedAt: diagnosisAnswers.acceptedAt,
      })
      .from(diagnosisAnswers)
      .innerJoin(
        diagnosisResponses,
        eq(diagnosisAnswers.diagnosisResponseId, diagnosisResponses.id),
      )
      .innerJoin(diagnoses, eq(diagnosisResponses.diagnosisId, diagnoses.id))
      .innerJoin(sourceRecords, eq(diagnosisAnswers.sourceRecordId, sourceRecords.id))
      .innerJoin(
        questionVersions,
        and(
          eq(diagnosisAnswers.questionId, questionVersions.questionId),
          eq(diagnosisAnswers.questionVersion, questionVersions.version),
        ),
      )
      .innerJoin(
        questionChoices,
        and(
          eq(diagnosisAnswers.questionId, questionChoices.questionId),
          eq(diagnosisAnswers.questionVersion, questionChoices.questionVersion),
          eq(diagnosisAnswers.choiceId, questionChoices.choiceId),
        ),
      )
      .where(
        and(
          eq(diagnosisResponses.accountId, accountId),
          eq(diagnosisAnswers.isDeleted, false),
          eq(sourceRecords.isDeleted, false),
        ),
      )
      .orderBy(desc(diagnosisAnswers.acceptedAt), asc(sourceRecords.id))
      .all(),
    db
      .select({
        id: sourceRecords.id,
        value: sourceRecordTextPayloads.body,
        recordedAt: sourceRecords.createdAt,
      })
      .from(conversationMessages)
      .innerJoin(conversationSessions, eq(conversationMessages.sessionId, conversationSessions.id))
      .innerJoin(sourceRecords, eq(conversationMessages.sourceRecordId, sourceRecords.id))
      .innerJoin(
        sourceRecordTextPayloads,
        eq(sourceRecordTextPayloads.sourceRecordId, sourceRecords.id),
      )
      .where(
        and(
          eq(conversationSessions.accountId, accountId),
          eq(conversationMessages.role, "user"),
          eq(conversationMessages.isDeleted, false),
          eq(sourceRecords.isDeleted, false),
        ),
      )
      .orderBy(desc(sourceRecords.createdAt), asc(sourceRecords.id))
      .all(),
  ]);

  const choicesByQuestion = new Map<string, Array<{ id: string; label: string }>>();
  for (const answer of answerRows) {
    const key = `${answer.questionId}:${answer.questionVersion}`;
    if (choicesByQuestion.has(key)) continue;
    const choices = await db
      .select({ id: questionChoices.choiceId, label: questionChoices.label })
      .from(questionChoices)
      .where(
        and(
          eq(questionChoices.questionId, answer.questionId),
          eq(questionChoices.questionVersion, answer.questionVersion),
          eq(questionChoices.isDeleted, false),
        ),
      )
      .orderBy(asc(questionChoices.position))
      .all();
    choicesByQuestion.set(key, choices);
  }

  return [
    ...answerRows.map(
      (answer): PersonalDataRecord => ({
        id: answer.id,
        kind: "diagnosis",
        title: answer.title,
        value: answer.value,
        recordedAt: answer.recordedAt.toISOString(),
        diagnosisId: answer.diagnosisId,
        choices: choicesByQuestion.get(`${answer.questionId}:${answer.questionVersion}`) ?? [],
      }),
    ),
    ...diaryRows.map(
      (row): PersonalDataRecord => ({
        id: row.id,
        kind: "diary",
        title: "日記",
        value: row.value,
        recordedAt: row.recordedAt.toISOString(),
      }),
    ),
  ].sort(
    (left, right) =>
      right.recordedAt.localeCompare(left.recordedAt) || left.id.localeCompare(right.id),
  );
}

async function affectedBrainItemIds(
  db: AccountDataDatabase,
  accountId: string,
  sourceRecordId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: brainItems.id })
    .from(brainItemEvidenceEdges)
    .innerJoin(brainItems, eq(brainItemEvidenceEdges.brainItemId, brainItems.id))
    .where(
      and(
        eq(brainItemEvidenceEdges.sourceRecordId, sourceRecordId),
        eq(brainItems.accountId, accountId),
        eq(brainItems.isDeleted, false),
      ),
    )
    .all();
  return [...new Set(rows.map(({ id }) => id))];
}

function derivedInvalidationStatements(
  db: AccountDataDatabase,
  brainItemIds: readonly string[],
  at: Date,
): D1BatchStatement[] {
  const statements: D1BatchStatement[] = [];
  if (brainItemIds.length > 0) {
    statements.push(
      db
        .update(brainItems)
        .set({ status: "invalidated", updatedAt: at })
        .where(inArray(brainItems.id, brainItemIds)),
      ...brainItemIds.map((brainItemId) =>
        db
          .insert(brainVectorSyncJobs)
          .values({
            id: `${brainItemId}:${at.getTime()}:delete`,
            brainItemId,
            itemRevision: at.getTime(),
            operation: "delete" as const,
            status: "pending" as const,
            nextAttemptAt: at,
            createdAt: at,
            updatedAt: at,
          })
          .onConflictDoNothing(),
      ),
    );
  }
  // 生成物は入力IDを全件保持しないため、本人操作時はAccount内の全版を安全側に破棄する。
  statements.push(
    db.delete(profileSummaryShareProjections),
    db.delete(profileSummaryVersions),
    db.delete(profileSummaryGenerations),
  );
  return statements;
}

async function diagnosisAnswerForSource(
  db: AccountDataDatabase,
  accountId: string,
  sourceRecordId: string,
) {
  return db
    .select({
      answerId: diagnosisAnswers.id,
      responseId: diagnosisResponses.id,
      responseRevision: diagnosisResponses.revision,
      diagnosisId: diagnosisResponses.diagnosisId,
      diagnosisQuestionId: diagnosisAnswers.diagnosisQuestionId,
      questionId: diagnosisAnswers.questionId,
      questionVersion: diagnosisAnswers.questionVersion,
      choiceId: diagnosisAnswers.choiceId,
    })
    .from(diagnosisAnswers)
    .innerJoin(diagnosisResponses, eq(diagnosisAnswers.diagnosisResponseId, diagnosisResponses.id))
    .innerJoin(sourceRecords, eq(diagnosisAnswers.sourceRecordId, sourceRecords.id))
    .where(
      and(
        eq(sourceRecords.id, sourceRecordId),
        eq(sourceRecords.accountId, accountId),
        eq(sourceRecords.isDeleted, false),
        eq(diagnosisAnswers.isDeleted, false),
      ),
    )
    .get();
}

async function diaryMessageForSource(
  db: AccountDataDatabase,
  accountId: string,
  sourceRecordId: string,
) {
  return db
    .select({
      messageId: conversationMessages.id,
      sessionId: conversationMessages.sessionId,
      sequence: conversationMessages.sequence,
      body: sourceRecordTextPayloads.body,
      createdAt: sourceRecords.createdAt,
      accessLabel: sourceRecords.accessLabel,
    })
    .from(conversationMessages)
    .innerJoin(conversationSessions, eq(conversationMessages.sessionId, conversationSessions.id))
    .innerJoin(sourceRecords, eq(conversationMessages.sourceRecordId, sourceRecords.id))
    .innerJoin(
      sourceRecordTextPayloads,
      eq(sourceRecordTextPayloads.sourceRecordId, sourceRecords.id),
    )
    .where(
      and(
        eq(sourceRecords.id, sourceRecordId),
        eq(sourceRecords.accountId, accountId),
        eq(sourceRecords.isDeleted, false),
        eq(conversationSessions.accountId, accountId),
        eq(conversationMessages.role, "user"),
        eq(conversationMessages.isDeleted, false),
      ),
    )
    .get();
}

function invalidateAssistantResponseStatements(
  db: AccountDataDatabase,
  sessionId: string,
  sequence: number,
  at: Date,
): D1BatchStatement[] {
  const turnIds = db
    .select({ id: chatTurns.id })
    .from(chatTurns)
    .where(
      and(
        eq(chatTurns.sessionId, sessionId),
        lte(chatTurns.fromSequence, sequence),
        gte(chatTurns.throughSequence, sequence),
      ),
    );
  return [
    db
      .update(conversationMessages)
      .set({ isDeleted: true, deletedAt: at, updatedAt: at })
      .where(inArray(conversationMessages.turnId, turnIds)),
    db
      .update(diaryChatBrainUsageAudits)
      .set({ isDeleted: true, deletedAt: at, updatedAt: at })
      .where(inArray(diaryChatBrainUsageAudits.turnId, turnIds)),
  ];
}

/** 原本を上書きせず、新版とRevisionを作って現在の参照だけを差し替える。 */
export async function correctPersonalDataRecord(
  db: AccountDataDatabase,
  accountId: string,
  sourceRecordId: string,
  input: CorrectPersonalDataRecordInput,
  at = new Date(),
): Promise<MutatePersonalDataRecordResult> {
  const [answer, diary] = await Promise.all([
    diagnosisAnswerForSource(db, accountId, sourceRecordId),
    diaryMessageForSource(db, accountId, sourceRecordId),
  ]);
  if (!answer && !diary) return { type: "not-found" };
  const brainItemIds = await affectedBrainItemIds(db, accountId, sourceRecordId);
  const nextSourceRecordId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const lifecycle = { createdAt: at, updatedAt: at };

  if (answer) {
    if (input.kind !== "diagnosis") return { type: "kind-mismatch" };
    if (answer.choiceId === input.choiceId) {
      return {
        type: "unchanged",
        recordId: sourceRecordId,
        diagnosisId: answer.diagnosisId,
        invalidatedBrainItemCount: 0,
      };
    }
    const choice = await db
      .select({ id: questionChoices.choiceId })
      .from(questionChoices)
      .where(
        and(
          eq(questionChoices.questionId, answer.questionId),
          eq(questionChoices.questionVersion, answer.questionVersion),
          eq(questionChoices.choiceId, input.choiceId),
          eq(questionChoices.isDeleted, false),
        ),
      )
      .get();
    if (!choice) return { type: "invalid-choice" };
    const responseRevision = answer.responseRevision + 1;
    const statements: D1BatchStatement[] = [
      db.insert(sourceRecords).values({
        id: nextSourceRecordId,
        accountId,
        kind: "user_input",
        accessLabel: "private",
        ...lifecycle,
      }),
      db.insert(sourceRecordRevisions).values({
        id: revisionId,
        previousSourceRecordId: sourceRecordId,
        nextSourceRecordId,
        derivationMethod: "deterministic",
        ...lifecycle,
      }),
      db
        .update(diagnosisAnswers)
        .set({ isDeleted: true, deletedAt: at, updatedAt: at })
        .where(eq(diagnosisAnswers.id, answer.answerId)),
      db.insert(diagnosisAnswers).values({
        id: crypto.randomUUID(),
        diagnosisResponseId: answer.responseId,
        diagnosisQuestionId: answer.diagnosisQuestionId,
        questionId: answer.questionId,
        questionVersion: answer.questionVersion,
        choiceId: input.choiceId,
        acceptedAt: at,
        sourceRecordId: nextSourceRecordId,
        ...lifecycle,
      }),
      db
        .update(diagnosisResponses)
        .set({ revision: responseRevision, updatedAt: at })
        .where(eq(diagnosisResponses.id, answer.responseId)),
      db.insert(diagnosisBrainProjectionRequests).values({
        id: crypto.randomUUID(),
        diagnosisResponseId: answer.responseId,
        responseRevision,
        status: "pending",
        nextAttemptAt: at,
        ...lifecycle,
      }),
      ...derivedInvalidationStatements(db, brainItemIds, at),
    ];
    await db.batch(statements);
    return {
      type: "updated",
      recordId: nextSourceRecordId,
      diagnosisId: answer.diagnosisId,
      invalidatedBrainItemCount: brainItemIds.length,
    };
  }

  if (!diary) return { type: "not-found" };
  if (input.kind !== "diary") return { type: "kind-mismatch" };
  const value = input.value.trim();
  if (value === diary.body) {
    return {
      type: "unchanged",
      recordId: sourceRecordId,
      invalidatedBrainItemCount: 0,
    };
  }
  const statements: D1BatchStatement[] = [
    db.insert(sourceRecords).values({
      id: nextSourceRecordId,
      accountId,
      kind: "user_input",
      accessLabel: diary.accessLabel,
      originalRef: `correction:${sourceRecordId}:${nextSourceRecordId}`,
      createdAt: diary.createdAt,
      updatedAt: at,
    }),
    db.insert(sourceRecordTextPayloads).values({
      sourceRecordId: nextSourceRecordId,
      body: value,
      contentType: "text/plain",
      contentHash: await sha256(value),
      createdAt: diary.createdAt,
    }),
    db.insert(sourceRecordRevisions).values({
      id: revisionId,
      previousSourceRecordId: sourceRecordId,
      nextSourceRecordId,
      derivationMethod: "deterministic",
      ...lifecycle,
    }),
    db
      .update(conversationMessages)
      .set({ sourceRecordId: nextSourceRecordId, updatedAt: at })
      .where(eq(conversationMessages.id, diary.messageId)),
    ...invalidateAssistantResponseStatements(db, diary.sessionId, diary.sequence, at),
    ...derivedInvalidationStatements(db, brainItemIds, at),
  ];
  await db.batch(statements);
  return {
    type: "updated",
    recordId: nextSourceRecordId,
    invalidatedBrainItemCount: brainItemIds.length,
  };
}

/** 本文をtombstoneから除き、派生物を同期的に利用不能へしてVector削除を予約する。 */
export async function deletePersonalDataRecord(
  db: AccountDataDatabase,
  accountId: string,
  sourceRecordId: string,
  at = new Date(),
): Promise<MutatePersonalDataRecordResult> {
  const [answer, diary] = await Promise.all([
    diagnosisAnswerForSource(db, accountId, sourceRecordId),
    diaryMessageForSource(db, accountId, sourceRecordId),
  ]);
  if (!answer && !diary) return { type: "not-found" };
  const brainItemIds = await affectedBrainItemIds(db, accountId, sourceRecordId);
  const statements: D1BatchStatement[] = [
    db
      .update(sourceRecords)
      .set({ isDeleted: true, deletedAt: at, updatedAt: at })
      .where(
        and(
          eq(sourceRecords.id, sourceRecordId),
          eq(sourceRecords.accountId, accountId),
          eq(sourceRecords.isDeleted, false),
        ),
      ),
    db
      .delete(sourceRecordTextPayloads)
      .where(eq(sourceRecordTextPayloads.sourceRecordId, sourceRecordId)),
    ...derivedInvalidationStatements(db, brainItemIds, at),
  ];

  if (answer) {
    const responseRevision = answer.responseRevision + 1;
    statements.push(
      db
        .update(diagnosisAnswers)
        .set({ isDeleted: true, deletedAt: at, updatedAt: at })
        .where(eq(diagnosisAnswers.id, answer.answerId)),
      db
        .update(diagnosisResponses)
        .set({ revision: responseRevision, updatedAt: at })
        .where(eq(diagnosisResponses.id, answer.responseId)),
      db
        .delete(diagnosisBrainProjectionHeads)
        .where(
          and(
            eq(diagnosisBrainProjectionHeads.accountId, accountId),
            eq(diagnosisBrainProjectionHeads.diagnosisId, answer.diagnosisId),
          ),
        ),
      db.insert(diagnosisBrainProjectionRequests).values({
        id: crypto.randomUUID(),
        diagnosisResponseId: answer.responseId,
        responseRevision,
        status: "pending",
        nextAttemptAt: at,
        createdAt: at,
        updatedAt: at,
      }),
    );
  }
  if (diary) {
    statements.push(
      db
        .update(conversationMessages)
        .set({ isDeleted: true, deletedAt: at, updatedAt: at })
        .where(eq(conversationMessages.id, diary.messageId)),
      ...invalidateAssistantResponseStatements(db, diary.sessionId, diary.sequence, at),
    );
  }
  await db.batch(statements);
  return {
    type: "deleted",
    recordId: sourceRecordId,
    ...(answer ? { diagnosisId: answer.diagnosisId } : {}),
    invalidatedBrainItemCount: brainItemIds.length,
  };
}
