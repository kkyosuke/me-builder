import { and, asc, desc, eq, inArray, lt, lte } from "drizzle-orm";
import {
  InvalidDiagnosisScoringConfigError,
  projectDiagnosisParameters,
} from "../../diagnosis/scoring";
import type { AccountDataDatabase } from "../database";
import { brainItemEvidenceEdges } from "../schema/brain";
import {
  diagnoses,
  diagnosisQuestions,
  diagnosisScoringConfigs,
  questionChoices,
} from "../schema/catalog-snapshot";
import {
  diagnosisAnswers,
  diagnosisBrainProjectionHeads,
  diagnosisBrainProjectionRequests,
  diagnosisResponses,
} from "../schema/diagnosis";
import { sourceRecords } from "../schema/source";
import { saveBrainItem } from "./brain";

const PROCESSING_LEASE_MILLISECONDS = 5 * 60 * 1000;

export type ProcessDiagnosisBrainProjectionsResult = Readonly<{
  processed: number;
  applied: number;
  skippedIncomplete: number;
  skippedInvalidConfig: number;
  failed: number;
}>;

type ProjectionRequest = Readonly<{
  id: string;
  diagnosisResponseId: string;
  status: typeof diagnosisBrainProjectionRequests.$inferSelect.status;
  responseRevision: number;
  attemptCount: number;
}>;

type ClaimedProjectionRequest = ProjectionRequest;

async function loadProjectionInput(db: AccountDataDatabase, diagnosisResponseId: string) {
  const response = await db
    .select({
      accountId: diagnosisResponses.accountId,
      diagnosisId: diagnosisResponses.diagnosisId,
      scoringConfigId: diagnoses.scoringConfigId,
      scoringConfigVersion: diagnosisScoringConfigs.version,
      scoringConfigDefinition: diagnosisScoringConfigs.definition,
    })
    .from(diagnosisResponses)
    .innerJoin(diagnoses, eq(diagnoses.id, diagnosisResponses.diagnosisId))
    .leftJoin(
      diagnosisScoringConfigs,
      and(
        eq(diagnosisScoringConfigs.id, diagnoses.scoringConfigId),
        eq(diagnosisScoringConfigs.isDeleted, false),
      ),
    )
    .where(
      and(
        eq(diagnosisResponses.id, diagnosisResponseId),
        eq(diagnosisResponses.isDeleted, false),
        eq(diagnoses.isDeleted, false),
      ),
    )
    .get();
  if (!response?.scoringConfigId || !response.scoringConfigVersion) return null;

  const [questionRows, answerRows] = await Promise.all([
    db
      .select({
        diagnosisQuestionId: diagnosisQuestions.id,
        questionId: diagnosisQuestions.questionId,
        questionVersion: diagnosisQuestions.questionVersion,
        choiceId: questionChoices.choiceId,
      })
      .from(diagnosisQuestions)
      .innerJoin(
        questionChoices,
        and(
          eq(questionChoices.questionId, diagnosisQuestions.questionId),
          eq(questionChoices.questionVersion, diagnosisQuestions.questionVersion),
          eq(questionChoices.isDeleted, false),
        ),
      )
      .where(
        and(
          eq(diagnosisQuestions.diagnosisId, response.diagnosisId),
          eq(diagnosisQuestions.isDeleted, false),
        ),
      )
      .orderBy(asc(diagnosisQuestions.position), asc(questionChoices.position))
      .all(),
    db
      .select({
        diagnosisQuestionId: diagnosisAnswers.diagnosisQuestionId,
        questionId: diagnosisAnswers.questionId,
        questionVersion: diagnosisAnswers.questionVersion,
        choiceId: diagnosisAnswers.choiceId,
        sourceRecordId: diagnosisAnswers.sourceRecordId,
        sourceAccountId: sourceRecords.accountId,
      })
      .from(diagnosisAnswers)
      .innerJoin(sourceRecords, eq(sourceRecords.id, diagnosisAnswers.sourceRecordId))
      .where(
        and(
          eq(diagnosisAnswers.diagnosisResponseId, diagnosisResponseId),
          eq(diagnosisAnswers.isDeleted, false),
          eq(sourceRecords.isDeleted, false),
        ),
      )
      .all(),
  ]);

  const diagnosisQuestionIds = new Set(
    questionRows.map(({ diagnosisQuestionId }) => diagnosisQuestionId),
  );
  if (
    diagnosisQuestionIds.size === 0 ||
    answerRows.length !== diagnosisQuestionIds.size ||
    answerRows.some(
      ({ diagnosisQuestionId, sourceAccountId }) =>
        !diagnosisQuestionIds.has(diagnosisQuestionId) || sourceAccountId !== response.accountId,
    )
  ) {
    return { type: "incomplete" as const };
  }

  const scoringQuestions: Array<{
    questionId: string;
    questionVersion: number;
    choiceIds: string[];
  }> = [];
  for (const row of questionRows) {
    const previous = scoringQuestions.at(-1);
    if (previous?.questionId === row.questionId) {
      previous.choiceIds.push(row.choiceId);
    } else {
      scoringQuestions.push({
        questionId: row.questionId,
        questionVersion: row.questionVersion,
        choiceIds: [row.choiceId],
      });
    }
  }

  return {
    type: "complete" as const,
    accountId: response.accountId,
    diagnosisId: response.diagnosisId,
    scoringConfigId: response.scoringConfigId,
    projections: projectDiagnosisParameters({
      diagnosisId: response.diagnosisId,
      scoringConfigId: response.scoringConfigId,
      answers: answerRows,
      storedConfig: {
        version: response.scoringConfigVersion,
        definition: response.scoringConfigDefinition,
        questions: scoringQuestions,
      },
    }),
  };
}

async function saveProjection(
  db: AccountDataDatabase,
  input: Exclude<Awaited<ReturnType<typeof loadProjectionInput>>, null | { type: "incomplete" }>,
  projection: (typeof input.projections)[number],
  at: Date,
): Promise<void> {
  const head = await db
    .select({
      id: diagnosisBrainProjectionHeads.id,
      currentBrainItemId: diagnosisBrainProjectionHeads.currentBrainItemId,
      contentSignature: diagnosisBrainProjectionHeads.contentSignature,
    })
    .from(diagnosisBrainProjectionHeads)
    .where(
      and(
        eq(diagnosisBrainProjectionHeads.accountId, input.accountId),
        eq(diagnosisBrainProjectionHeads.diagnosisId, input.diagnosisId),
        eq(diagnosisBrainProjectionHeads.scoringConfigId, input.scoringConfigId),
        eq(
          diagnosisBrainProjectionHeads.scoringConfigVersion,
          projection.attributes.scoringVersion,
        ),
        eq(diagnosisBrainProjectionHeads.parameterId, projection.parameterId),
        eq(diagnosisBrainProjectionHeads.isDeleted, false),
      ),
    )
    .get();
  if (head?.contentSignature === projection.contentSignature) {
    const existingEvidence = await db
      .select({ sourceRecordId: brainItemEvidenceEdges.sourceRecordId })
      .from(brainItemEvidenceEdges)
      .where(
        and(
          eq(brainItemEvidenceEdges.brainItemId, head.currentBrainItemId),
          eq(brainItemEvidenceEdges.relation, "supports"),
          eq(brainItemEvidenceEdges.isDeleted, false),
        ),
      )
      .all();
    const existingSourceRecordIds = new Set(
      existingEvidence.map(({ sourceRecordId }) => sourceRecordId),
    );
    const missingSourceRecordIds = projection.evidenceSourceRecordIds.filter(
      (sourceRecordId) => !existingSourceRecordIds.has(sourceRecordId),
    );
    const [firstMissingSourceRecordId, ...remainingMissingSourceRecordIds] = missingSourceRecordIds;
    if (firstMissingSourceRecordId) {
      const insertEvidence = (sourceRecordId: string) =>
        db
          .insert(brainItemEvidenceEdges)
          .values({
            id: crypto.randomUUID(),
            brainItemId: head.currentBrainItemId,
            sourceRecordId,
            relation: "supports",
            isDerivationTrigger: true,
            derivationMethod: "deterministic",
            generatedAt: at,
            createdAt: at,
            updatedAt: at,
          })
          .onConflictDoNothing();
      await db.batch([
        insertEvidence(firstMissingSourceRecordId),
        ...remainingMissingSourceRecordIds.map(insertEvidence),
      ]);
    }
    return;
  }

  const brainItemId = crypto.randomUUID();
  const updateHead = head
    ? db
        .update(diagnosisBrainProjectionHeads)
        .set({ currentBrainItemId: brainItemId, contentSignature: projection.contentSignature })
        .where(
          and(
            eq(diagnosisBrainProjectionHeads.id, head.id),
            eq(diagnosisBrainProjectionHeads.currentBrainItemId, head.currentBrainItemId),
            eq(diagnosisBrainProjectionHeads.contentSignature, head.contentSignature),
          ),
        )
    : db.insert(diagnosisBrainProjectionHeads).values({
        id: crypto.randomUUID(),
        accountId: input.accountId,
        diagnosisId: input.diagnosisId,
        scoringConfigId: input.scoringConfigId,
        scoringConfigVersion: projection.attributes.scoringVersion,
        parameterId: projection.parameterId,
        currentBrainItemId: brainItemId,
        contentSignature: projection.contentSignature,
      });
  const result = await saveBrainItem(
    db,
    {
      at,
      item: {
        id: brainItemId,
        accountId: input.accountId,
        category: "preference",
        statement: projection.statement,
        attributes: projection.attributes,
        derivation: "deterministic",
        status: "active",
        validFrom: at,
        stability: "changeable",
        sensitivity: "normal",
        externallyShareable: false,
        confidence: { state: "uncomputed" },
      },
      evidence: projection.evidenceSourceRecordIds.map((sourceRecordId) => ({
        id: crypto.randomUUID(),
        sourceRecordId,
        relation: "supports" as const,
        isDerivationTrigger: true,
        derivationMethod: "deterministic" as const,
        generatedAt: at,
      })),
      accessLabels: [
        {
          id: crypto.randomUUID(),
          label: "unclassified",
          assignedBy: "system",
        },
      ],
      ...(head
        ? {
            supersedes: {
              // 同じ旧版からの並行置換は同じPKになり、一方のatomic batchをrollbackする。
              revisionId: `diagnosis-projection:${head.id}:${head.currentBrainItemId}`,
              brainItemId: head.currentBrainItemId,
              derivationMethod: "deterministic" as const,
            },
          }
        : {}),
    },
    [updateHead],
  );
  if (result.type !== "saved") throw new Error(`Brain Itemを保存できません: ${result.type}`);
}

async function applyRequest(db: AccountDataDatabase, request: ClaimedProjectionRequest, at: Date) {
  const input = await loadProjectionInput(db, request.diagnosisResponseId);
  if (!input || input.type === "incomplete") {
    return input ? "skipped-incomplete" : "applied";
  }
  for (const projection of input.projections) {
    await saveProjection(db, input, projection, at);
  }
  return "applied";
}

async function claimRequest(
  db: AccountDataDatabase,
  request: ProjectionRequest,
  at: Date,
): Promise<ClaimedProjectionRequest | null> {
  if (request.status === "applied") return null;
  const attemptCount = request.attemptCount + 1;
  const [claimed] = await db
    .update(diagnosisBrainProjectionRequests)
    .set({
      attemptCount,
      nextAttemptAt: new Date(at.getTime() + PROCESSING_LEASE_MILLISECONDS),
      updatedAt: at,
    })
    .where(
      and(
        eq(diagnosisBrainProjectionRequests.id, request.id),
        eq(diagnosisBrainProjectionRequests.status, request.status),
        eq(diagnosisBrainProjectionRequests.attemptCount, request.attemptCount),
        lte(diagnosisBrainProjectionRequests.nextAttemptAt, at),
        eq(diagnosisBrainProjectionRequests.isDeleted, false),
      ),
    )
    .returning({ id: diagnosisBrainProjectionRequests.id })
    .all();
  return claimed ? { ...request, attemptCount } : null;
}

async function completeRequest(
  db: AccountDataDatabase,
  request: ClaimedProjectionRequest,
  at: Date,
) {
  await db
    .update(diagnosisBrainProjectionRequests)
    .set({ status: "applied", failureCode: null, updatedAt: at })
    .where(
      and(
        eq(diagnosisBrainProjectionRequests.id, request.id),
        eq(diagnosisBrainProjectionRequests.status, request.status),
        eq(diagnosisBrainProjectionRequests.attemptCount, request.attemptCount),
        eq(diagnosisBrainProjectionRequests.isDeleted, false),
      ),
    )
    .run();
}

async function completeOlderRequests(
  db: AccountDataDatabase,
  request: ClaimedProjectionRequest,
  at: Date,
) {
  await db
    .update(diagnosisBrainProjectionRequests)
    .set({ status: "applied", failureCode: null, updatedAt: at })
    .where(
      and(
        eq(diagnosisBrainProjectionRequests.diagnosisResponseId, request.diagnosisResponseId),
        lt(diagnosisBrainProjectionRequests.responseRevision, request.responseRevision),
        inArray(diagnosisBrainProjectionRequests.status, ["pending", "failed"]),
        eq(diagnosisBrainProjectionRequests.isDeleted, false),
      ),
    )
    .run();
}

async function failRequest(
  db: AccountDataDatabase,
  request: ClaimedProjectionRequest,
  error: unknown,
  at: Date,
) {
  const failureCode =
    error instanceof Error && error.name !== "Error" ? error.name : "retryable-projection-error";
  await db
    .update(diagnosisBrainProjectionRequests)
    .set({
      status: "failed",
      nextAttemptAt: new Date(at.getTime() + PROCESSING_LEASE_MILLISECONDS),
      failureCode,
      updatedAt: at,
    })
    .where(
      and(
        eq(diagnosisBrainProjectionRequests.id, request.id),
        eq(diagnosisBrainProjectionRequests.status, request.status),
        eq(diagnosisBrainProjectionRequests.attemptCount, request.attemptCount),
        eq(diagnosisBrainProjectionRequests.isDeleted, false),
      ),
    )
    .run();
}

/** 指定されたprojection要求を処理します。回答保存直後のbest-effort実行に使用します。 */
export async function processDiagnosisBrainProjectionRequest(
  db: AccountDataDatabase,
  requestId: string,
  at = new Date(),
): Promise<ProcessDiagnosisBrainProjectionsResult> {
  const requests = await db
    .select({
      id: diagnosisBrainProjectionRequests.id,
      diagnosisResponseId: diagnosisBrainProjectionRequests.diagnosisResponseId,
      status: diagnosisBrainProjectionRequests.status,
      responseRevision: diagnosisBrainProjectionRequests.responseRevision,
      attemptCount: diagnosisBrainProjectionRequests.attemptCount,
    })
    .from(diagnosisBrainProjectionRequests)
    .where(
      and(
        eq(diagnosisBrainProjectionRequests.id, requestId),
        inArray(diagnosisBrainProjectionRequests.status, ["pending", "failed"]),
        lte(diagnosisBrainProjectionRequests.nextAttemptAt, at),
        eq(diagnosisBrainProjectionRequests.isDeleted, false),
      ),
    )
    .all();
  return processRequests(db, requests, at);
}

/** AccountとDiagnosisに対する最新のprojection要求だけを処理します。 */
export async function processLatestDiagnosisBrainProjection(
  db: AccountDataDatabase,
  accountId: string,
  diagnosisId: string,
  at = new Date(),
): Promise<ProcessDiagnosisBrainProjectionsResult> {
  const requests = await db
    .select({
      id: diagnosisBrainProjectionRequests.id,
      diagnosisResponseId: diagnosisBrainProjectionRequests.diagnosisResponseId,
      status: diagnosisBrainProjectionRequests.status,
      responseRevision: diagnosisBrainProjectionRequests.responseRevision,
      attemptCount: diagnosisBrainProjectionRequests.attemptCount,
    })
    .from(diagnosisBrainProjectionRequests)
    .innerJoin(
      diagnosisResponses,
      eq(diagnosisResponses.id, diagnosisBrainProjectionRequests.diagnosisResponseId),
    )
    .where(
      and(
        eq(diagnosisResponses.accountId, accountId),
        eq(diagnosisResponses.diagnosisId, diagnosisId),
        eq(diagnosisResponses.isDeleted, false),
        inArray(diagnosisBrainProjectionRequests.status, ["pending", "failed"]),
        lte(diagnosisBrainProjectionRequests.nextAttemptAt, at),
        eq(diagnosisBrainProjectionRequests.isDeleted, false),
      ),
    )
    .orderBy(desc(diagnosisBrainProjectionRequests.responseRevision))
    .limit(1)
    .all();
  return processRequests(db, requests, at);
}

/** 未処理のprojection要求を再試行します。 */
export async function processPendingDiagnosisBrainProjections(
  db: AccountDataDatabase,
  { at = new Date(), limit = 25 }: { at?: Date; limit?: number } = {},
): Promise<ProcessDiagnosisBrainProjectionsResult> {
  const requests = await db
    .select({
      id: diagnosisBrainProjectionRequests.id,
      diagnosisResponseId: diagnosisBrainProjectionRequests.diagnosisResponseId,
      status: diagnosisBrainProjectionRequests.status,
      responseRevision: diagnosisBrainProjectionRequests.responseRevision,
      attemptCount: diagnosisBrainProjectionRequests.attemptCount,
    })
    .from(diagnosisBrainProjectionRequests)
    .where(
      and(
        inArray(diagnosisBrainProjectionRequests.status, ["pending", "failed"]),
        lte(diagnosisBrainProjectionRequests.nextAttemptAt, at),
        eq(diagnosisBrainProjectionRequests.isDeleted, false),
      ),
    )
    .orderBy(asc(diagnosisBrainProjectionRequests.nextAttemptAt))
    .limit(limit)
    .all();
  return processRequests(db, requests, at);
}

async function processRequests(
  db: AccountDataDatabase,
  requests: ProjectionRequest[],
  at: Date,
): Promise<ProcessDiagnosisBrainProjectionsResult> {
  let applied = 0;
  let skippedIncomplete = 0;
  let skippedInvalidConfig = 0;
  let failed = 0;
  for (const request of requests) {
    const claimedRequest = await claimRequest(db, request, at);
    if (!claimedRequest) continue;
    try {
      const result = await applyRequest(db, claimedRequest, at);
      await completeRequest(db, claimedRequest, at);
      await completeOlderRequests(db, claimedRequest, at);
      if (result === "skipped-incomplete") skippedIncomplete += 1;
      else applied += 1;
    } catch (error) {
      if (error instanceof InvalidDiagnosisScoringConfigError) {
        await completeRequest(db, claimedRequest, at);
        await completeOlderRequests(db, claimedRequest, at);
        skippedInvalidConfig += 1;
      } else {
        await failRequest(db, claimedRequest, error, at);
        failed += 1;
      }
    }
  }
  return {
    processed: applied + skippedIncomplete + skippedInvalidConfig + failed,
    applied,
    skippedIncomplete,
    skippedInvalidConfig,
    failed,
  };
}
