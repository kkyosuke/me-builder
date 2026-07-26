---
number: 4
title: design: Phase 2 — 日記・アンケート回答とBrain Itemの対応づけを設計する（設計順序 step 3）
status: todo
priority: high
labels: [design, docs]
dependson: []
related: []
created_at: 2026-07-26T06:52:00.033413+00:00
updated_at: 2026-07-26T07:18:28.464521+00:00
---

## 背景

設計順序 step 1（Phase 1 の利用体験）で、Phase 1 は「LINE での日記入力」と「Web でのスワイプアンケート」の2本立てとし、**入力から蓄積までに AI を使わない**ことを確定した（`docs/project-overview.md` §4）。

そのため、蓄積したデータを分身を構成する情報（Brain Item）へどう対応づけるかは Phase 2 で設計する。`docs/domain-design.md` §8 の step 3 に対応する。

## やること

新しい SSoT 文書を `docs/` に追加し、`.agents/README.md` のドキュメントマップへ登録する。少なくとも次を扱う。

1. **日記（自由記述）とアンケート回答（選択）の構造**: 保持する単位、改訂・削除、スキップと「あとで回答」
2. **質問の構造と版管理**: 出題順や次の質問の選び方の責務（Phase 1 の運用実態を踏まえて定義する）
3. **回答と Brain Item の関係**（設計の核心）
   - 回答は Brain Item そのものか、Brain Item の由来か
   - `docs/brain-content-taxonomy.md` §4 の共通属性（Source / Confidence / Confirmation / Valid Time / Stability / Revision）が本人の入力由来の場合にどう埋まるか
   - 1 つの回答から複数の Brain Item が導かれる場合、および回答が修正された場合の既存 Brain Item の扱い
   - `docs/brain-content-taxonomy.md` §8 の MVP 分類との対応
4. **Access Label の初期候補**: `docs/brain-access-label-design.md` §11-1 / §11-2 への答え。§9 の不変条件（`unclassified` は外部 MCP へ提供しない、AI だけで公開範囲を広げない、ラベル判定前の本文を LLM へ送らない）に矛盾しないこと
5. **Account / Brain との境界**: 質問・回答が Account と Brain のどちらに属するか、あるいは独立ドメインとするか

## 前提

- Phase 1 の入力体験とログイン手段は `docs/project-overview.md` §4 / §5 で確定済み
- `.agents/rules/design-scope.md` §2 でこの範囲は Phase 2 へ明示的に延期されている

## スコープ外

- D1 テーブル定義・マイグレーション・スキーマ実装（step 6 → #6）
- AI 推定と本人確認の詳細フロー（step 4 → #5）
