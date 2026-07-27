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
  | "clock";

/** スワイプの方向。左右の 2 択に対応します。 */
export type SwipeDirection = "left" | "right";

/** 1 つの選択肢。 */
export interface SurveyChoice {
  /** 回答として記録する値。表示文言（`label`）とは分けます。 */
  value: string;
  label: string;
  icon: SurveyIconName;
}

/** 1 問 1 画面で表示する質問。 */
export interface SurveyQuestion {
  id: string;
  /**
   * 質問の版。公開済みの質問文は書き換えず、改訂は新しい版として追加し、既存の回答は
   * 回答した時点の版を指し続けます（[プロジェクト概要 §4](../../../../docs/project-overview.md#4-想定する利用体験)）。
   */
  version: number;
  text: string;
  /** 補足。1 問 1 画面なので短く保ちます。 */
  hint?: string;
  left: SurveyChoice;
  right: SurveyChoice;
}

/**
 * 1 問に対する回答。
 *
 * スキップ（あとで回答）も回答の入力形式の 1 つです
 * （[プロジェクト概要 §3.1](../../../../docs/project-overview.md#31-多様な質問に回答する)）。
 * 「選択しなかった」と「まだ表示していない」を区別できるよう、状態ではなく union で表現します。
 */
export type SurveyAnswer =
  | {
      kind: "choice";
      questionId: string;
      questionVersion: number;
      /** 選んだ選択肢の `value` */
      value: string;
      direction: SwipeDirection;
      answeredAt: string;
    }
  | {
      kind: "skipped";
      questionId: string;
      questionVersion: number;
      answeredAt: string;
    };
