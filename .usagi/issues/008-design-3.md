---
number: 8
title: design: 原本と派生の区別（原本の不変性、訂正・削除の波及）を設計する（論点3）
status: done
priority: high
labels: [design, docs]
dependson: [7]
related: []
created_at: 2026-07-26T10:56:30.725520+00:00
updated_at: 2026-07-31T23:33:02.999602+00:00
---

## 背景

設計順序 step 3（#4）で Source Record を原本、Brain Item をそこからの派生として位置づけたが、**原本の不変性と、原本の訂正・削除が派生した Brain Item へ及ぼす影響は未決**のまま残した（`docs/domain-design.md` §5「現時点で決めないこと」、§6「この関係で決めていないこと」）。

`docs/project-overview.md` §8 は「ユーザーが回答の訂正、削除、エクスポートを行える」ことを約束しており、`docs/project-overview.md` §4 のチャネル分担でも「回答・日記の一覧確認、修正、削除」を Web の担当としている。削除の波及規則がないと、削除した原本を根拠にした Brain Item が残りうる。

論点2（#7）でエッジ型が確定した（`docs/evidence-edge-design.md`）。この issue に直結するのは次の2点。

- **Source Record 間の改訂関係が MVP 側**として確定した（`docs/evidence-edge-design.md` §3）。改訂は Source Record 間と Brain Item 間の2つの別関係で、MVP で先に必要なのは Source Record 間。訂正で「原本を上書きするのか、旧版を残して改訂エッジで繋ぐのか」がこの issue の判断対象になる
- **改訂された旧版は保持し、検索対象から外す**、**旧版の開示条件は改訂鎖上の全版の最も厳しい Access Policy** が確定済み（`docs/evidence-edge-design.md` §7）。削除・訂正の波及規則はこれと矛盾しないこと

## やること

- Source Record の原本を不変とするか、訂正で上書きするかを決める
  - #4 で「本人の訂正は新しい Source Record を生む」ことは確定済み。#7 で「Source Record 間の改訂エッジ」も確定済み。残っているのは既存の原本の実体をどう扱うか
- 原本を削除したとき、それを根拠にする Brain Item をどうするか
  - 根拠が1件しかない Brain Item は、`docs/domain-design.md` §6 の「全 Brain Item は1件以上の根拠を持つ」を満たせなくなる。削除・無効化・根拠の付け替えのいずれにするか
  - 根拠が複数ある Brain Item の Confidence への影響。`Confidence` はエッジ集合からの派生値で事前計算・記録される（`docs/evidence-edge-design.md` §5）ため、エッジが消えたときの再計算のタイミングも決める
- 日記の取り消し（`docs/project-overview.md` §4 で LINE から行える）と削除の違い
- エクスポートに原本と派生のどちらを含めるか

## 前提

- #7（根拠のエッジの種類）は完了。`docs/evidence-edge-design.md` §3 / §7 が SSoT

## スコープ外

- 物理削除・論理削除の実装方式と保存期間（#6 および `docs/project-overview.md` §12「時期を定めずに残すこと」）
- エッジの種類と属性そのもの（#7 で確定済み）
