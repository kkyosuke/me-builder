/**
 * スワイプアンケートの質問・回答の型。
 *
 * この型は **`apps/web` に閉じています**。`packages/shared` へ置くとアプリ間で共有する
 * 契約＝サーバーとのスキーマを確定したことになり、[設計スコープのルール §2](../../../../.agents/rules/design-scope.md)
 * が後続設計へ延期している「質問（アンケート）の具体的なエンティティや集約」「API の
 * 具体的なスキーマ」に踏み込んでしまいます。共有先は質問配信・回答保存を実装する時点で決めます。
 */

/**
 * カードへ表示するアイコンの識別子。
 *
 * 質問データには lucide-react のコンポーネントそのものを持たせず名前だけを持たせます。
 * こうすると質問データが JSON のまま扱えて、後でサーバー配信へ差し替えられます。
 * 名前からコンポーネントへの対応は表示層（`src/components/survey-icon.tsx`）が持ちます。
 */
export type SurveyIconName =
  | "house"
  | "mountain"
  | "book"
  | "zap"
  | "user"
  | "users"
  | "sun"
  | "moon"
  | "leaf"
  | "music"
  | "heart"
  | "calculator"
  | "coffee"
  | "clock"
  | "circle-check"
  | "circle-x";

/** スワイプの方向。左右の 2 択に対応します。 */
export type SwipeDirection = "left" | "right";

/** 1 つの選択肢。`SurveyQuestion` 経由で参照するため、単体では公開しません。 */
interface SurveyChoice {
  /** 回答として記録するChoiceの識別子。表示文言（`label`）とは分けます。 */
  choiceId: string;
  label: string;
  icon: SurveyIconName;
}

/** 1 問 1 画面で表示する質問。 */
export interface SurveyQuestion {
  /** Survey内の項目を識別するID。 */
  surveyQuestionId: string;
  /** Surveyをまたいで同じ質問を追跡するID。 */
  questionId: string;
  /**
   * 質問の版。公開済みの質問文は書き換えず、改訂は新しい版として追加し、既存の回答は
   * 回答した時点の版を指し続けます（[プロジェクト概要 §4](../../../../docs/project-overview.md#4-想定する利用体験)）。
   */
  questionVersion: number;
  text: string;
  /** 補足。1 問 1 画面なので短く保ちます。 */
  hint?: string;
  left: SurveyChoice;
  right: SurveyChoice;
}

/** 1問に対する現在の回答。 */
export type SurveyAnswer = {
  kind: "answer";
  surveyQuestionId: string;
  questionId: string;
  questionVersion: number;
  choiceId: string;
  direction: SwipeDirection;
  /** 現在は画面での確定時刻。API接続後はサーバーが受理した時刻を使います。 */
  acceptedAt: string;
};

/** 「あとで回答」は回答内容ではなく、SurveyResponse上の進捗です。 */
export type DeferredQuestion = {
  kind: "deferred";
  surveyQuestionId: string;
  deferredAt: string;
};

/** 回答画面で発生する、回答または延期の操作。 */
export type SurveyInteraction = SurveyAnswer | DeferredQuestion;
