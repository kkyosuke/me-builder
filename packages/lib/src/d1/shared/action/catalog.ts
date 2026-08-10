import { and, asc, eq } from "drizzle-orm";
import type { SharedD1Client } from "../client";
import {
  diagnoses,
  diagnosisQuestions,
  questionChoices,
  questions as questionRoots,
  questionVersions,
} from "../schema/catalog";

export type DiagnosisDetail = Readonly<{
  id: string;
  title: string;
  description: string;
  opensAt: string;
  closesAt: string | null;
  questions: Array<{
    diagnosisQuestionId: string;
    questionId: string;
    questionVersion: number;
    text: string;
    hint: string | null;
    choices: Array<{
      choiceId: string;
      label: string;
    }>;
  }>;
}>;

export type DiagnosisDetailResult =
  | { type: "found"; diagnosis: DiagnosisDetail }
  | { type: "not-found" }
  | { type: "closed" };

/**
 * 新規回答用のDiagnosis詳細を、Diagnosisが固定したQuestion Versionのまま取得します。
 * 非公開状態は存在有無を秘匿してnot-foundへ寄せ、受付終了だけを区別します。
 */
export async function findOpenDiagnosisDetail(
  db: SharedD1Client,
  diagnosisId: string,
  at: Date,
): Promise<DiagnosisDetailResult> {
  const [diagnosis] = await db
    .select({
      id: diagnoses.id,
      title: diagnoses.title,
      description: diagnoses.description,
      opensAt: diagnoses.opensAt,
      closesAt: diagnoses.closesAt,
      state: diagnoses.state,
      isDeleted: diagnoses.isDeleted,
    })
    .from(diagnoses)
    .where(eq(diagnoses.id, diagnosisId))
    .limit(1)
    .all();

  if (
    !diagnosis ||
    diagnosis.isDeleted ||
    diagnosis.state !== "published" ||
    diagnosis.opensAt.getTime() > at.getTime()
  ) {
    return { type: "not-found" };
  }
  if (diagnosis.closesAt && diagnosis.closesAt.getTime() <= at.getTime()) {
    return { type: "closed" };
  }

  const rows = await db
    .select({
      diagnosisQuestionId: diagnosisQuestions.id,
      questionId: diagnosisQuestions.questionId,
      questionVersion: diagnosisQuestions.questionVersion,
      text: questionVersions.text,
      hint: questionVersions.hint,
      choiceId: questionChoices.choiceId,
      choiceLabel: questionChoices.label,
    })
    .from(diagnosisQuestions)
    .innerJoin(
      questionRoots,
      and(eq(questionRoots.id, diagnosisQuestions.questionId), eq(questionRoots.isDeleted, false)),
    )
    .innerJoin(
      questionVersions,
      and(
        eq(questionVersions.questionId, diagnosisQuestions.questionId),
        eq(questionVersions.version, diagnosisQuestions.questionVersion),
        eq(questionVersions.isDeleted, false),
      ),
    )
    .innerJoin(
      questionChoices,
      and(
        eq(questionChoices.questionId, diagnosisQuestions.questionId),
        eq(questionChoices.questionVersion, diagnosisQuestions.questionVersion),
        eq(questionChoices.isDeleted, false),
      ),
    )
    .where(
      and(eq(diagnosisQuestions.diagnosisId, diagnosisId), eq(diagnosisQuestions.isDeleted, false)),
    )
    .orderBy(asc(diagnosisQuestions.position), asc(questionChoices.position))
    .all();

  const questions: DiagnosisDetail["questions"] = [];
  for (const row of rows) {
    const previous = questions.at(-1);
    const choice = {
      choiceId: row.choiceId,
      label: row.choiceLabel,
    };
    if (previous?.diagnosisQuestionId === row.diagnosisQuestionId) {
      previous.choices.push(choice);
    } else {
      questions.push({
        diagnosisQuestionId: row.diagnosisQuestionId,
        questionId: row.questionId,
        questionVersion: row.questionVersion,
        text: row.text,
        hint: row.hint,
        choices: [choice],
      });
    }
  }

  return {
    type: "found",
    diagnosis: {
      id: diagnosis.id,
      title: diagnosis.title,
      description: diagnosis.description,
      opensAt: diagnosis.opensAt.toISOString(),
      closesAt: diagnosis.closesAt?.toISOString() ?? null,
      questions,
    },
  };
}
