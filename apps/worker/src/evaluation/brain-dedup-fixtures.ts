import type { DiaryBrainCategory } from "@me-builder/lib";

export type BrainDedupEvaluationFixture = Readonly<{
  id: string;
  category: DiaryBrainCategory;
  candidate: string;
  existing: string;
  sameProposition: boolean;
}>;

/** 実際の日記本文を含まず、誤統合を変更前後で検出する固定評価dataset。 */
export const brainDedupEvaluationFixtures: readonly BrainDedupEvaluationFixture[] = [
  {
    id: "preference-paraphrase",
    category: "preference",
    candidate: "辛い料理はあまり食べられない",
    existing: "辛い食べ物が苦手",
    sameProposition: true,
  },
  {
    id: "preference-related-only",
    category: "preference",
    candidate: "静かな店が好き",
    existing: "一人で食事するのが好き",
    sameProposition: false,
  },
  {
    id: "preference-specificity-differs",
    category: "preference",
    candidate: "果物が好き",
    existing: "青森産のりんごが好き",
    sameProposition: false,
  },
  {
    id: "goal-deadline-differs",
    category: "goal",
    candidate: "今月中に転職先を決めたい",
    existing: "年内に転職先を決めたい",
    sameProposition: false,
  },
  {
    id: "behavior-single-vs-pattern",
    category: "behavior_pattern",
    candidate: "昨日は昼休みに散歩した",
    existing: "昼休みにはよく散歩する",
    sameProposition: false,
  },
  {
    id: "memory-event-differs",
    category: "memory",
    candidate: "月曜日に同僚と昼食を食べた",
    existing: "金曜日に同僚と昼食を食べた",
    sameProposition: false,
  },
  {
    id: "value-action-vs-reason",
    category: "value_motivation",
    candidate: "家族との夕食を優先した",
    existing: "家族が安心できる時間を大切にしている",
    sameProposition: false,
  },
  {
    id: "decision-preference-vs-criterion",
    category: "decision_system",
    candidate: "早く決める方が好き",
    existing: "影響を受ける人を確認してから決める",
    sameProposition: false,
  },
  {
    id: "decision-paraphrase",
    category: "decision_system",
    candidate: "関係者への影響を見てから判断する",
    existing: "影響を受ける人を確認してから決める",
    sameProposition: true,
  },
];
