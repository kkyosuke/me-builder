---
number: 6
title: design: 設計順序 step 6 — 質問・回答と Brain Item の永続化・検索方式を設計する
status: todo
priority: medium
labels: [design]
dependson: [4]
related: []
created_at: 2026-07-26T06:52:23.985095+00:00
updated_at: 2026-07-26T06:52:23.985095+00:00
---

## 背景

`docs/infrastructure-architecture.md` で D1 / Vectorize / R2 / KV / Workers AI は既に確定しているが、質問・回答ドメインおよび Brain Item をそれらへどう写すか（テーブル定義、Drizzle スキーマ、マイグレーション、Vectorize インデックス設計）は未設計。`packages/lib/src/d1/schema/` には現時点で `accounts` と `account_identities` しか存在しない。

## やること

- 質問・回答ドメインのドメインモデルを D1 のテーブル定義へ写す
- Brain Item と Access Label / Access Policy の永続化方式
- Brain Item の Embedding を Vectorize へ載せる際のメタデータとフィルター（認可ラベルによる検索前フィルターが成立すること）
- 画像回答のメディア原本を R2 に置く際のメタデータと参照方法
- Drizzle スキーマとマイグレーションの実装

## 前提

- 依存: 質問・回答ドメインの SSoT 文書
- `docs/brain-access-label-design.md` §7-4「検索候補を作る時点で許可されていない情報を除外する」を実装可能な形で満たすこと
