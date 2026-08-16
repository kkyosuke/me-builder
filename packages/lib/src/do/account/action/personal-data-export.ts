import { and, asc, desc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import type { AccountDataDatabase } from "../database";
import {
  brainItemAccessLabels,
  brainItemEvidenceEdges,
  brainItemRevisions,
  brainItemTopicLabels,
  brainItems,
} from "../schema/brain";
import { questionChoices, questionVersions } from "../schema/catalog-snapshot";
import { diagnosisAnswers, diagnosisResponses } from "../schema/diagnosis";
import {
  conversationMessages,
  conversationSessions,
  dailyPromptPreferences,
  diaryChatBrainUsageAudits,
  sourceRecordTextPayloads,
} from "../schema/diary";
import { goalFollowUps } from "../schema/goal-follow-up";
import { personalDataExports } from "../schema/personal-data-export";
import {
  profileSummaryGenerations,
  profileSummaryShareProjections,
  profileSummaryVersions,
} from "../schema/profile-summary";
import { progressionMilestones, progressionStates } from "../schema/progression";
import { sourceRecordRevisions, sourceRecords } from "../schema/source";
import { weeklyReflectionGenerations, weeklyReflections } from "../schema/weekly-reflection";

const PERSONAL_DATA_EXPORT_FORMAT_VERSION = 1;
const PERSONAL_DATA_EXPORT_TTL_MS = 24 * 60 * 60 * 1_000;
export const PERSONAL_DATA_EXPORT_GENERATION_TIMEOUT_MS = 15 * 60 * 1_000;

type ExportStatus = "queued" | "generating" | "ready" | "failed" | "expired";

export type PersonalDataExportStatus = Readonly<{
  id: string;
  status: ExportStatus;
  requestedAt: string;
  completedAt: string | null;
  expiresAt: string | null;
}>;

type PersonalDataArchive = Readonly<{
  format: "me-builder-personal-data";
  formatVersion: typeof PERSONAL_DATA_EXPORT_FORMAT_VERSION;
  generatedAt: string;
  owner: Readonly<{ accountId: string }>;
  sourceRecords: readonly unknown[];
  sourceRecordRevisions: readonly unknown[];
  diagnoses: readonly unknown[];
  conversations: readonly unknown[];
  brainItems: readonly unknown[];
  brainEvidence: readonly unknown[];
  brainRevisions: readonly unknown[];
  brainUsageHistory: readonly unknown[];
  profileSummaries: readonly unknown[];
  weeklyReflections: readonly unknown[];
  goalFollowUps: readonly unknown[];
  compatibilityShareProjections: readonly unknown[];
  preferences: Readonly<{ dailyPrompt: unknown | null }>;
  progression: Readonly<{ state: unknown | null; milestones: readonly unknown[] }>;
}>;

function iso(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
}

function lifecycle(row: {
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  isDeleted: boolean;
}) {
  return {
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: iso(row.deletedAt),
    isDeleted: row.isDeleted,
  };
}

function status(row: typeof personalDataExports.$inferSelect): PersonalDataExportStatus {
  return {
    id: row.id,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    completedAt: iso(row.completedAt),
    expiresAt: iso(row.expiresAt),
  };
}

async function expirePersonalDataExports(db: AccountDataDatabase, accountId: string, at: Date) {
  await db
    .update(personalDataExports)
    .set({
      status: "failed",
      archiveJson: null,
      completedAt: at,
      failureCode: "generation_timeout",
    })
    .where(
      and(
        eq(personalDataExports.accountId, accountId),
        eq(personalDataExports.status, "generating"),
        or(
          isNull(personalDataExports.startedAt),
          lte(
            personalDataExports.startedAt,
            new Date(at.getTime() - PERSONAL_DATA_EXPORT_GENERATION_TIMEOUT_MS),
          ),
        ),
      ),
    );
  await db
    .update(personalDataExports)
    .set({ status: "expired", archiveJson: null })
    .where(
      and(
        eq(personalDataExports.accountId, accountId),
        eq(personalDataExports.status, "ready"),
        lte(personalDataExports.expiresAt, at),
      ),
    );
}

/** 同じAccountで処理中の要求を再利用し、AccountData alarmでの生成を予約する。 */
export async function requestPersonalDataExport(
  db: AccountDataDatabase,
  accountId: string,
  at = new Date(),
): Promise<Readonly<{ outcome: "created" | "unchanged"; export: PersonalDataExportStatus }>> {
  await expirePersonalDataExports(db, accountId, at);
  const active = await db
    .select()
    .from(personalDataExports)
    .where(
      and(
        eq(personalDataExports.accountId, accountId),
        inArray(personalDataExports.status, ["queued", "generating"]),
      ),
    )
    .orderBy(desc(personalDataExports.requestedAt))
    .get();
  if (active) return { outcome: "unchanged", export: status(active) };

  const row: typeof personalDataExports.$inferInsert = {
    id: crypto.randomUUID(),
    accountId,
    status: "queued",
    requestedAt: at,
  };
  await db.insert(personalDataExports).values(row);
  const created = await db
    .select()
    .from(personalDataExports)
    .where(eq(personalDataExports.id, row.id))
    .get();
  if (!created) throw new Error("Personal data export request was not persisted");
  return { outcome: "created", export: status(created) };
}

export async function readPersonalDataExportStatus(
  db: AccountDataDatabase,
  accountId: string,
  exportId: string,
  at = new Date(),
): Promise<PersonalDataExportStatus | null> {
  await expirePersonalDataExports(db, accountId, at);
  const row = await db
    .select()
    .from(personalDataExports)
    .where(and(eq(personalDataExports.id, exportId), eq(personalDataExports.accountId, accountId)))
    .get();
  return row ? status(row) : null;
}

async function buildPersonalDataArchive(
  db: AccountDataDatabase,
  accountId: string,
  generatedAt: Date,
): Promise<PersonalDataArchive> {
  const sourceRows = await db
    .select()
    .from(sourceRecords)
    .where(eq(sourceRecords.accountId, accountId))
    .orderBy(asc(sourceRecords.createdAt), asc(sourceRecords.id))
    .all();
  const sourceIds = sourceRows.map(({ id }) => id);
  const payloadRows =
    sourceIds.length === 0
      ? []
      : await db
          .select()
          .from(sourceRecordTextPayloads)
          .where(inArray(sourceRecordTextPayloads.sourceRecordId, sourceIds))
          .all();
  const payloadBySource = new Map(payloadRows.map((row) => [row.sourceRecordId, row]));
  const sourceRevisionRows =
    sourceIds.length === 0
      ? []
      : await db
          .select()
          .from(sourceRecordRevisions)
          .where(inArray(sourceRecordRevisions.previousSourceRecordId, sourceIds))
          .orderBy(asc(sourceRecordRevisions.createdAt), asc(sourceRecordRevisions.id))
          .all();

  const responseRows = await db
    .select()
    .from(diagnosisResponses)
    .where(eq(diagnosisResponses.accountId, accountId))
    .orderBy(asc(diagnosisResponses.createdAt), asc(diagnosisResponses.id))
    .all();
  const responseIds = responseRows.map(({ id }) => id);
  const answerRows =
    responseIds.length === 0
      ? []
      : await db
          .select()
          .from(diagnosisAnswers)
          .where(inArray(diagnosisAnswers.diagnosisResponseId, responseIds))
          .orderBy(asc(diagnosisAnswers.acceptedAt), asc(diagnosisAnswers.id))
          .all();
  const questionKeys = new Set(
    answerRows.map(({ questionId, questionVersion }) => `${questionId}:${questionVersion}`),
  );
  const questionRows = await db.select().from(questionVersions).all();
  const choiceRows = await db.select().from(questionChoices).all();
  const questionText = new Map(
    questionRows
      .filter((row) => questionKeys.has(`${row.questionId}:${row.version}`))
      .map((row) => [`${row.questionId}:${row.version}`, row.text]),
  );
  const choiceLabel = new Map(
    choiceRows.map((row) => [
      `${row.questionId}:${row.questionVersion}:${row.choiceId}`,
      row.label,
    ]),
  );

  const sessionRows = await db
    .select()
    .from(conversationSessions)
    .where(eq(conversationSessions.accountId, accountId))
    .orderBy(asc(conversationSessions.startedAt), asc(conversationSessions.id))
    .all();
  const sessionIds = sessionRows.map(({ id }) => id);
  const messageRows =
    sessionIds.length === 0
      ? []
      : await db
          .select()
          .from(conversationMessages)
          .where(inArray(conversationMessages.sessionId, sessionIds))
          .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id))
          .all();

  const brainRows = await db
    .select()
    .from(brainItems)
    .where(eq(brainItems.accountId, accountId))
    .orderBy(asc(brainItems.createdAt), asc(brainItems.id))
    .all();
  const brainIds = brainRows.map(({ id }) => id);
  const [evidenceRows, brainRevisionRows, accessLabelRows, topicLabelRows] =
    brainIds.length === 0
      ? [[], [], [], []]
      : await Promise.all([
          db
            .select()
            .from(brainItemEvidenceEdges)
            .where(inArray(brainItemEvidenceEdges.brainItemId, brainIds))
            .all(),
          db
            .select()
            .from(brainItemRevisions)
            .where(inArray(brainItemRevisions.previousBrainItemId, brainIds))
            .all(),
          db
            .select()
            .from(brainItemAccessLabels)
            .where(inArray(brainItemAccessLabels.brainItemId, brainIds))
            .all(),
          db
            .select()
            .from(brainItemTopicLabels)
            .where(inArray(brainItemTopicLabels.brainItemId, brainIds))
            .all(),
        ]);
  const accessLabelsByBrain = new Map<string, string[]>();
  const topicLabelsByBrain = new Map<string, string[]>();
  for (const row of accessLabelRows) {
    if (row.isDeleted) continue;
    accessLabelsByBrain.set(row.brainItemId, [
      ...(accessLabelsByBrain.get(row.brainItemId) ?? []),
      row.label,
    ]);
  }
  for (const row of topicLabelRows) {
    if (row.isDeleted) continue;
    topicLabelsByBrain.set(row.brainItemId, [
      ...(topicLabelsByBrain.get(row.brainItemId) ?? []),
      row.label,
    ]);
  }

  const usageRows =
    brainIds.length === 0
      ? []
      : await db
          .select()
          .from(diaryChatBrainUsageAudits)
          .where(inArray(diaryChatBrainUsageAudits.brainItemId, brainIds))
          .orderBy(asc(diaryChatBrainUsageAudits.createdAt), asc(diaryChatBrainUsageAudits.id))
          .all();

  const generationRows = await db
    .select()
    .from(profileSummaryGenerations)
    .where(eq(profileSummaryGenerations.accountId, accountId))
    .all();
  const generationIds = generationRows.map(({ id }) => id);
  const versionRows =
    generationIds.length === 0
      ? []
      : await db
          .select()
          .from(profileSummaryVersions)
          .where(inArray(profileSummaryVersions.generationId, generationIds))
          .orderBy(asc(profileSummaryVersions.sequence))
          .all();
  const versionIds = versionRows.map(({ id }) => id);
  const shareRows =
    versionIds.length === 0
      ? []
      : await db
          .select()
          .from(profileSummaryShareProjections)
          .where(inArray(profileSummaryShareProjections.profileSummaryVersionId, versionIds))
          .all();
  const weeklyGenerationRows = await db
    .select({ id: weeklyReflectionGenerations.id })
    .from(weeklyReflectionGenerations)
    .where(eq(weeklyReflectionGenerations.accountId, accountId))
    .all();
  const weeklyGenerationIds = weeklyGenerationRows.map(({ id }) => id);
  const weeklyReflectionRows =
    weeklyGenerationIds.length === 0
      ? []
      : await db
          .select()
          .from(weeklyReflections)
          .where(inArray(weeklyReflections.generationId, weeklyGenerationIds))
          .orderBy(asc(weeklyReflections.weekStart))
          .all();
  const goalFollowUpRows = await db
    .select()
    .from(goalFollowUps)
    .where(eq(goalFollowUps.accountId, accountId))
    .orderBy(asc(goalFollowUps.agreedAt), asc(goalFollowUps.id))
    .all();
  const dailyPrompt = await db
    .select()
    .from(dailyPromptPreferences)
    .where(eq(dailyPromptPreferences.accountId, accountId))
    .get();
  const progressionState = await db
    .select()
    .from(progressionStates)
    .where(eq(progressionStates.accountId, accountId))
    .get();
  const milestoneRows = await db
    .select()
    .from(progressionMilestones)
    .where(eq(progressionMilestones.accountId, accountId))
    .orderBy(asc(progressionMilestones.level))
    .all();

  return {
    format: "me-builder-personal-data",
    formatVersion: PERSONAL_DATA_EXPORT_FORMAT_VERSION,
    generatedAt: generatedAt.toISOString(),
    owner: { accountId },
    sourceRecords: sourceRows.map((row) => {
      const payload = payloadBySource.get(row.id);
      return {
        id: row.id,
        kind: row.kind,
        accessLabel: row.accessLabel,
        ...lifecycle(row),
        payload:
          row.isDeleted || !payload
            ? null
            : {
                body: payload.body,
                contentType: payload.contentType,
                contentHash: payload.contentHash,
                createdAt: payload.createdAt.toISOString(),
              },
      };
    }),
    sourceRecordRevisions: sourceRevisionRows.map((row) => ({
      id: row.id,
      previousSourceRecordId: row.previousSourceRecordId,
      nextSourceRecordId: row.nextSourceRecordId,
      derivationMethod: row.derivationMethod,
      ...lifecycle(row),
    })),
    diagnoses: responseRows.map((response) => ({
      id: response.id,
      diagnosisId: response.diagnosisId,
      revision: response.revision,
      ...lifecycle(response),
      answers: answerRows
        .filter(({ diagnosisResponseId }) => diagnosisResponseId === response.id)
        .map((answer) => ({
          id: answer.id,
          diagnosisQuestionId: answer.diagnosisQuestionId,
          questionId: answer.questionId,
          questionVersion: answer.questionVersion,
          question: questionText.get(`${answer.questionId}:${answer.questionVersion}`) ?? null,
          choiceId: answer.choiceId,
          choice:
            choiceLabel.get(`${answer.questionId}:${answer.questionVersion}:${answer.choiceId}`) ??
            null,
          acceptedAt: answer.acceptedAt.toISOString(),
          sourceRecordId: answer.sourceRecordId,
          ...lifecycle(answer),
        })),
    })),
    conversations: sessionRows.map((session) => ({
      id: session.id,
      status: session.status,
      startedAt: session.startedAt.toISOString(),
      closedAt: iso(session.closedAt),
      ...lifecycle(session),
      messages: messageRows
        .filter(({ sessionId }) => sessionId === session.id)
        .map((message) => {
          const source = sourceRows.find(({ id }) => id === message.sourceRecordId);
          const payload = message.sourceRecordId
            ? payloadBySource.get(message.sourceRecordId)
            : undefined;
          return {
            id: message.id,
            sequence: message.sequence,
            role: message.role,
            sourceRecordId: message.sourceRecordId,
            body:
              message.isDeleted || source?.isDeleted
                ? null
                : message.role === "user"
                  ? (payload?.body ?? null)
                  : message.assistantBody,
            sentAt: iso(message.sentAt),
            ...lifecycle(message),
          };
        }),
    })),
    brainItems: brainRows.map((row) => ({
      id: row.id,
      category: row.category,
      statement: row.isDeleted ? null : row.statement,
      attributes: row.isDeleted ? null : row.attributes,
      derivation: row.derivation,
      status: row.status,
      validFrom: iso(row.validFrom),
      validTo: iso(row.validTo),
      stability: row.stability,
      sensitivity: row.sensitivity,
      externallyShareable: row.externallyShareable,
      confidence: row.confidence,
      accessLabels: accessLabelsByBrain.get(row.id) ?? [],
      topicLabels: topicLabelsByBrain.get(row.id) ?? [],
      ...lifecycle(row),
    })),
    brainEvidence: evidenceRows.map((row) => ({
      id: row.id,
      brainItemId: row.brainItemId,
      sourceRecordId: row.sourceRecordId,
      relation: row.relation,
      isDerivationTrigger: row.isDerivationTrigger,
      derivationMethod: row.derivationMethod,
      generatedAt: row.generatedAt.toISOString(),
      ...lifecycle(row),
    })),
    brainRevisions: brainRevisionRows.map((row) => ({
      id: row.id,
      previousBrainItemId: row.previousBrainItemId,
      nextBrainItemId: row.nextBrainItemId,
      derivationMethod: row.derivationMethod,
      changeKind: row.changeKind,
      ...lifecycle(row),
    })),
    brainUsageHistory: usageRows.map((row) => ({
      id: row.id,
      brainItemId: row.brainItemId,
      purpose: row.purpose,
      status: row.status,
      derivation: row.derivation,
      confidence: row.confidence,
      accessLabels: row.accessLabels,
      sourceRecordIds: row.sourceRecordIds,
      ...lifecycle(row),
    })),
    profileSummaries: versionRows.map((row) => ({
      id: row.id,
      sequence: row.sequence,
      generatedAt: row.generatedAt.toISOString(),
      summary: row.summary,
    })),
    weeklyReflections: weeklyReflectionRows.map((row) => ({
      id: row.id,
      weekStart: row.weekStart,
      generatedAt: row.generatedAt.toISOString(),
      content: row.content,
    })),
    goalFollowUps: goalFollowUpRows.map((row) => ({
      id: row.id,
      brainItemId: row.brainItemId,
      nextStep: row.nextStep,
      status: row.status,
      agreedAt: row.agreedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    compatibilityShareProjections: shareRows.map((row) => ({
      profileSummaryVersionId: row.profileSummaryVersionId,
      schemaVersion: row.schemaVersion,
      generatedAt: row.generatedAt.toISOString(),
      statements: row.statements,
      evidenceReferences: row.evidenceReferences,
      fingerprint: row.fingerprint,
    })),
    preferences: {
      dailyPrompt: dailyPrompt
        ? {
            status: dailyPrompt.status,
            controlledAt: dailyPrompt.controlledAt.toISOString(),
            controlSourceRecordId: dailyPrompt.controlSourceRecordId,
            updatedAt: dailyPrompt.updatedAt.toISOString(),
          }
        : null,
    },
    progression: {
      state: progressionState
        ? {
            growthValue: progressionState.growthValue,
            collectedPieces: progressionState.collectedPieces,
            calculationVersion: progressionState.calculationVersion,
            highestLevel: progressionState.highestLevel,
            ...lifecycle(progressionState),
          }
        : null,
      milestones: milestoneRows.map((row) => ({
        level: row.level,
        collectedPiecesDelta: row.collectedPiecesDelta,
        collectedPiecesTotal: row.collectedPiecesTotal,
        categories: JSON.parse(row.categoriesJson) as unknown,
        ...lifecycle(row),
      })),
    },
  };
}

/** Alarmからqueued要求を1件claimし、本人向けarchiveへ収束させる。 */
export async function processPendingPersonalDataExport(
  db: AccountDataDatabase,
  accountId: string,
  at = new Date(),
): Promise<Readonly<{ processed: boolean; exportId?: string }>> {
  await expirePersonalDataExports(db, accountId, at);
  const queued = await db
    .select()
    .from(personalDataExports)
    .where(
      and(eq(personalDataExports.accountId, accountId), eq(personalDataExports.status, "queued")),
    )
    .orderBy(asc(personalDataExports.requestedAt), asc(personalDataExports.id))
    .get();
  if (!queued) return { processed: false };

  await db
    .update(personalDataExports)
    .set({ status: "generating", startedAt: at, failureCode: null })
    .where(and(eq(personalDataExports.id, queued.id), eq(personalDataExports.status, "queued")));
  try {
    const archive = await buildPersonalDataArchive(db, accountId, at);
    await db
      .update(personalDataExports)
      .set({
        status: "ready",
        archiveJson: archive,
        completedAt: at,
        expiresAt: new Date(at.getTime() + PERSONAL_DATA_EXPORT_TTL_MS),
      })
      .where(eq(personalDataExports.id, queued.id));
  } catch (error) {
    await db
      .update(personalDataExports)
      .set({
        status: "failed",
        archiveJson: null,
        completedAt: at,
        failureCode: "archive_generation_failed",
      })
      .where(eq(personalDataExports.id, queued.id));
    throw error;
  }
  return { processed: true, exportId: queued.id };
}

export type ReadPersonalDataArchiveResult =
  | Readonly<{ type: "ready"; archive: PersonalDataArchive; expiresAt: string }>
  | Readonly<{ type: "not-found" }>
  | Readonly<{ type: "not-ready" }>
  | Readonly<{ type: "expired" }>;

export async function readPersonalDataArchive(
  db: AccountDataDatabase,
  accountId: string,
  exportId: string,
  at = new Date(),
): Promise<ReadPersonalDataArchiveResult> {
  await expirePersonalDataExports(db, accountId, at);
  const row = await db
    .select()
    .from(personalDataExports)
    .where(and(eq(personalDataExports.id, exportId), eq(personalDataExports.accountId, accountId)))
    .get();
  if (!row) return { type: "not-found" };
  if (row.status === "expired") return { type: "expired" };
  if (row.status !== "ready" || !row.archiveJson || !row.expiresAt) {
    return { type: "not-ready" };
  }
  return {
    type: "ready",
    archive: row.archiveJson as PersonalDataArchive,
    expiresAt: row.expiresAt.toISOString(),
  };
}
