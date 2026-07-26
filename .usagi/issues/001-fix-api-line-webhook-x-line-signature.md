---
number: 1
title: fix(api): LINE Webhook の x-line-signature 署名検証を追加
status: todo
priority: high
labels: [security, api]
dependson: []
related: []
created_at: 2026-07-26T06:45:37.372421+00:00
updated_at: 2026-07-26T06:45:37.372421+00:00
---

## 背景

`apps/api/src/index.ts` の `POST /api/line/webhook` は、リクエストボディを無検証で受け取り Cloudflare Queues へ投入している。リポジトリ全体に `x-line-signature` を検証するコードが存在しない（`grep -rniE "signature|x-line" apps packages --include='*.ts'` が 0 件）。

このため第三者がエンドポイントへ任意の LINE Webhook 形式ペイロードを POST すると、以下を誘発できる。

- Queue へのメッセージ投入（`apps/worker` が消費する）
- `replyToken` を使った LINE Messaging API への返信送信の試行
- `follow` イベントを装った `account_identities` への upsert（`apps/worker/src/logic/feature/line.ts`）

## ゴール

LINE プラットフォームから送られたリクエストだけを受理する。

## やること

1. `LINE_CHANNEL_SECRET` を環境変数・設定として追加する
   - `apps/api/src/config/schema.ts` / `apps/api/src/config/index.ts` に追加（既存の Valibot + `getEnv` の流儀に合わせる）
   - `apps/api/wrangler.toml` の各環境（local / preview / production）と、CD ワークフロー（`.github/workflows/cd-preview.yml`, `cd-production.yml`）の secret 受け渡しを更新する
   - `apps/api/.env.example` に追記する
2. `packages/lib/src/line/webhook.ts` に署名検証関数を追加する
   - `@line/bot-sdk` の `validateSignature` を優先して利用する。Cloudflare Workers 上で動かない場合のみ Web Crypto (`crypto.subtle` の HMAC-SHA256) でフォールバック実装する
   - 比較は timing-safe に行う
   - `webhook` オブジェクトの export に追加する
3. `POST /api/line/webhook` を検証必須にする
   - **raw body 文字列**に対して検証する。`c.req.json()` の結果を再 stringify してはならない。`await c.req.text()` を取得し、検証通過後に `JSON.parse` する
   - `x-line-signature` ヘッダ欠落・不一致は **401** を返し、Queue 投入も返信もしない
   - 拒否時は `logger.warn` で構造化ログを出す。**署名値やチャネルシークレットそのものをログに含めない**
   - `LINE_CHANNEL_SECRET` 未設定時の挙動を決めて実装する。既存の「未設定ならログを出して安全にスキップ」の流儀に倣ってよいが、その場合は `logger.warn` を必ず出す。**本番環境（production）では未設定を許容せず拒否する**方針を推奨。採用した方針は PR 概要に明記する

## 受け入れ条件

- 正しい署名の POST は従来どおり 200 で Queue に入る
- 署名が誤っている / ヘッダが無い POST は 401 で、Queue 投入・LINE 返信・D1 書き込みがいずれも発生しない
- `packages/lib` に署名検証関数の単体テスト（正常系・不一致・ヘッダ欠落）がある
- `apps/api` に webhook エンドポイントのテスト（200 / 401）がある
- `task ci` が通る

## 制約

- スコープはこの署名検証のみ。Brain ドメインや質問・回答機能には手を出さない
- `.agents/rules/development.md` の開発運用ルールに従う
- PR は `docs/pull-request-guidelines.md` と `.github/PULL_REQUEST_TEMPLATE.md` に従って作成する
