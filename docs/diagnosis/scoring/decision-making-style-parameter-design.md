# 「決め方・迷いとの向き合い方」パラメータ変換設計

## 1. 目的と正本

この文書は「決め方・迷いとの向き合い方」診断について、質問を結果パラメータへ変換する定義、重み、表示条件、Relationship Categoryを定める正本です。共通の計算手順と設定形式は[診断回答のパラメータ変換設計](parameter-scoring-design.md)、質問文は[人間関係の価値観 Yes／No質問集 §3.25](../content/relationship-values-yes-no-question-bank.md#325-決め方迷いとの向き合い方)を正とします。

## 2. 診断する傾向

この診断は、選択肢に迷った場面でどのように決めるかを次の5軸で表します。

| Parameter ID | 表示名 | 低い側 | 高い側 |
| --- | --- | --- | --- |
| `decision-information` | 情報の集め方 | 必要な情報に絞って決めたい | 複数の情報を比べて決めたい |
| `decision-timing` | 決める時期 | 期限近くまで考えたい | 早めに方向を決めたい |
| `decision-intuition` | 判断のよりどころ | 理由を言葉にして選びたい | 最初の感覚を取り入れたい |
| `decision-consultation` | 相談の取り入れ方 | まず自分の考えを固めたい | 決める前に意見を聞きたい |
| `decision-reconsideration` | 決定の見直し | 決めた方針で進めたい | 新しい情報があれば見直したい |

どちらの側にも優劣を付けず、判断力、決断の速さ、慎重さ、知性、主体性、決定の正しさは推定しません。既存診断と近い要素があっても、異なる状況と文言から傾向を確認するための別の観測として扱います。

## 3. 質問ごとの重み

Choice Scoreは「はい」を`1`、「いいえ」を`-1`とし、質問ごとの重みを掛けます。

| Question ID | 対象Parameter | Weight |
| --- | --- | ---: |
| `q-decision-making-style-01` | `decision-information` | 1 |
| `q-decision-making-style-02` | `decision-information` | -1 |
| `q-decision-making-style-03` | `decision-timing` | 1 |
| `q-decision-making-style-04` | `decision-timing` | -1 |
| `q-decision-making-style-05` | `decision-intuition` | 1 |
| `q-decision-making-style-06` | `decision-intuition` | -1 |
| `q-decision-making-style-07` | `decision-consultation` | 1 |
| `q-decision-making-style-08` | `decision-consultation` | -1 |
| `q-decision-making-style-09` | `decision-reconsideration` | 1 |
| `q-decision-making-style-10` | `decision-reconsideration` | -1 |

各軸を、同じ状況に対して向きの異なる2問で確認します。回答が食い違う場合はスコアが中央へ寄り、状況や条件によって決め方が変わることを表します。この重みはversion 1の仮説であり、公開後に変更する場合は既存設定を更新せず新しいversionを追加します。

## 4. 表示設定

| 項目 | 値 |
| --- | --- |
| 設定version | 1 |
| Choice Score | `yes: 1`, `no: -1` |
| 最低Coverage | 60% |
| 低い側 | 0〜35 |
| 中央 | 36〜64 |
| 高い側 | 65〜100 |
| 中央の総合表示 | 状況に応じて決め方を使い分ける |

## 5. Relationship Category

Relationship Categoryは`general`とします。すべての質問が、買い物、申し込み、似た選択肢、初めての経験、決定後の新しい情報など、特定の関係相手を前提にしない本人の意思決定を尋ねるためです。パートナー、家族、友達、仕事上の相手との関係性は推定しません。
