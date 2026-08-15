# 「仕事の進め方・優先順位」パラメータ変換設計

## 1. 目的と正本

この文書は「仕事の進め方・優先順位」診断について、質問を結果パラメータへ変換する定義、重み、表示条件、Relationship Categoryを定める正本です。共通の計算手順と設定形式は[診断回答のパラメータ変換設計](parameter-scoring-design.md)、質問文は[人間関係の価値観 Yes／No質問集 §3.26](../content/relationship-values-yes-no-question-bank.md#326-仕事の進め方優先順位)を正とします。

## 2. 診断する傾向

この診断は、複数の仕事や期限がある場面でどのように進めるかを次の5軸で表します。

| Parameter ID | 表示名 | 低い側 | 高い側 |
| --- | --- | --- | --- |
| `work-completion-depth` | 仕上げの区切り | 細部を整えてから進みたい | 必要十分で次へ進みたい |
| `work-task-parallelism` | 複数の仕事の進め方 | 一つずつ終えたい | 並行して進めたい |
| `work-deadline-use` | 提出のタイミング | 期限近くまで見直したい | 早めに提出したい |
| `work-reprioritization` | 計画変更への対応 | 当初の計画を保ちたい | 優先順位を組み替えたい |
| `work-progress-sharing` | 途中経過の共有 | 形にしてから共有したい | 早い段階で共有したい |

どちらの側にも優劣を付けず、仕事の速さ、正確さ、生産性、責任感、計画性、協調性、仕事の能力は推定しません。`work-progress-sharing`は自分から最初の進み具合を共有する時期を表し、既存の「仕事の変化・周囲との関わり方」にある、相手から意見をもらう頻度とは区別します。

## 3. 質問ごとの重み

Choice Scoreは「はい」を`1`、「いいえ」を`-1`とし、質問ごとの重みを掛けます。

| Question ID | 対象Parameter | Weight |
| --- | --- | ---: |
| `q-work-priority-style-01` | `work-completion-depth` | 1 |
| `q-work-priority-style-02` | `work-completion-depth` | -1 |
| `q-work-priority-style-03` | `work-task-parallelism` | 1 |
| `q-work-priority-style-04` | `work-task-parallelism` | -1 |
| `q-work-priority-style-05` | `work-deadline-use` | 1 |
| `q-work-priority-style-06` | `work-deadline-use` | -1 |
| `q-work-priority-style-07` | `work-reprioritization` | 1 |
| `q-work-priority-style-08` | `work-reprioritization` | -1 |
| `q-work-priority-style-09` | `work-progress-sharing` | 1 |
| `q-work-priority-style-10` | `work-progress-sharing` | -1 |

各軸を、同じ状況に対して向きの異なる2問で確認します。回答が食い違う場合はスコアが中央へ寄り、状況や条件によって進め方が変わることを表します。この重みはversion 1の仮説であり、公開後に変更する場合は既存設定を更新せず新しいversionを追加します。

## 4. 表示設定

| 項目 | 値 |
| --- | --- |
| 設定version | 1 |
| Choice Score | `yes: 1`, `no: -1` |
| 最低Coverage | 60% |
| 低い側 | 0〜35 |
| 中央 | 36〜64 |
| 高い側 | 65〜100 |
| 中央の総合表示 | 状況に応じて仕事の進め方を選ぶ |

## 5. Relationship Category

Relationship Categoryは`work`とします。すべての質問が、資料の仕上げ、複数の仕事、提出期限、作業計画、新しい依頼、途中経過の共有など仕事の場面を前提にしているためです。上司など特定の役職や立場を固定せず、個人作業と仕事で関わる相手がいる場面の両方を含みます。
