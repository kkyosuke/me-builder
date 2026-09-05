# 「家族との休日：今と理想」パラメータ変換設計

## 1. 目的と正本

この文書は「家族との休日：今と理想」診断について、表裏質問を結果パラメータへ変換する定義、重み、表示条件、Relationship Categoryを定める正本です。共通の計算手順と表裏の観点は[診断回答のパラメータ変換設計](parameter-scoring-design.md)、質問文は[人間関係の価値観 Yes／No質問集 §3.29](../content/relationship-values-yes-no-question-bank.md#329-家族との休日今と理想)を正とします。

## 2. 診断する傾向

この診断は、回答時に思い浮かべた家族との休日について、普段どれくらい一緒の時間を持っているかと、本人がどれくらい持ちたいかを同じ軸で別々に表します。

| Parameter ID | 表示名 | 低い側 | 高い側 |
| --- | --- | --- | --- |
| `family-holiday-togetherness` | 家族と過ごす休日 | それぞれの時間を中心に過ごす | 家族と一緒の時間を持つ |

低い側と高い側のどちらにも優劣を付けません。家族への愛情、関係の親密さ、家族構成、同居の有無、休日の充実度は推定しません。普段と望みの差は改善度や問題の大きさではなく、現在の行動と大切にしたいことの関係として表示します。

## 3. 表裏質問と重み

Choice Scoreは「はい」を`1`、「いいえ」を`-1`とします。すべての質問は同じParameterへ重み`1`で寄与し、表面だけで`behavior`、裏面だけで`desired`を計算します。

| 組 | 表面Question ID | 裏面Question ID | 対象Parameter | 表面Weight | 裏面Weight |
| ---: | --- | --- | --- | ---: | ---: |
| 1 | `q-family-holiday-style-01` | `q-family-holiday-style-02` | `family-holiday-togetherness` | 1 | 1 |
| 2 | `q-family-holiday-style-03` | `q-family-holiday-style-04` | `family-holiday-togetherness` | 1 | 1 |
| 3 | `q-family-holiday-style-05` | `q-family-holiday-style-06` | `family-holiday-togetherness` | 1 | 1 |
| 4 | `q-family-holiday-style-07` | `q-family-holiday-style-08` | `family-holiday-togetherness` | 1 | 1 |
| 5 | `q-family-holiday-style-09` | `q-family-holiday-style-10` | `family-holiday-togetherness` | 1 | 1 |

各組は表面と裏面で対象、場面、行動の軸を同じにし、「多い」という現在の実態と「したい」という望みだけを切り替えます。表面と裏面を逆転項目として扱わず、同じ回答方向が同じParameter方向を表します。

## 4. 表示設定

| 項目 | 値 |
| --- | --- |
| 設定version | 1 |
| Choice Score | `yes: 1`, `no: -1` |
| 最低Coverage | 60% |
| 低い側 | 0〜35 |
| 中央 | 36〜64 |
| 高い側 | 65〜100 |
| 中央の総合表示 | 状況に応じて家族と一緒の時間を持つ |

各観点は5問から計算するため、「はい」の数が0〜1件なら低い側、2〜3件なら中央、4〜5件なら高い側になります。トップレベルの`score`、`coverage`、`band`は`desired`を表し、`behavior`には普段の行動を返します。双方を計算できる場合だけ`comparison`を返します。

相性表示で使う審査済みの関わり方文は次のとおりです。相性表示は主スコアである`desired`の帯域から選びます。

| 帯域 | 関わり方文 |
| --- | --- |
| 低い側 | 休日は、それぞれの時間も大切にできるとうれしいです。 |
| 中央 | 休日の過ごし方を、その時々で相談できるとうれしいです。 |
| 高い側 | 休日に、一緒に過ごす時間を作ってもらえるとうれしいです。 |

## 5. Brain Itemへの変換

`behavior`は`Behavior Pattern`、`desired`は`Preference`として別のBrain Itemへ変換します。どちらも`family-holiday-togetherness`をParameter IDとし、`perspective`で観点を区別します。差分そのものを第三のBrain Itemにはしません。

## 6. Relationship Category

Relationship Categoryは`family`とします。すべての質問が、回答時に思い浮かべた家族との休日を前提にしているためです。特定の続柄、人数、同居、毎週同じ曜日が休日であることは前提にしません。
