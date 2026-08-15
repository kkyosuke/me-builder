# 「家族の期待と自分の選択」パラメータ変換設計

## 1. 目的と正本

この文書は「家族の期待と自分の選択」診断について、質問を結果パラメータへ変換する定義、重み、表示条件、Relationship Categoryを定める正本です。共通の計算手順と設定形式は[診断回答のパラメータ変換設計](parameter-scoring-design.md)、質問文は[人間関係の価値観 Yes／No質問集 §3.27](../content/relationship-values-yes-no-question-bank.md#327-家族の期待と自分の選択)を正とします。

## 2. 診断する傾向

この診断は、今後に関わる選択をするときに家族の意向をどのように取り入れたいかを次の5軸で表します。

| Parameter ID | 表示名 | 低い側 | 高い側 |
| --- | --- | --- | --- |
| `family-choice-consultation` | 大きな選択の相談 | 自分の考えを固めてから話したい | 早い段階で家族に相談したい |
| `family-career-direction` | 進路を選ぶ基準 | 自分の関心を優先したい | 家族の安心を優先したい |
| `family-work-change-agreement` | 働き方を変えるとき | 自分の判断で進めたい | 家族の納得を得て進めたい |
| `family-partnership-agreement` | 交際・結婚の選択 | 自分の判断で進めたい | 家族の納得を待ちたい |
| `family-residence-priority` | 住む場所を選ぶ基準 | 自分の生活条件を優先したい | 家族との近さを優先したい |

どちらの側にも優劣を付けず、家族への愛情、家族関係の良し悪し、自立性、成熟度、意思決定能力は推定しません。交際、結婚、転職、転居の予定や経験が実際にあることも推定しません。

## 3. 質問ごとの重み

Choice Scoreは「はい」を`1`、「いいえ」を`-1`とし、質問ごとの重みを掛けます。

| Question ID | 対象Parameter | Weight |
| --- | --- | ---: |
| `q-family-expectation-choice-01` | `family-choice-consultation` | 1 |
| `q-family-expectation-choice-02` | `family-choice-consultation` | -1 |
| `q-family-expectation-choice-03` | `family-career-direction` | 1 |
| `q-family-expectation-choice-04` | `family-career-direction` | -1 |
| `q-family-expectation-choice-05` | `family-work-change-agreement` | 1 |
| `q-family-expectation-choice-06` | `family-work-change-agreement` | -1 |
| `q-family-expectation-choice-07` | `family-partnership-agreement` | 1 |
| `q-family-expectation-choice-08` | `family-partnership-agreement` | -1 |
| `q-family-expectation-choice-09` | `family-residence-priority` | 1 |
| `q-family-expectation-choice-10` | `family-residence-priority` | -1 |

各軸を、同じ状況に対して向きの異なる2問で確認します。回答が食い違う場合はスコアが中央へ寄り、選択の条件によって家族の意向の取り入れ方が変わることを表します。この重みはversion 1の仮説であり、公開後に変更する場合は既存設定を更新せず新しいversionを追加します。

## 4. 表示設定

| 項目 | 値 |
| --- | --- |
| 設定version | 1 |
| Choice Score | `yes: 1`, `no: -1` |
| 最低Coverage | 60% |
| 低い側 | 0〜35 |
| 中央 | 36〜64 |
| 高い側 | 65〜100 |
| 中央の総合表示 | 選択に応じて家族の意向を取り入れる |

## 5. Relationship Category

Relationship Categoryは`family`とします。すべての質問が、回答時に思い浮かべた家族への相談や、家族の意向が関わる選択を前提にしているためです。特定の続柄、家族構成、同居、家族との近居、交際や結婚の経験は固定しません。
