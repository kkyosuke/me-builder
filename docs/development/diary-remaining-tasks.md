# 日記入力残タスク

## 1. 目的

この文書は、LINEでの日記入力について、設計で確定済みだが未実装の項目を管理します。

### 所有する概念

- 日記入力に残っている未実装項目
- 各項目を完了とする条件

### 所有しない概念

- 送信取り消し・撤回・削除の意味と対象範囲
- 日記の入力体験とチャネルごとの役割分担
- Webhookの受信、署名検証、Queue処理の設計

送信取り消しと撤回の規則は[Source Recordのライフサイクル設計 §7](../domain/source/source-record-lifecycle-design.md#7-日記の取り消しと撤回)、入力体験とチャネルの役割分担は[プロジェクト概要 §4](../product/project-overview.md#4-想定する利用体験)を正とします。

## 2. MVPの残タスク

### 2.1 日記の写真添付を公開する

現状、保存実装はfeature flagで閉じているため、公開中のimageメッセージは原本保存とAI入力の対象外です。本人には読み込めない旨を返信します。受付境界の詳細は[日記チャット実装設計 §5.1](../architecture/diary-chat-implementation-design.md#51-受付から原本保存)を正とします。

受付、保存、第三者情報、moderation、削除、AI利用の境界は[LINE写真日記入力設計](../architecture/photo-diary-input-design.md)で確定しています。保存段階はfeature flag付きで実装済みであり、[マルチモーダル入力実装残タスク](multimodal-input-remaining-tasks.md)がProduction公開前の法務・規約gateと実環境検証だけを管理します。flag無効時はLINEからcontentを取得せず、対象外mediaをQueue、Source Record、AI入力へ渡しません。flag有効時も写真をAI入力へ渡しません。

- media入力を扱う重要規約改定と法務確認を完了する
- PreviewでLINE実端末、障害再試行、容量超過、閲覧、削除を確認する
- release checklistへ証跡を残し、保存flagを環境ごとに有効化する

完了条件は、[マルチモーダル入力実装残タスク §3](multimodal-input-remaining-tasks.md#3-保存段階の公開残タスク)のrelease gateを完了し、[LINE写真日記入力設計の受け入れ条件](../architecture/photo-diary-input-design.md#9-観測と受け入れ条件)を実環境で満たすことです。写真のbinary exportは初期提供に含めません。

## 3. V2の残タスク

### 3.1 日記の送信取り消し（unsend）を実装する

現状、LINEのunsendイベントは処理されず破棄され、Source Recordを削除済みtombstoneへ遷移させるアクションも存在しません。

- Webhookのunsendイベントを受け付け、対象の日記を特定する
- 対象の日記を削除済みtombstoneへ遷移させるアクションを追加する
- 取り消された日記がチャット文脈とBrain Item生成の入力から除外されることを確認する

完了条件は、[Source Recordのライフサイクル設計 §7](../domain/source/source-record-lifecycle-design.md#7-日記の取り消しと撤回)が定める送信取り消しの対象範囲と結果を満たすことです。

## 4. 更新ルール

- 未完了の項目だけをこの文書へ残し、完了した項目は削除する
- 実装作業はIssueまたはPRへ移し、この文書にはリンクと未完了の確認事項だけを残す
- 取り消し・撤回の規則や入力体験を変更する場合は、先にそれぞれのSSoTを更新する
- すべての項目が完了したら、この文書とドキュメントマップのリンクを同じ変更で削除する
