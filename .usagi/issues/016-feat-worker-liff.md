---
number: 16
title: feat(worker): リッチメニューを LIFF への常設導線として自動登録する
status: todo
priority: medium
labels: [worker, line, ci]
dependson: [15]
related: []
created_at: 2026-07-26T13:48:33.810053+00:00
updated_at: 2026-07-26T13:49:18.992894+00:00
---

## 背景

Issue #15 で日記の受付返信に LIFF のリンクを添えたが、これは**日記を送ったときにしか出てこない**導線。トーク画面をいつ開いても入れる常設の入口としてリッチメニューを用意する。

[プロジェクト概要 §4](../../docs/project-overview.md#4-想定する利用体験) の「チャネルごとの役割分担」では、LINE は「アンケートの回答」についてリンクを配信する役割、Web は回答・一覧・公開範囲設定を担当する役割になっている。リッチメニューはこの役割分担の範囲内（LINE から Web へ送り出すだけ）に収める。

## やること

1. リッチメニューの構成を決める。少なくとも「今日のアンケート（LIFF URL）」と「これまでの回答を見る（Web URL）」の 2 面を想定する。タップ領域の座標とサイズを決める
2. 画像を用意する（推奨サイズ 2500x1686 など）。`docs/assets/characters/` にうつし・ミラのアセットがあるため、[キャラクターデザイン](../../docs/character-design.md)の設定と揃える。置き場所と命名規則も同文書に従う
3. Messaging API で登録する。Webhook 自動登録と同じく CD から実行する
   - `createRichMenu` → `uploadRichMenuImage`（画像アップロードのみ `api-data.line.me`）→ `setDefaultRichMenu`
   - ロジックは `packages/lib` の `line` 配下へ置き、単体テストを付ける
   - 既に同じ内容が設定されている場合は再登録しない（冪等にする）。リッチメニューはチャネルあたりの上限があるため、作成したまま放置しない
4. 環境変数が未設定の場合は警告のみでスキップする（既存方針と揃える）

## 検討事項

- preview と production でリッチメニューを分けるか。同じ Messaging API チャネルを使っている場合、`setDefaultRichMenu` は**チャネル全体に効く**ため、preview のデプロイが production の表示を書き換えてしまう。チャネル構成を確認してから実装する
- 外部ブラウザ向けの Web URL（`https://kagami.kyosuke.dev` など）と LIFF URL の使い分け

## 完了条件

- [ ] トーク画面にリッチメニューが表示され、タップで LIFF が開く
- [ ] 同じ内容での再デプロイでリッチメニューが増えない（冪等）
- [ ] preview のデプロイが production の表示を壊さない
- [ ] `task ci` が成功する
