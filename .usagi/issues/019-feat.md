---
number: 19
title: feat: スワイプ診断の質問配信と回答保存をサーバー側へ実装する
status: todo
priority: medium
labels: [api, web, design]
dependson: [17]
related: []
created_at: 2026-07-27T21:52:28.036692+00:00
updated_at: 2026-07-27T21:52:28.036692+00:00
---

## 背景

issue #17 でスワイプ診断の回答 UI を実装したが、質問は `apps/web/src/diagnosis/questions.ts` の**フロント側のモック**で、回答はどこにも保存されない。UI 側は `fetchDiagnosisQuestions()` をモジュール境界として切ってあるので、取得部分の差し替えで済む形になっている。

サーバー側まで踏み込むには、UI 実装だけでは決められない設計判断が必要なため、#17 から意図的に切り出した。

## ドメイン設計で確定したこと

[Phase 1 診断ドメイン設計](../../docs/diagnosis/diagnosis-domain-design.md)で、サーバー実装の前提となる次の事項を確定した。

- `Question`、`Diagnosis`、`DiagnosisResponse` の3集約
- DiagnosisはapprovedのQuestion Versionを固定して参照し、公開後は変更しない
- 1つのAccountとDiagnosisの組み合わせにDiagnosisResponseは最大1件
- 1問の回答は1件のSource Recordとし、修正では新しいSource Recordと改訂関係を作る
- スキップはAnswerおよびSource RecordではなくDiagnosisResponseの進捗として記録する
- 回答の主体は検証済みの本人性から解決し、クライアント指定のAccount IDを使わない

## 実装前に残っていること

- D1のテーブル、制約、インデックス
- APIのスキーマとエンドポイント
- 継続するAPI呼び出しで本人性を再利用するサーバー発行セッション方式
- DiagnosisResponse更新とSource Record作成の一貫性、再送、競合制御

## やること（上記が決まった後）

1. 質問の取得と回答の保存のエンドポイントを `apps/api` へ追加する（controller / logic の分離は [開発運用ルール §4](../../.agents/rules/development.md)）
2. D1 のスキーマとマイグレーションを `packages/lib` へ追加する
3. `apps/web/src/diagnosis/questions.ts` の取得をサーバー呼び出しへ差し替える
4. 型を `packages/shared` へ移すか `apps/web` に閉じたままにするかを、この時点で判断する（#17 では API が無いため `apps/web` に閉じている）
5. 通信失敗・オフライン時の扱いと、回答の再送を決める

## 完了条件

- [ ] 質問がサーバーから配信される
- [ ] 回答がSource Record、スキップがDiagnosisResponseの進捗として保存され、回答した時点の質問の版が残る
- [ ] 回答の主体が、クライアントから送られた識別子ではなく検証済みの本人性から解決される
- [ ] `task ci` が成功する
