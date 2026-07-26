---
number: 6
title: design: 設計順序 step 6 — Source RecordとBrain Itemの永続化・検索方式を設計する
status: todo
priority: medium
labels: [design]
dependson: [7, 8]
related: []
created_at: 2026-07-26T06:52:23.985095+00:00
updated_at: 2026-07-26T11:27:38.199029+00:00
---

## 背景

`docs/infrastructure-architecture.md` で D1 / Vectorize / R2 / KV / Workers AI は既に確定しているが、Source ドメインおよび Brain Item をそれらへどう写すか（テーブル定義、Drizzle スキーマ、マイグレーション、Vectorize インデックス設計）は未設計。`packages/lib/src/d1/schema/` には現時点で `accounts` と `account_identities` しか存在しない。

設計順序 step 3（#4）で「原本 = R2、構造 = D1、検索 = Vectorize」という `docs/infrastructure-architecture.md` §5 の既存原則のまま乗ることは確認済み。テーブル定義には踏み込んでいない。

## やること

- Source Record（原本・kind・Import / Batch）と Brain Item のドメインモデルを D1 のテーブル定義へ写す
- 根拠・反証・改訂のエッジの永続化（#7 で確定済み。`docs/evidence-edge-design.md` §3 の4つのエッジ型と、§4 の属性2つ＋根拠固有の「導出契機か否か」）
  - `Confidence` は事前計算して Brain Item に持ち、外部へ開示した値を監査のため記録する（`docs/evidence-edge-design.md` §5）。この2つの置き場所も決める
  - 改訂で置き換えられた旧版は保持したうえで検索対象から外す（`docs/evidence-edge-design.md` §7）。Vectorize 側で最新版だけを候補にできること
- Brain Item と Access Label / Access Policy の永続化方式、および Source Record の Access Label
- Brain Item の Embedding を Vectorize へ載せる際のメタデータとフィルター（認可ラベルによる検索前フィルターが成立すること）
- 日記に添えた画像や取り込んだメディア原本を R2 に置く際のメタデータと参照方法
- 原本の削除・訂正の波及（#8 で決めた規則）を制約または手続きとして表現する
- Drizzle スキーマとマイグレーションの実装

## 前提

- 依存: #7（根拠のエッジの種類。完了。`docs/evidence-edge-design.md` が SSoT）、#8（原本と派生の区別）
- `docs/brain-access-label-design.md` §7-4「検索候補を作る時点で許可されていない情報を除外する」を実装可能な形で満たすこと
