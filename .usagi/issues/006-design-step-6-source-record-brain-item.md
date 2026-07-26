---
number: 6
title: design: 設計順序 step 6 — Source RecordとBrain Itemの永続化・検索方式を設計する
status: todo
priority: medium
labels: [design]
dependson: [7, 8]
related: []
created_at: 2026-07-26T06:52:23.985095+00:00
updated_at: 2026-07-26T10:57:24.186705+00:00
---

## 背景

`docs/infrastructure-architecture.md` で D1 / Vectorize / R2 / KV / Workers AI は既に確定しているが、Source ドメインおよび Brain Item をそれらへどう写すか（テーブル定義、Drizzle スキーマ、マイグレーション、Vectorize インデックス設計）は未設計。`packages/lib/src/d1/schema/` には現時点で `accounts` と `account_identities` しか存在しない。

設計順序 step 3（#4）で「原本 = R2、構造 = D1、検索 = Vectorize」という `docs/infrastructure-architecture.md` §5 の既存原則のまま乗ることは確認済み。テーブル定義には踏み込んでいない。

## やること

- Source Record（原本・kind・Import / Batch）と Brain Item のドメインモデルを D1 のテーブル定義へ写す
- Source Record と Brain Item を結ぶ根拠のエッジの永続化（M:N。#7 で決めたエッジ型に従う）
- Brain Item と Access Label / Access Policy の永続化方式、および Source Record の Access Label
- Brain Item の Embedding を Vectorize へ載せる際のメタデータとフィルター（認可ラベルによる検索前フィルターが成立すること）
- 日記に添えた画像や取り込んだメディア原本を R2 に置く際のメタデータと参照方法
- 原本の削除・訂正の波及（#8 で決めた規則）を制約または手続きとして表現する
- Drizzle スキーマとマイグレーションの実装

## 前提

- 依存: #7（根拠のエッジの種類）、#8（原本と派生の区別）
- `docs/brain-access-label-design.md` §7-4「検索候補を作る時点で許可されていない情報を除外する」を実装可能な形で満たすこと
