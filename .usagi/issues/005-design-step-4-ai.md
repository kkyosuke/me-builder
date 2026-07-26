---
number: 5
title: design: 設計順序 step 4 — AI による推定と本人確認の流れを設計する
status: todo
priority: medium
labels: [design, docs]
dependson: [4]
related: []
created_at: 2026-07-26T06:52:11.414004+00:00
updated_at: 2026-07-26T06:52:11.414004+00:00
---

## 背景

設計順序 step 3（質問・回答ドメイン）で、本人の回答を由来として Brain Item を導く境界と、`unclassified` / 未確認状態の扱いは定義される。一方で「AI がどう推定し、本人がどう確認するか」の具体的な流れは step 4 として延期されている。

## やること

- 回答から Brain Item 候補を導く推定処理の入出力と根拠の保持方法
- 本人確認（Confirmation）を求める UI 上のタイミングと単位
- `docs/brain-content-taxonomy.md` §9-7「AI 推定をどの時点で Brain Item として有効化するか」への答え
- `docs/brain-access-label-design.md` §8「派生情報の扱い」の具体化
- 推定結果と根拠のモデル（`.agents/rules/design-scope.md` §2 の延期対象）

## 前提

- 依存: 質問・回答ドメインの SSoT 文書
- スコープ外: 永続化方式（step 6）
