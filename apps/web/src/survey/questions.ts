import type { SurveyQuestion } from "./types";

/**
 * 質問の取得。
 *
 * **今はフロント側のモックを返します。** 質問配信と回答保存のサーバー実装は後続で、
 * 差し替え先をこのモジュールに閉じるため関数として切り出しています。呼び出し側は
 * 非同期の取得としてだけ扱い、モックであることに依存しません。
 *
 * 質問は運営（me-builder 側）が作成・審査・更新し、ユーザーによる質問作成は提供しません
 * （[プロジェクト概要 §4](../../../../docs/project-overview.md#4-想定する利用体験)）。
 */
export async function fetchSurveyQuestions(): Promise<SurveyQuestion[]> {
  return MOCK_QUESTIONS;
}

/**
 * モックの質問。
 *
 * Phase 1 は入力から蓄積までに AI を使わないため、質問文は固定の文言です
 * （[プロジェクト概要 §4](../../../../docs/project-overview.md#4-想定する利用体験)）。
 * 版は 1 から始めます。
 */
const MOCK_QUESTIONS: SurveyQuestion[] = [
  {
    id: "q-holiday-style",
    version: 1,
    text: "予定のない休日、どちらに近い過ごし方をしますか？",
    hint: "どちらも当てはまるときは、より多い方で選んでください",
    left: { value: "stay-home", label: "家でゆっくり", icon: "house" },
    right: { value: "go-out", label: "外へ出かける", icon: "mountain" },
  },
  {
    id: "q-new-thing",
    version: 1,
    text: "新しいことを始めるとき、先にどちらをしますか？",
    left: { value: "research-first", label: "じっくり調べる", icon: "book" },
    right: { value: "try-first", label: "まず試す", icon: "zap" },
  },
  {
    id: "q-recharge",
    version: 1,
    text: "気持ちが整うのは、どちらの時間ですか？",
    left: { value: "alone", label: "ひとりの時間", icon: "user" },
    right: { value: "with-others", label: "誰かと話す時間", icon: "users" },
  },
  {
    id: "q-time-of-day",
    version: 1,
    text: "調子が出るのは、朝と夜のどちらですか？",
    left: { value: "morning", label: "朝", icon: "sun" },
    right: { value: "night", label: "夜", icon: "moon" },
  },
  {
    id: "q-work-sound",
    version: 1,
    text: "集中したいとき、まわりの音はどちらがいいですか？",
    left: { value: "quiet", label: "静かなほうがいい", icon: "leaf" },
    right: { value: "music", label: "音楽があるほうがいい", icon: "music" },
  },
  {
    id: "q-decision-basis",
    version: 1,
    text: "迷ったとき、決め手になるのはどちらですか？",
    hint: "正解はありません。いまの自分に近い方を選んでください",
    left: { value: "feeling", label: "自分の気持ち", icon: "heart" },
    right: { value: "facts", label: "数字と事実", icon: "calculator" },
  },
];
