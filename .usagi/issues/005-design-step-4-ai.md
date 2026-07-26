---
number: 5
title: design: 設計順序 step 4 — AIによる推定と本人確認の流れを設計する
status: todo
priority: medium
labels: [design, docs]
dependson: [7]
related: []
created_at: 2026-07-26T06:52:11.414004+00:00
updated_at: 2026-07-26T10:57:15.321060+00:00
---

## 背景

設計順序 step 3（#4）で、Source Record から Brain Item を導く関係は確定した。すべての Brain Item は1件以上の Source Record を根拠（`Evidence`）に持ち、導出方法（`Derivation` = `ai` / `deterministic`）を1つ持つ（`docs/domain-design.md` §6、`docs/brain-content-taxonomy.md` §4）。

一方で「AI がどう推定し、本人がどう確認するか」の具体的な流れは step 4 として延期されている。

## やること

- Source Record から Brain Item 候補を導く推定処理の入出力と、根拠の保持方法
- 本人確認（`Confirmation`）を求める UI 上のタイミングと単位
  - #4 で「承認・却下は Source Record を生まず `Confirmation` の更新のみ」と確定済み。この切り分けに沿った UI にする
- `Confidence` を根拠と導出方法からどう導くか（派生値とするか）、監査のために開示した値をどう記録するか、本人の認識との乖離をどう見せるか（`docs/domain-design.md` §6「この関係で決めていないこと」）
- `docs/brain-content-taxonomy.md` §9-7「AI 推定をどの時点で Brain Item として有効化するか」への答え
- `docs/brain-content-taxonomy.md` §8 の MVP 分類のうち、どれを Phase 2 で導出対象にするか
- `docs/brain-access-label-design.md` §11-1 / §11-2（Access Label の初期候補を決める方法、本人へ確認を求めるタイミング）への答え
- `docs/brain-access-label-design.md` §8「派生情報の扱い」の具体化
- 推定結果と根拠のモデル（`.agents/rules/design-scope.md` §2 の延期対象）

## 前提

- 依存: #7（根拠のエッジの種類）。推定処理はエッジを書き込むため、エッジ型が決まっていないと入出力を定義できない
- スコープ外: 永続化方式（#6）
