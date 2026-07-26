---
number: 1
title: fix(api): LINE Webhook の x-line-signature 署名検証を追加
status: done
priority: high
labels: [security, api]
dependson: []
related: []
created_at: 2026-07-26T06:45:37.372421+00:00
updated_at: 2026-07-26T07:15:47.752998+00:00
---

## 背景

`apps/api/src/index.ts` の `POST /api/line/webhook` は、リクエストボディを無検証で受け取り Cloudflare Queues へ投入していた。リポジトリ全体に `x-line-signature` を検証するコードが存在しなかった。

このため第三者がエンドポイントへ任意の LINE Webhook 形式ペイロードを POST すると、以下を誘発できた。

- Queue へのメッセージ投入（`apps/worker` が消費する）
- `replyToken` を使った LINE Messaging API への返信送信の試行
- `follow` イベントを装った `account_identities` への upsert（`apps/worker/src/logic/feature/line.ts`）

## ゴール

LINE プラットフォームから送られたリクエストだけを受理する。

## やったこと

1. `LINE_CHANNEL_SECRET` を環境変数・設定として追加
   - `apps/api/src/config/schema.ts` / `apps/api/src/config/index.ts`（既存の Valibot + `getEnv` の流儀に準拠）
   - `apps/api/.env.example` に追記
   - `apps/api/wrangler.toml` には Secret の配布方法をコメントで明記（平文コミットを避けるため値は置かない）
   - CD ワークフロー（`cd-preview.yml` / `cd-production.yml`）で `wrangler secret put` により `apps/api` へ配布。未設定ならデプロイを失敗させる
2. `packages/lib/src/line/webhook.ts` に `line.webhook.verifySignature` を追加
   - 公式 SDK `@line/bot-sdk` の `validateSignature`（HMAC-SHA256 + `timingSafeEqual`）に委譲
   - SDK が使う `node:crypto` は `nodejs_compat` 有効の workerd 上で動作することを実機確認したため、Web Crypto フォールバックは不要と判断
3. `POST /api/line/webhook` を検証必須化
   - `await c.req.text()` の生ボディ文字列に対して検証し、通過後に `JSON.parse`
   - ヘッダ欠落・不一致は 401、Queue 投入も返信も行わない
   - 拒否時は `logger.warn`（署名値・チャネルシークレットは出力しない）

## 採用した未設定時の方針

レビュー（PR #18）での指摘を受け、**環境を問わず一切スキップしない**方針を採用。

| 環境 | 挙動 |
| --- | --- |
| `local` / `preview` / `production` / その他すべて | `LINE_CHANNEL_SECRET` 未設定なら `logger.error` を出力し、全リクエストを 401 で拒否 |

ローカルでオウム返しの動作確認を行う場合も `.env` にチャネルシークレットの設定が必要。

## 受け入れ条件

- [x] 正しい署名の POST は 200 で Queue に入る
- [x] 署名が誤っている / ヘッダが無い POST は 401 で、Queue 投入・LINE 返信・D1 書き込みがいずれも発生しない
- [x] `packages/lib` に署名検証関数の単体テスト（正常系・不一致・ヘッダ欠落ほか）
- [x] `apps/api` に webhook エンドポイントのテスト（200 / 401）
- [x] `task ci` が通る
- [x] `wrangler dev`（workerd 実機）での E2E 確認

## PR

<https://github.com/kkyosuke/me-builder/pull/18>
