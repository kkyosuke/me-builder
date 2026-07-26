---
number: 10
title: docs: brain-access-label-design.md をBrain / Source共通のSSoTへ改名し参照を更新する
status: todo
priority: medium
labels: [docs]
dependson: [4]
related: []
created_at: 2026-07-26T10:56:57.012661+00:00
updated_at: 2026-07-26T11:27:26.571087+00:00
---

## 背景

設計順序 step 3（#4）で Access Label の適用対象が Brain Item だけでなく Source Record にも広がったため、`docs/brain-access-label-design.md` を **Brain と Source に共通の SSoT** として改名する方針を決定した（同文書 §1 に記録済み）。

改名は機械的な変更なので、設計内容の変更と混ぜるとレビューが困難になる。#4 の PR ではあえて実行せず、この issue へ分離した。

## やること

- ファイル名と文書タイトルを、Brain 限定でない名前へ変更する
- リポジトリ全体の参照を更新する（`rg` で旧ファイル名を検索して残さない）
- `.agents/README.md` のドキュメントマップと `README.md` のリンクを更新する
- `docs/infrastructure-architecture.md` §2「所有しない概念」と §7「関連ドキュメント」のリンクを更新する
- `docs/evidence-edge-design.md`（#7 で新設）のリンクを更新する。§1 の「所有しない概念」表、§4 / §5 / §6 / §7 から節番号つきで参照している

## 既知のリスク: 節番号の参照

**節構成と節番号を変えないこと。** 次の箇所が節番号で参照しているため、番号がずれると参照が壊れる。

- `docs/project-overview.md` §12 → `brain-access-label-design.md#11-今後決めること`
- `docs/evidence-edge-design.md` → §5 / §7 / §8 / §9 / §11
- `.usagi/issues/004` → §11-1 / §11-2 / §9
- `.usagi/issues/005` → §8
- `.usagi/issues/006` → §7-4

節番号を変える必要が出た場合は、これらの参照も同じ変更で更新する。

## 完了条件

- `bun run lint:md` と `bun run lint:md:links` が成功する
- 旧ファイル名がリポジトリ内に残っていない
