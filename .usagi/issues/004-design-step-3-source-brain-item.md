---
number: 4
title: design: 設計順序 step 3 — Sourceドメインを新設しBrain Itemの由来を確定する
status: done
priority: high
labels: [design, docs]
dependson: []
related: []
created_at: 2026-07-26T06:52:00.033413+00:00
updated_at: 2026-07-26T10:56:03.422794+00:00
---

## 背景

もとは「Phase 2 — 日記・診断回答と Brain Item の対応づけ」として起票していたが、着手時に **Brain Item の構造（とくに由来）が未定のままでは単体で答えが出ない**ことが判明した。`docs/domain-design.md` §4「現時点で決めないこと」に「Brain内部の具体的なエンティティや集約」が残った状態で対応づけを設計するのは順序が逆転している。

さらに「日記・診断回答はすべて Brain Item の元となるデータであり、将来は Money Forward や Suica などの購買履歴・移動履歴も取り込む」という要件が加わった。入力はプラガブルな取り込み元であり、生データから Brain Item を導出するモデルになる。このため、取り込み元を限定しない **`Source` domain（主エンティティ `Source Record`）** の新設へスコープを置き換えた。

## 対応内容（完了）

`docs/domain-design.md` を3ドメイン（Account / Brain / Source）構成へ改訂し、次を確定した。

1. **Source は Account / Brain と並ぶ独立ドメイン**。Brain が担当する問いは「その人らしさを構成する情報」であり、乗車履歴そのものは該当しない（§2）
2. **Source Record の粒度** = 取り込み元が自然に区切る単位。まとめ単位は Import / Batch（§5）
3. **Source Record の kind** = 本人入力 / インポートの2値。導出のやり方は含めない（§5）
4. **Source Record ↔ Brain Item は M:N**（§6）
5. **全 Brain Item は必ず1件以上の Source Record を根拠に持つ**（§6）
6. **Brain Item を持たない Source Record を許容**。Phase 1 の既定状態（§6）
7. **本人の操作の切り分け**: 新規記述・訂正は Source Record を生み、承認・却下は Confirmation の更新のみ（§6）
8. **所有者は Account、依存方向は Brain → Source の単方向**、外部コネクタは Account が同意・Source が実体（§6）

`docs/brain-content-taxonomy.md` §4 の共通属性 `Source` を **Evidence（根拠）** と **Derivation（導出方法 `ai` / `deterministic`）** の2つへ分割した。

`docs/brain-access-label-design.md` §6 に既定 Access Label（Source Record = `private`、導出された Brain Item = `unclassified`）を追加した。

## 当初スコープのうち後続へ送った項目

- 回答の改訂・削除が派生 Brain Item へ及ぼす影響 → #8
- 共通属性のうち Confidence の導出と Confirmation の更新タイミング、MVP 分類との対応、Access Label の初期候補 → #5
- 質問（診断）自体のエンティティ・集約 → `.agents/rules/design-scope.md` §2 の延期対象として維持（版管理は `docs/project-overview.md` §4 で確定済み）

## 後続 issue

- #7 根拠を表現するエッジの種類（論点2）
- #8 原本と派生の区別（論点3）
- #9 外部連携時の Access Label 既定値と Source Connector（論点4）
- #10 `brain-access-label-design.md` の改名と参照更新
