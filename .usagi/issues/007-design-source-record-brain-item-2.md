---
number: 7
title: design: Source RecordとBrain Itemを結ぶ根拠のエッジの種類を設計する（論点2）
status: todo
priority: high
labels: [design, docs]
dependson: [4]
related: []
created_at: 2026-07-26T10:56:20.409142+00:00
updated_at: 2026-07-26T10:56:20.409142+00:00
---

## 背景

設計順序 step 3（#4）で Source Record と Brain Item の対応が **M:N**、かつ **全 Brain Item は1件以上の Source Record を根拠に持つ**ことを確定した（`docs/domain-design.md` §6）。一方で、その根拠を表現する**エッジの種類とその属性は意図的に未決**とし、`docs/brain-content-taxonomy.md` §4 の `Evidence` は「Source Record を1件以上示す」だけを定義している。

エッジ型が決まらないと、#5（AI 推定と本人確認）と #6（永続化）が具体化できない。

## やること

- 根拠のエッジに種類が必要かを判断する（例: 直接の記述 / 集計の入力 / 解釈の材料 / 訂正の対象 など。種類を設けない選択も含めて判断する）
- エッジが持つ属性（導出時点、寄与の強さ、どの導出処理が作ったか）を決める
- 1つの導出が複数の Source Record を根拠にする場合、Derivation（`ai` / `deterministic`）をエッジ側とBrain Item側のどちらが持つかを確定する
  - `docs/brain-content-taxonomy.md` §4 では「`ai` が1件でも混ざれば Brain Item の Derivation は `ai`」と安全側に固定済み。この固定と矛盾しない置き方にする
- 本人の訂正が生む Source Record と、訂正前の Brain Item との関係の表し方（`Revision` との役割分担）
- SSoT の置き場所を決める（`docs/domain-design.md` §6 への追記か、Source ドメインの詳細文書を新設するか）

## 前提

- `docs/domain-design.md` §6「この関係で決めていないこと」の1項目め
- `.agents/rules/design-scope.md` §2 で現在は深掘り禁止対象

## スコープ外

- D1 のテーブル定義・マイグレーション（#6）
- 推定処理そのものの入出力（#5）
