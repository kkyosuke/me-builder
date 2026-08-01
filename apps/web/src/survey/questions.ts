import { RELATIONSHIP_PRIORITY_QUESTIONS } from "./relationship-priority";
import type { SurveyQuestion } from "./types";

/**
 * 質問の取得。
 *
 * **今はフロント側の固定データを返します。** 質問配信と回答保存のサーバー実装は後続で、
 * 差し替え先をこのモジュールに閉じるため関数として切り出しています。呼び出し側は
 * 非同期の取得としてだけ扱い、固定データであることに依存しません。
 *
 * 最初のアンケートは「自分と相手の優先・境界線」の10問です。質問文と変換規則は
 * `relationship-priority.ts`にまとめ、公開済みの版を後から書き換えません。
 */
export async function fetchSurveyQuestions(): Promise<SurveyQuestion[]> {
  return RELATIONSHIP_PRIORITY_QUESTIONS;
}
