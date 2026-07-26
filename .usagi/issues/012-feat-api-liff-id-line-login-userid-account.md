---
number: 12
title: feat(api): LIFF の ID トークンを検証し LINE Login の userId を Account へ束ねる
status: todo
priority: high
labels: [api, web, security, line]
dependson: [11]
related: []
created_at: 2026-07-26T12:15:19.097990+00:00
updated_at: 2026-07-26T12:24:17.917476+00:00
---

## 背景

Issue #11 で `apps/web` に LIFF の最小疎通（`liff.init` + `liff.getProfile()` の表示）を入れた。ただしこの時点では **クライアント側が自称するプロフィールを表示しているだけ** で、サーバー側は誰がアクセスしているかを検証していない。回答を Account へ紐づけて保存するには、サーバーが本人性を検証できる必要がある。

あわせて [プロジェクト概要 §5](../../docs/project-overview.md#5-アカウントと本人識別) が次を要確認事項として残している。

> Messaging APIで得られる利用者の識別子とLINE Loginで得られる識別子を同じAccountへ束ねられるかは、LINE側のチャネル設定に依存します。LIFFで取得できる識別子も後者に含まれます。Phase 1の実装ではこの前提を最初に確認します。

LINE 公式アカウントの友だち追加（Messaging API の `userId`）をアカウント作成の起点とする一方、Web / LIFF 側は LINE Login の `userId` を得る。両者が同一の値になるかはプロバイダー配下のチャネル構成に依存するため、実装より先に実機で確認する必要がある。

## やること

### 1. 前提の実機確認（最初に行う）

- LINE Login チャネルと Messaging API チャネルが同一プロバイダー配下にあることを確認する
- 同一ユーザーで「友だち追加時に Webhook で得られる `userId`」と「LIFF の ID トークンから得られる `sub`」を突き合わせ、一致するかを確認する
- 一致しない場合の代替（`liff.getFriendship()` や別の突合手段）を検討し、結論を [プロジェクト概要 §5](../../docs/project-overview.md#5-アカウントと本人識別) へ反映する

### 2. ID トークンの検証

- クライアントは `liff.getIDToken()` を取得し API へ送る
- サーバー（`apps/api`）は ID トークンを検証する。署名・`aud`（LINE Login チャネル ID）・`iss`・`exp` を検証し、`liff.getProfile()` の結果を信頼しない
- 検証ロジックは `packages/lib` の `line` 配下へ置く（`line.webhook.verifySignature` と同じ流儀）
- LINE Login チャネル ID / シークレットの配布は `LINE_CHANNEL_SECRET` の既存手順（`wrangler secret put` / CD ワークフロー / ローカルは `.env`）に揃える。`wrangler.toml` の `[vars]` には置かない

### 3. Account への紐づけ

- 検証済みの `sub` を Account へ束ねる（`apps/worker` の `account_identities` upsert と整合させる）
- Account のドメイン上のルールは [ドメイン設計](../../docs/domain-design.md) を正とする

## セキュリティ上の注意

- ID トークンおよびアクセストークンをログへ出力しない
- `userId` / `sub` は本人識別子なので画面表示せず、ログにも出さない（[プロジェクト概要 §8](../../docs/project-overview.md#8-プライバシーと安全性)）
- 検証失敗は 401 で拒否し、Account への書き込みを行わない

## スコープ外

- スワイプアンケート画面そのものの実装と回答の保存
- 独立 Web（外部ブラウザ）側の LINE Login 実装。LIFF 側の検証が固まってから同じ検証経路へ載せる

## 完了条件

- [ ] Messaging API の `userId` と LINE Login の `sub` の関係が実機で確認され、結論が SSoT へ反映されている
- [ ] 改ざんした / 期限切れの / `aud` が異なる ID トークンが 401 で拒否される
- [ ] `packages/lib` に ID トークン検証の単体テストがある
- [ ] トークン・識別子がログに出ていない
- [ ] `task ci` が成功する
