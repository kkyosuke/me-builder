# 「友達との距離感・付き合い方」パラメータ変換設計

## 1. 目的と正本

この文書は「友達との距離感・付き合い方」診断について、質問を結果パラメータへ変換する定義、重み、表示条件、Relationship Categoryを定める正本です。共通の計算手順と設定形式は[診断回答のパラメータ変換設計](parameter-scoring-design.md)、質問文は[人間関係の価値観 Yes／No質問集 §3.24](../content/relationship-values-yes-no-question-bank.md#324-友達との距離感付き合い方)を正とします。

## 2. 診断する傾向

この診断は、友達との関係でどのような距離と付き合い方を望むかを次の5軸で表します。

| Parameter ID | 表示名 | 低い側 | 高い側 |
| --- | --- | --- | --- |
| `friend-contact` | 連絡のきっかけ | 用事があるときに連絡したい | 用事がなくても自分から連絡したい |
| `friend-planning` | 会う予定の決め方 | 直前に柔軟に決めたい | 早めに相談して決めたい |
| `friend-disclosure` | 悩みの共有 | 聞かれるまで自分からは話さない | 自分から早めに話したい |
| `friend-circle` | 友達同士のつながり | それぞれ別に付き合いたい | 機会を作って紹介したい |
| `friend-conflict-timing` | 違和感を話す時期 | 一度整理してから話したい | その場で確かめたい |

どちらの側にも優劣を付けず、社交性、友達の多さ、関係の親密さ、友情の良し悪しは推定しません。

## 3. 質問ごとの重み

Choice Scoreは「はい」を`1`、「いいえ」を`-1`とし、質問ごとの重みを掛けます。

| Question ID | 対象Parameter | Weight |
| --- | --- | ---: |
| `q-friendship-style-01` | `friend-contact` | 1 |
| `q-friendship-style-02` | `friend-contact` | -1 |
| `q-friendship-style-03` | `friend-planning` | 1 |
| `q-friendship-style-04` | `friend-planning` | -1 |
| `q-friendship-style-05` | `friend-disclosure` | 1 |
| `q-friendship-style-06` | `friend-disclosure` | -1 |
| `q-friendship-style-07` | `friend-circle` | 1 |
| `q-friendship-style-08` | `friend-circle` | -1 |
| `q-friendship-style-09` | `friend-conflict-timing` | 1 |
| `q-friendship-style-10` | `friend-conflict-timing` | -1 |

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
| 中央の総合表示 | 状況に応じて友達との付き合い方を選ぶ |

## 5. Relationship Category

Relationship Categoryは`friend`とします。すべての質問が、友達との連絡、予定、悩みの共有、友達同士の紹介、違和感を話す時期を前提にしているためです。友達の人数、付き合いの長さ、オンラインか対面かは固定しません。
