# 「仕事の変化・周囲との関わり方」パラメータ変換設計

## 1. 目的と正本

この文書は「仕事の変化・周囲との関わり方」診断について、質問を結果パラメータへ変換する定義、重み、表示条件、Relationship Categoryを定める正本です。共通の計算手順と設定形式は[診断回答のパラメータ変換設計](parameter-scoring-design.md)、質問文は[人間関係の価値観 Yes／No質問集 §3.22](../content/relationship-values-yes-no-question-bank.md#322-仕事の変化周囲との関わり方)を正とします。

## 2. 診断する傾向

この診断は「飽き性」のような固定的な性格や能力を判定しません。回答時に思い浮かべた仕事上の相手と働く場面で、仕事の変化をどの程度求めるか、相手とどのように関わりたいかという希望を次の5軸で表します。

| Parameter ID | 表示名 | 低い側 | 高い側 |
| --- | --- | --- | --- |
| `work-novelty` | 仕事の変化 | 慣れた仕事を深めたい | 新しい役割を試したい |
| `workplace-closeness` | 仕事上の距離 | 必要な連携に絞りたい | 普段から関わりたい |
| `workplace-autonomy` | 進め方の相談 | 相手と方針を決めたい | 自分で判断して進めたい |
| `workplace-feedback` | 意見をもらう頻度 | 節目にもらいたい | こまめにもらいたい |
| `workplace-openness` | 意見の伝え方 | 相手の判断に合わせたい | 自分の考えを伝えたい |

どちらの側にも優劣を付けず、集中力、忠誠心、協調性、仕事の能力、相手との関係の良し悪しは推定しません。

## 3. 質問ごとの重み

Choice Scoreは「はい」を`1`、「いいえ」を`-1`とし、質問ごとの重みを掛けます。

| Question ID | 対象Parameter | Weight |
| --- | --- | ---: |
| `q-work-relationship-style-01` | `work-novelty` | 1 |
| `q-work-relationship-style-02` | `work-novelty` | -1 |
| `q-work-relationship-style-03` | `workplace-closeness` | 1 |
| `q-work-relationship-style-04` | `workplace-closeness` | -1 |
| `q-work-relationship-style-05` | `workplace-autonomy` | 1 |
| `q-work-relationship-style-06` | `workplace-autonomy` | -1 |
| `q-work-relationship-style-07` | `workplace-feedback` | 1 |
| `q-work-relationship-style-08` | `workplace-feedback` | -1 |
| `q-work-relationship-style-09` | `workplace-openness` | 1 |
| `q-work-relationship-style-10` | `workplace-openness` | -1 |

各軸を向きの異なる2問で確認します。回答が食い違う場合はスコアが中央へ寄り、状況によって希望が変わることを表します。この重みはversion 1の仮説であり、公開後に変更する場合は既存設定を更新せず新しいversionを追加します。

## 4. 表示設定

| 項目 | 値 |
| --- | --- |
| 設定version | 1 |
| Choice Score | `yes: 1`, `no: -1` |
| 最低Coverage | 60% |
| 低い側 | 0〜35 |
| 中央 | 36〜64 |
| 高い側 | 65〜100 |
| 中央の総合表示 | 状況に応じて仕事での関わり方を選ぶ |

## 5. Relationship Category

Relationship Categoryは`work`とします。すべての質問が、回答時に思い浮かべた仕事上の相手との業務選択、普段の会話、進め方の相談、意見をもらう頻度、会議での意見の相違という場面を前提にしているためです。同僚、上司、部下、取引先など、役職や立場を固定しません。
