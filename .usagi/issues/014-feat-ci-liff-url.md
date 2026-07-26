---
number: 14
title: feat(ci): LIFF アプリのエンドポイント URL をデプロイ時に自動登録する
status: todo
priority: medium
labels: [ci, web, line]
dependson: []
related: [11, 13]
created_at: 2026-07-26T13:32:25.301046+00:00
updated_at: 2026-07-26T13:32:25.301046+00:00
---

## 背景

LIFF アプリのエンドポイント URL は LINE Developers コンソールでの手動設定になっていた（#11 の PR 説明に手順を記載）。一方 Webhook Endpoint URL は既に `MessagingApiClient.setWebhookEndpoint` でデプロイ時に自動登録している（[開発運用ルール §4](../../.agents/rules/development.md)）。

LIFF にも **LIFF Server API** があるため、Webhook と同じ形で「今デプロイした URL」を LIFF アプリへ反映できる。

- `GET https://api.line.me/liff/v1/apps` — 一覧
- `POST https://api.line.me/liff/v1/apps` — 追加（LIFF ID が発行される）
- `PUT https://api.line.me/liff/v1/apps/{liffId}` — 更新（`view.url` など）

いずれも **LINE Login チャネル** のチャネルアクセストークンを要求する（Messaging API チャネルのトークンでは操作できない）。

## やったこと

- `packages/lib/src/line/liff.ts` に `line.liff.registerEndpoint` を追加（`line.webhook.register` と同じ流儀）
  - client credentials でチャネルアクセストークンを発行。**ステートレストークン**（15 分・発行数上限なし）を優先し、失敗時は短命トークンのエンドポイントへフォールバックする
  - `LIFF_ID` が一致するアプリ、無ければ `description` が一致するアプリの `view.url` / `view.type` を更新する。どちらも無ければ新規作成し、発行された LIFF ID をログへ出力する
  - URL とビューが既に一致している場合は更新しない（冪等）
  - 環境変数が足りない場合は警告のみでスキップする
  - チャネルシークレット・チャネルアクセストークンはログへ出力せず、トークンエンドポイントのレスポンス本文も転記しない
- `apps/web/scripts/register-liff.ts` を追加し、CD のデプロイ後に `bun --cwd apps/web scripts/register-liff.ts <preview|production>` として実行する
  - 環境名は引数で渡す。`config.environment` はビルド時の値なので、preview と production が同じ `description` を掴んでしまう
- `cd-preview.yml` / `cd-production.yml` に `LINE_LOGIN_CHANNEL_ID` / `LINE_LOGIN_CHANNEL_SECRET` を渡し、登録ステップを追加
- `.agents/rules/development.md` §4 に運用ルールを追記
- `packages/lib` に単体テスト（更新 / 作成 / 冪等 / フォールバック / スキップ / シークレット非出力）を追加

## 環境変数

| 名前 | 種別 | 状態 |
| --- | --- | --- |
| `LINE_LOGIN_CHANNEL_SECRET` | Secret | `dev` に設定済み（2026-07-26）。`prd` は未設定 |
| `LINE_LOGIN_CHANNEL_ID` | 変数 | 未設定。未設定の場合は `LIFF_ID` の接頭辞（`{チャネルID}-{ランダム}`）から補完する |

## 補足: 検証方法

LIFF Server API の仕様は公式ドキュメントで確認したが、チャネルアクセストークンの発行エンドポイントの詳細（ステートレス / 短命）はドキュメントページが折りたたみのため取得できなかった。そのため実装ではステートレス → 短命の順に試し、**どちらが通ったかが CD のログでわかる**ようにしている。

## 完了条件

- [ ] CD の preview 実行で LIFF アプリのエンドポイント URL が更新されることをログで確認する
- [ ] `prd` へ `LINE_LOGIN_CHANNEL_SECRET` を設定する
- [ ] チャネルシークレット・トークンがログに出ていないことを確認する
- [ ] `task ci` が成功する
