---
number: 8
title: design: 原本と派生の区別（原本の不変性、訂正・削除の波及）を設計する（論点3）
status: todo
priority: high
labels: [design, docs]
dependson: [7]
related: []
created_at: 2026-07-26T10:56:30.725520+00:00
updated_at: 2026-07-26T10:56:30.725520+00:00
---

## 背景

設計順序 step 3（#4）で Source Record を原本、Brain Item をそこからの派生として位置づけたが、**原本の不変性と、原本の訂正・削除が派生した Brain Item へ及ぼす影響は未決**のまま残した（`docs/domain-design.md` §5「現時点で決めないこと」、§6「この関係で決めていないこと」）。

`docs/project-overview.md` §8 は「ユーザーが回答の訂正、削除、エクスポートを行える」ことを約束しており、`docs/project-overview.md` §4 のチャネル分担でも「回答・日記の一覧確認、修正、削除」を Web の担当としている。削除の波及規則がないと、削除した原本を根拠にした Brain Item が残りうる。

## やること

- Source Record の原本を不変とするか、訂正で上書きするかを決める（#4 で「本人の訂正は新しい Source Record を生む」ことは確定済み。既存の原本をどう扱うかが残っている）
- 原本を削除したとき、それを根拠にする Brain Item をどうするか
  - 根拠が1件しかない Brain Item は、`docs/domain-design.md` §6 の「全 Brain Item は1件以上の根拠を持つ」を満たせなくなる。削除・無効化・根拠の付け替えのいずれにするか
  - 根拠が複数ある Brain Item の Confidence への影響
- 日記の取り消し（`docs/project-overview.md` §4 で LINE から行える）と削除の違い
- エクスポートに原本と派生のどちらを含めるか

## 前提

- 依存: #7（根拠のエッジの種類）。波及規則はエッジ上で表現されるため

## スコープ外

- 物理削除・論理削除の実装方式と保存期間（#6 および `docs/project-overview.md` §12「時期を定めずに残すこと」）
