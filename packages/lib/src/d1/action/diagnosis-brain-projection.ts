import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { projectDiagnosisParameters } from "../../diagnosis/scoring";
import type { D1Client } from "../client";
import {
  diagnoses,
  diagnosisAnswers,
  diagnosisBrainProjectionHeads,
  diagnosisBrainProjectionRequests,
  diagnosisQuestions,
  diagnosisResponses,
  diagnosisScoringConfigs,
  questionChoices,
} from "../schema/diagnosis";
import { sourceRecords } from "../schema/source";
import { saveBrainItem } from "./brain";

export type ProcessDiagnosisBrainProjectionsResult = Readonly<{
  processed: number;
  applied: number;
  skippedIncomplete: number;
  failed: number;
}>;

type ProjectionRequest = Readonly<{
  id: string;
  diagnosisResponseId: string;
  attemptCount: number;
}>;

async function loadProjectionInput(db: D1Client, diagnosisResponseId: string) {
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
      .orderBy(asc(diagnosisQuestions.position), asc(questionChoices.position)),
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
      ),
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
  db: D1Client,
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
  if (head?.contentSignature === projection.contentSignature) return;

  const brainItemId = crypto.randomUUID();
  const updateHead = head
    ? db
        .update(diagnosisBrainProjectionHeads)
        .set({ currentBrainItemId: brainItemId, contentSignature: projection.contentSignature })
        .where(eq(diagnosisBrainProjectionHeads.id, head.id))
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
        confirmation: "pending",
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
          confirmation: "pending",
          assignedBy: "system",
        },
      ],
      ...(head
        ? {
            supersedes: {
              revisionId: crypto.randomUUID(),
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

async function applyRequest(db: D1Client, request: ProjectionRequest, at: Date) {
  const input = await loadProjectionInput(db, request.diagnosisResponseId);
  if (!input || input.type === "incomplete") {
    await db
      .update(diagnosisBrainProjectionRequests)
      .set({ status: "applied", attemptCount: request.attemptCount + 1, updatedAt: at })
      .where(eq(diagnosisBrainProjectionRequests.id, request.id));
    return input ? "skipped-incomplete" : "applied";
  }
  for (const projection of input.projections) {
    await saveProjection(db, input, projection, at);
  }
  await db
    .update(diagnosisBrainProjectionRequests)
    .set({
      status: "applied",
      attemptCount: request.attemptCount + 1,
      failureCode: null,
      updatedAt: at,
    })
    .where(eq(diagnosisBrainProjectionRequests.id, request.id));
  return "applied";
}

/** 指定されたprojection要求を処理します。回答保存直後のbest-effort実行に使用します。 */
export async function processDiagnosisBrainProjectionRequest(
  db: D1Client,
  requestId: string,
  at = new Date(),
): Promise<ProcessDiagnosisBrainProjectionsResult> {
  const requests = await db
    .select({
      id: diagnosisBrainProjectionRequests.id,
      diagnosisResponseId: diagnosisBrainProjectionRequests.diagnosisResponseId,
      attemptCount: diagnosisBrainProjectionRequests.attemptCount,
    })
    .from(diagnosisBrainProjectionRequests)
    .where(
      and(
        eq(diagnosisBrainProjectionRequests.id, requestId),
        inArray(diagnosisBrainProjectionRequests.status, ["pending", "failed"]),
        eq(diagnosisBrainProjectionRequests.isDeleted, false),
      ),
    );
  return processRequests(db, requests, at);
}

/** 未処理のprojection要求を再試行します。 */
export async function processPendingDiagnosisBrainProjections(
  db: D1Client,
  { at = new Date(), limit = 25 }: { at?: Date; limit?: number } = {},
): Promise<ProcessDiagnosisBrainProjectionsResult> {
  const requests = await db
    .select({
      id: diagnosisBrainProjectionRequests.id,
      diagnosisResponseId: diagnosisBrainProjectionRequests.diagnosisResponseId,
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
    .limit(limit);
  return processRequests(db, requests, at);
}

async function processRequests(
  db: D1Client,
  requests: ProjectionRequest[],
  at: Date,
): Promise<ProcessDiagnosisBrainProjectionsResult> {
  let applied = 0;
  let skippedIncomplete = 0;
  let failed = 0;
  for (const request of requests) {
    try {
      const result = await applyRequest(db, request, at);
      if (result === "skipped-incomplete") skippedIncomplete += 1;
      else applied += 1;
    } catch (error) {
      failed += 1;
      await db
        .update(diagnosisBrainProjectionRequests)
        .set({
          status: "failed",
          attemptCount: request.attemptCount + 1,
          nextAttemptAt: new Date(at.getTime() + 5 * 60 * 1000),
          failureCode: error instanceof Error ? error.name : "unknown",
          updatedAt: at,
        })
        .where(eq(diagnosisBrainProjectionRequests.id, request.id));
    }
  }
  return { processed: requests.length, applied, skippedIncomplete, failed };
}
