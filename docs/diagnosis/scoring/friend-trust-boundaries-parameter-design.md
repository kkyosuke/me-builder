# 「友達との信頼・秘密・境界線」パラメータ変換設計

## 1. 目的と正本

この文書は「友達との信頼・秘密・境界線」診断について、質問を結果パラメータへ変換する定義、重み、表示条件、Relationship Categoryを定める正本です。共通の計算手順と設定形式は[診断回答のパラメータ変換設計](parameter-scoring-design.md)、質問文は[人間関係の価値観 Yes／No質問集 §3.28](../content/relationship-values-yes-no-question-bank.md#328-友達との信頼秘密境界線)を正とします。

## 2. 診断する傾向

この診断は、友達の個人的な情報と自分の境界をどのように扱いたいかを次の5軸で表します。

| Parameter ID | 表示名 | 低い側 | 高い側 |
| --- | --- | --- | --- |
| `friend-private-story-sharing` | 個人的な話の共有 | 共有範囲を状況で判断したい | 本人に確認してから共有したい |
| `friend-advice-permission` | 別の人へ相談するとき | 匿名にして相談したい | 本人に確認してから相談したい |
| `friend-photo-consent` | 写真を公開するとき | 事前合意の範囲で公開したい | 写真ごとに確認したい |
| `friend-promise-change-notice` | 約束変更の共有 | 変更が決まってから伝えたい | 可能性の段階で伝えたい |
| `friend-boundary-response` | 個人的な質問への境界 | あとで落ち着いて伝えたい | その場で伝えたい |

どちらの側にも優劣を付けず、友達への誠実さ、信頼関係の強さ、秘密を守れるかどうか、社交性は推定しません。実際に秘密を共有された経験、写真を投稿した経験、約束を変更した経験があることも推定しません。

## 3. 質問ごとの重み

Choice Scoreは「はい」を`1`、「いいえ」を`-1`とし、質問ごとの重みを掛けます。

| Question ID | 対象Parameter | Weight |
| --- | --- | ---: |
| `q-friend-trust-boundaries-01` | `friend-private-story-sharing` | 1 |
| `q-friend-trust-boundaries-02` | `friend-private-story-sharing` | -1 |
| `q-friend-trust-boundaries-03` | `friend-advice-permission` | 1 |
| `q-friend-trust-boundaries-04` | `friend-advice-permission` | -1 |
| `q-friend-trust-boundaries-05` | `friend-photo-consent` | 1 |
| `q-friend-trust-boundaries-06` | `friend-photo-consent` | -1 |
| `q-friend-trust-boundaries-07` | `friend-promise-change-notice` | 1 |
| `q-friend-trust-boundaries-08` | `friend-promise-change-notice` | -1 |
| `q-friend-trust-boundaries-09` | `friend-boundary-response` | 1 |
| `q-friend-trust-boundaries-10` | `friend-boundary-response` | -1 |

各軸を、同じ状況に対して向きの異なる2問で確認します。回答が食い違う場合はスコアが中央へ寄り、友達や状況によって共有範囲や境界の示し方を変えることを表します。この重みはversion 1の仮説であり、公開後に変更する場合は既存設定を更新せず新しいversionを追加します。

## 4. 表示設定

| 項目 | 値 |
| --- | --- |
| 設定version | 1 |
| Choice Score | `yes: 1`, `no: -1` |
| 最低Coverage | 60% |
| 低い側 | 0〜35 |
| 中央 | 36〜64 |
| 高い側 | 65〜100 |
| 中央の総合表示 | 状況に応じて友達との境界を調整する |

## 5. Relationship Category

Relationship Categoryは`friend`とします。すべての質問が、回答時に思い浮かべた友達との情報共有、約束、個人的な境界を前提にしているためです。友達の人数、付き合いの長さ、対面かオンラインか、特定のグループへの所属は固定しません。
