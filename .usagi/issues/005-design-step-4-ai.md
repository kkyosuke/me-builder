---
number: 5
title: design: 設計順序 step 4 — AIによる推定と本人確認の流れを設計する
status: todo
priority: medium
labels: [design, docs]
dependson: [7]
related: []
created_at: 2026-07-26T06:52:11.414004+00:00
updated_at: 2026-07-26T11:26:49.031722+00:00
---

## 背景

設計順序 step 3（#4）で、Source Record から Brain Item を導く関係は確定した。すべての Brain Item は1件以上の Source Record を根拠（`Evidence`）に持ち、導出方法（`Derivation` = `ai` / `deterministic`）を1つ持つ（`docs/domain-design.md` §6、`docs/brain-content-taxonomy.md` §4）。

論点2（#7）でエッジ型も確定した（`docs/evidence-edge-design.md`）。推定処理が書き込む先は、根拠・反証・改訂の3関係と、共通属性2つ（導出方法、生成時点）＋根拠固有の「導出契機か否か」である。

一方で「AI がどう推定し、本人がどう確認するか」の具体的な流れは step 4 として延期されている。

## やること

- Source Record から Brain Item 候補を導く推定処理の入出力と、根拠エッジの書き込み方
  - エッジの型と属性は #7 で確定済み（`docs/evidence-edge-design.md` §3 / §4）。この issue で決めるのは処理側の入出力
- 本人確認（`Confirmation`）を求める UI 上のタイミングと単位
  - #4 で「承認・却下は Source Record を生まず `Confirmation` の更新のみ」と確定済み。この切り分けに沿った UI にする
- `Confidence` の具体的な算出方法、閾値、提示のタイミングと UI、本人の認識との乖離をどう見せるか
  - #7 で確定済みの前提（`docs/evidence-edge-design.md` §5 / §6）:
    - SSoT はエッジ集合であり、`Confidence` はそこからの**派生値**。MCP リクエスト時に全エッジを走査せず、**事前計算して Brain Item に持つ**（許可されていないラベルの反証を要求経路で読まないため）
    - **外部へ開示した値は監査のため記録する**（`docs/brain-access-label-design.md` §9-9 / §7 手順7 を満たすため）
    - 外部への開示は**粗い3段階（高 / 中 / 低）固定**。3段階の閾値をどこに置くかで非公開 Source Record の存在推測のしやすさが変わるため、閾値決定時に `docs/evidence-edge-design.md` §6 の代償を再評価する
- 反証を検出する処理の入出力と、反証エッジを張る主体（#7 で型のみ定義し、検出 AI の実装は MVP 必須要件から外した）
- `docs/brain-content-taxonomy.md` §9-7「AI 推定をどの時点で Brain Item として有効化するか」への答え
- `docs/brain-content-taxonomy.md` §8 の MVP 分類のうち、どれを Phase 2 で導出対象にするか
- `docs/brain-access-label-design.md` §11-1 / §11-2（Access Label の初期候補を決める方法、本人へ確認を求めるタイミング）への答え
- `docs/brain-access-label-design.md` §8「派生情報の扱い」の具体化

## 前提

- #7（根拠のエッジの種類）は完了。`docs/evidence-edge-design.md` が SSoT
- スコープ外: 永続化方式（#6）、エッジの種類と属性そのもの（#7 で確定済み）
