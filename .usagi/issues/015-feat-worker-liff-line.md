---
number: 15
title: feat(worker): 日記の返信に LIFF のリンクを添えて LINE から開けるようにする
status: todo
priority: high
labels: [worker, line, web]
dependson: []
related: [11, 14]
created_at: 2026-07-26T13:48:09.217284+00:00
updated_at: 2026-07-26T13:48:09.217284+00:00
---

## 背景

#11 で LIFF の最小疎通を入れたが、**LINE のチャット画面から LIFF を開く導線が存在しなかった**。`apps/worker` は受信したテキストをオウム返しするだけで、LIFF の URL を送っていない。リッチメニューの実装もリポジトリ内に無い。

[プロジェクト概要 §4](../../docs/project-overview.md#4-想定する利用体験) の設計では、LINE が「受け付けたことを返信する」→「『今日のアンケート』のリンクを配信する」流れになっている。オウム返しはこの設計より前のスケルトン挙動なので、設計に合わせる。

## やったこと

- `apps/worker` の返信を、オウム返しから「受け付けた旨 + アンケートへの LIFF リンク」へ変更
  - 文面の組み立ては `buildReplyText` に集約し、単体テストを追加
  - `https://liff.line.me/{LIFF_ID}` をタップすると LINE 内で Web が開く（Web の URL では LINE 内で開かない）
  - `LIFF_ID` が未設定ならリンクを省き、受け付けた旨だけを返す
- `apps/worker` の config に optional な `liffId` を追加（空文字・空白のみは未設定として扱う）
- CD ワークフローで `LIFF_ID` を `apps/worker` へ配布
  - 秘密情報ではないが、GitHub Environment の変数を単一の出所とするため `wrangler secret put` を使う（wrangler には後から var を投入するコマンドが無い）
- オウム返しを前提にしていた記述を更新
  - `.agents/rules/development.md` §4 の見出しと説明
  - `docs/infrastructure-architecture.md` の Queue Worker の説明（返信内容の詳細は開発運用ルールへリンク）
  - `apps/worker/src/index.test.ts` の期待値（本文をオウム返ししないことの回帰確認になる）

## スコープ外

- リッチメニュー（トーク下部の常設導線）→ #16
- Flex Message / ボタンテンプレートによる見た目の改善
- 日記本文の保存（Source Record としての永続化）。現状の返信は受け付けた旨を返すだけで、保存は行っていない

## 完了条件

- [ ] LINE のトークへ日記を送ると、受付返信に LIFF のリンクが付く
- [ ] リンクをタップすると LINE 内で LIFF が開く（実機確認）
- [ ] `LIFF_ID` 未設定時はリンクが付かず、返信自体は行われる
- [x] 本文をオウム返ししない
- [x] `task ci` が成功する
