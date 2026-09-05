import { and, asc, eq } from "drizzle-orm";
import { LIKERT_5_LABELS, LIKERT_5_SCORES } from "../../../diagnosis/question-format";
import type { RelationshipCategory } from "../../../diagnosis/relationship-category";
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
  relationshipCategory: RelationshipCategory;
  opensAt: string;
  closesAt: string | null;
  questions: Array<{
    diagnosisQuestionId: string;
    questionId: string;
    questionVersion: number;
    text: string;
    hint: string | null;
    format: "single_choice" | "likert_5";
    backsideOfDiagnosisQuestionId: string | null;
    choices: Array<{
      choiceId: string;
      label: string;
      score: number | null;
    }>;
  }>;
}>;

export type DiagnosisDetailResult =
  | { type: "found"; diagnosis: DiagnosisDetail }
  | { type: "not-found" }
  | { type: "closed" };

/**
 * Diagnosis詳細を、Diagnosisが固定したQuestion Versionのまま取得します。
 * 非公開状態は存在有無を秘匿してnot-foundへ寄せ、受付終了だけを区別します。
 * 回答者であることを呼び出し側が確認した場合だけ、公開停止後の閲覧を許可できます。
 */
export async function findOpenDiagnosisDetail(
  db: SharedD1Client,
  diagnosisId: string,
  at: Date,
  options: { allowWithdrawn?: boolean } = {},
): Promise<DiagnosisDetailResult> {
  const [diagnosis] = await db
    .select({
      id: diagnoses.id,
      title: diagnoses.title,
      description: diagnoses.description,
      relationshipCategory: diagnoses.relationshipCategory,
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
    (diagnosis.state !== "published" &&
      !(options.allowWithdrawn && diagnosis.state === "withdrawn")) ||
    diagnosis.opensAt.getTime() > at.getTime()
  ) {
    return { type: "not-found" };
  }
  if (
    diagnosis.state === "published" &&
    diagnosis.closesAt &&
    diagnosis.closesAt.getTime() <= at.getTime()
  ) {
    return { type: "closed" };
  }

  const rows = await db
    .select({
      diagnosisQuestionId: diagnosisQuestions.id,
      questionId: diagnosisQuestions.questionId,
      questionVersion: diagnosisQuestions.questionVersion,
      text: questionVersions.text,
      hint: questionVersions.hint,
      format: questionVersions.format,
      backsideOfDiagnosisQuestionId: diagnosisQuestions.backsideOfDiagnosisQuestionId,
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
    if (row.format !== "single_choice" && row.format !== "likert_5") {
      throw new Error("Unsupported diagnosis question format in published catalog");
    }
    const previous = questions.at(-1);
    const sameQuestion = previous?.diagnosisQuestionId === row.diagnosisQuestionId;
    const choice = {
      choiceId: row.choiceId,
      label: row.choiceLabel,
      score:
        row.format === "likert_5"
          ? (LIKERT_5_SCORES[sameQuestion ? previous.choices.length : 0] ?? null)
          : null,
    };
    if (sameQuestion) {
      previous.choices.push(choice);
    } else {
      questions.push({
        diagnosisQuestionId: row.diagnosisQuestionId,
        questionId: row.questionId,
        questionVersion: row.questionVersion,
        text: row.text,
        hint: row.hint,
        format: row.format,
        backsideOfDiagnosisQuestionId: row.backsideOfDiagnosisQuestionId,
        choices: [choice],
      });
    }
  }
  if (questions.some((question) => question.format !== questions[0]?.format)) {
    throw new Error("Published diagnosis must not mix question formats");
  }
  if (
    questions.some(
      (question) => question.format === "single_choice" && question.choices.length !== 2,
    )
  ) {
    throw new Error("Published single-choice diagnosis question must have exactly two choices");
  }
  if (
    questions.some(
      (question) =>
        question.format === "likert_5" &&
        (question.choices.length !== LIKERT_5_LABELS.length ||
          question.choices.some(
            (choice, index) =>
              choice.label !== LIKERT_5_LABELS[index] || choice.score !== LIKERT_5_SCORES[index],
          )),
    )
  ) {
    throw new Error("Published likert-5 diagnosis question must use the fixed five choices");
  }
  for (const [index, question] of questions.entries()) {
    if (!question.backsideOfDiagnosisQuestionId) continue;
    const front = questions[index - 1];
    if (
      !front ||
      question.backsideOfDiagnosisQuestionId !== front.diagnosisQuestionId ||
      front.backsideOfDiagnosisQuestionId !== null ||
      front.format !== "single_choice" ||
      question.format !== "single_choice"
    ) {
      throw new Error(
        "Published diagnosis backside must immediately follow a standalone single-choice front",
      );
    }
  }

  return {
    type: "found",
    diagnosis: {
      id: diagnosis.id,
      title: diagnosis.title,
      description: diagnosis.description,
      relationshipCategory: diagnosis.relationshipCategory,
      opensAt: diagnosis.opensAt.toISOString(),
      closesAt: diagnosis.closesAt?.toISOString() ?? null,
      questions,
    },
  };
}
