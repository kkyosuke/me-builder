---
number: 12
title: feat(api): LIFF の ID トークンを検証し LINE Login の userId を Account へ束ねる
status: done
priority: high
labels: [api, web, security, line]
dependson: [11]
related: [13]
created_at: 2026-07-26T12:15:19.097990+00:00
updated_at: 2026-07-27T21:36:27.755030+00:00
---

## 背景

Issue #11 で `apps/web` に LIFF の最小疎通（`liff.init` + `liff.getProfile()` の表示）を入れた。ただしこの時点では **クライアントが取得したプロフィールを画面へ表示しているだけ** で、サーバー側は誰がアクセスしているかを検証していない（クライアントから送られてきた識別子はサーバー側で検証できないため、そのままでは本人性の根拠にならない）。回答を Account へ紐づけて保存するには、サーバーが本人性を検証できる必要がある。

あわせて [プロジェクト概要 §5](../../docs/project-overview.md#5-アカウントと本人識別) が「Messaging API と LINE Login の識別子を同じ Account へ束ねられるか」を要確認事項として残していた。

## 実機確認の結果（2026-07-27）

**識別子は一致した（ケース A）。** LINE の利用者の識別子は**プロバイダー単位**で一意（チャネル単位ではない）であり、Messaging API チャネルと LINE Login チャネルが同一プロバイダー配下にあるため同じ値になる。LIFF を実機で開き「本人確認済み」の表示を確認した。

結論は [プロジェクト概要 §5](../../docs/project-overview.md#5-アカウントと本人識別) へ確定として反映済み。あわせて「**チャネルを同一プロバイダー配下に置くことがアカウント体系の前提**」であることも明記した（プロバイダー間でチャネルは移動できないため、チャネル追加時に確認が必要）。

**ケース B（識別子が一致しない構成）の紐づけ導線は不要と判断した。** 必要になるのはチャネルを別プロバイダーへ作った場合だけで、そのときは §5 の前提から見直す。

## 既存の DB 構成での可否

`account_identities` は最初から「1 Account に複数のログイン手段」を持つ設計で、ユニークインデックスが `(provider, provider_account_id) WHERE is_deleted = 0` なので **provider 違いの行を同じ `account_id` へぶら下げられる**。**マイグレーションは不要**（インメモリ SQLite に実マイグレーションを適用した単体テストで確認済み）。

アプリ側に不足していたものを追加した。

- `IdentityProvider` に `line_login` を追加（型のみ）
- `linkIdentity`: **既存 Account へログイン手段を追加する**。`upsertIdentity` は見つからなければ新規 Account を作るため、この用途には使えなかった
- `resolveAccountByLineLogin`: `line_login` → `line` の順に探す解決ロジック

## 実装

1. `line_login` / `sub` の identity があればその Account（2 回目以降は必ずここで終わる）
2. 無ければ `line` / `sub` を探す。**識別子が一致するので友だち追加時の Account に着地**し、`line_login` を同じ Account へ紐づける
3. どちらも無ければ **Account を作らず 404**（`reason: friendship_required`）

内容:

- `packages/lib/src/line/id-token.ts`: `line.idToken.verify`。LINE の `POST /oauth2/v2.1/verify` へ委譲し、`aud` の一致を受け取り側でも確認する。`maxAgeSeconds` で発行後の経過時間を絞れる
- `apps/api`: `controller/line.ts`（`/api/line/` 配下の HTTP 変換）と `logic/liff-session.ts` / `logic/line-webhook.ts`（HTTP を知らないドメイン層）に分離
- `apps/web`: `verifyLiffSession` で ID トークンを API へ送り、結果を画面へ出す
- `apps/worker`: メッセージ受信時にも Account を補完する（下記）
- `.agents/rules/development.md` §4 に層の分離と運用ルールを追記

## 実機確認で見つかって直したもの

- **`openid` スコープの欠落**: LIFF アプリを `scope: ["profile"]` だけで作っていたため `liff.getIDToken()` が `null` を返し、「ID トークンを取得できませんでした」になっていた。`REQUIRED_SCOPES` を `openid` + `profile` とし、作成時だけでなく更新時にも毎回送るようにした（手で外されても次のデプロイで復旧する）
- **メッセージ受信時の Account 補完**: Account は `follow` イベントでしか作られないため、**すでに友だち追加済みのユーザーは行が無く 404 になり続ける**（ブロック→再追加しない限り復旧できない）。メッセージが届いている＝友だちである証明なので、`message` イベントでも `upsertIdentity` を行うようにした
- **`providerAccountId` のログ出力**: 本人識別子をログへ出していた箇所を削除した（[§8](../../docs/project-overview.md#8-プライバシーと安全性)）

## レビュー指摘への対応（PR #25）

- **`linkIdentity` の競合**: 存在確認と INSERT の間に排他がなく、同じ `sub` で初回解決が並行するとユニーク制約違反が伝播して 500 になっていた（`Promise.allSettled` で再現確認）。`upsertIdentity` と同じく catch + 再取得で先に入った行を採用し、同時実行の回帰テストを追加した
- **`accountId` を返さない**: セッション管理の方式が未決定のうちにクライアントへ渡すと、後続リクエストで「クライアントが送ってきた `accountId`」を信頼する実装を誘発する。返すのは `displayName` / `pictureUrl` だけにした
- **ID トークンのリプレイ**: **LIFF は `nonce` を指定できない**（`liff.login()` にパラメータが無いことをドキュメントで確認）ため nonce による対策は採れない。代わりに `maxAgeSeconds` を追加した。既定は LIFF の ID トークンの有効期間と同じ 1 時間で、検証成功時に経過秒数だけをログへ出すので実際の分布を見てから絞れる
- **層の分離**: logic が HTTP のステータスコードを返していたのを、ドメイン上の結果を返す形へ変更し controller を新設した
- **controller の粒度**: `/api/line/` 配下を `controller/line.ts` にまとめ、webhook のハンドラも `index.ts` から移した

## 後続へ残すこと

- **サーバー発行のセッション**: ID トークンを毎回送る形のままだと、リプレイ耐性も認可の土台も弱い。書き込み系のエンドポイントを作る前にセッション方式（[ドメイン設計](../../docs/domain-design.md)で未決定）を決める
- `(account_id, provider)` のユニーク制約が無いため、同一 Account に `line` identity が 2 本ぶら下がる状態を DB は防げない（現状は `linkIdentity` がアプリ側で拒否している）
- `maxAgeSeconds` を実際の `iat` の分布を見てから絞る

## 完了条件

- [x] Messaging API の `userId` と LINE Login の `sub` の関係が実機で確認され、結論が SSoT へ反映されている
- [x] 改ざんした / 期限切れの / `aud` が異なる ID トークンが 401 で拒否される
- [x] `packages/lib` に ID トークン検証の単体テストがある
- [x] トークン・識別子がログ・レスポンスに出ていない
- [x] `task ci` が成功する
- [x] ケース B の紐づけ導線 → **不要と判断**（同一プロバイダーのため）

## PR

<https://github.com/kkyosuke/me-builder/pull/25>
