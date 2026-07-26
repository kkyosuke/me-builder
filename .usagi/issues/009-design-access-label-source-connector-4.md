---
number: 9
title: design: 外部連携時のAccess Label既定値とSource Connectorを設計する（論点4）
status: todo
priority: medium
labels: [design, docs]
dependson: [4]
related: []
created_at: 2026-07-26T10:56:47.943111+00:00
updated_at: 2026-07-26T10:56:47.943111+00:00
---

## 背景

設計順序 step 3（#4）で、取り込み時と導出時の既定 Access Label を確定した（`docs/brain-access-label-design.md` §6）。

| 対象 | 既定 |
| --- | --- |
| Source Record | `private` |
| 導出された Brain Item | `unclassified` |

一方で、**外部サービスから取り込む場合の詳細は未決**のまま残した（`docs/domain-design.md` §5 / §6、`docs/brain-access-label-design.md` §4）。購買履歴や移動履歴は本人が1件ずつ内容を確認していないため、本人が書いた日記と同じ扱いにできるかを別に判断する必要がある。

## やること

- 外部から取り込んだ Source Record に対して、機微度（`normal` / `sensitive` / `highly_sensitive`）と外部提供可否をどう決めるか
  - `docs/brain-access-label-design.md` §4 は現在 Brain Item 前提で Access Policy の要素を定義している。Source Record にどこまで同じ要素を適用するか
- 取り込み元ごとに既定の機微度を変えるか（決済履歴と移動履歴で異なるか）
- Source Connector の登録・停止のモデルと、Account が持つ同意との対応（`docs/domain-design.md` §3 の「MCP接続の許可、変更、解除」と同じ枠組みに載せられるか）
- 大量の履歴を取り込むときの Import / Batch の属性
- `docs/brain-access-label-design.md` §11-1「質問内容から Access Label の初期候補を決める方法」を、取り込み元からの初期候補まで広げるか

## 前提

- `docs/brain-access-label-design.md` §5 の初期プリセットに `private` を許可する外部向け Access Profile は存在しない（意図した状態）
- `docs/project-overview.md` §8「初期状態は非公開とし、外部提供は明示的な同意を必要とする」

## スコープ外

- 外部サービスの API 仕様・認証実装
- MCP 側の権限スコープ（#5 / 設計順序 step 5）
