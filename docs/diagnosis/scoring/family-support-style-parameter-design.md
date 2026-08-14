# 「家族との距離感・支え合い」パラメータ変換設計

## 1. 目的と正本

この文書は「家族との距離感・支え合い」診断について、質問を結果パラメータへ変換する定義、重み、表示条件、Relationship Categoryを定める正本です。共通の計算手順と設定形式は[診断回答のパラメータ変換設計](parameter-scoring-design.md)、質問文は[人間関係の価値観 Yes／No質問集 §3.23](../content/relationship-values-yes-no-question-bank.md#323-家族との距離感支え合い)を正とします。

## 2. 診断する傾向

この診断は、回答時に思い浮かべた家族との関係で、どのような距離と支え方を望むかを次の5軸で表します。

| Parameter ID | 表示名 | 低い側 | 高い側 |
| --- | --- | --- | --- |
| `family-contact` | 連絡の頻度 | 必要なときに連絡したい | 普段から連絡したい |
| `family-disclosure` | 悩みの共有 | 必要になるまで自分で整理したい | 早めに家族へ話したい |
| `family-support-approach` | 悩みへの支え方 | 具体策を先に考えたい | 気持ちを先に聞きたい |
| `family-conflict-timing` | 意見を話す時期 | 時間を置いて話したい | その場で話したい |
| `family-planning` | 予定の決め方 | 直前に柔軟に決めたい | 早めに相談して決めたい |

どちらの側にも優劣を付けず、家族への愛情、関係の親密さ、支える能力、家族関係の良し悪しは推定しません。

## 3. 質問ごとの重み

Choice Scoreは「はい」を`1`、「いいえ」を`-1`とし、質問ごとの重みを掛けます。

| Question ID | 対象Parameter | Weight |
| --- | --- | ---: |
| `q-family-support-style-01` | `family-contact` | 1 |
| `q-family-support-style-02` | `family-contact` | -1 |
| `q-family-support-style-03` | `family-disclosure` | 1 |
| `q-family-support-style-04` | `family-disclosure` | -1 |
| `q-family-support-style-05` | `family-support-approach` | 1 |
| `q-family-support-style-06` | `family-support-approach` | -1 |
| `q-family-support-style-07` | `family-conflict-timing` | 1 |
| `q-family-support-style-08` | `family-conflict-timing` | -1 |
| `q-family-support-style-09` | `family-planning` | 1 |
| `q-family-support-style-10` | `family-planning` | -1 |

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
| 中央の総合表示 | 状況に応じて家族との関わり方を選ぶ |

## 5. Relationship Category

Relationship Categoryは`family`とします。すべての質問が、親、子、きょうだいなど、回答時に思い浮かべた家族との連絡、悩みの共有、支え方、意見の相違、予定調整を前提にしているためです。特定の続柄や、同居しているかどうかは固定しません。
