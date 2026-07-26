---
number: 12
title: feat(api): LIFF の ID トークンを検証し LINE Login の userId を Account へ束ねる
status: in-progress
priority: high
labels: [api, web, security, line]
dependson: [11]
related: [13]
created_at: 2026-07-26T12:15:19.097990+00:00
updated_at: 2026-07-26T21:55:32.033937+00:00
---

## 背景

Issue #11 で `apps/web` に LIFF の最小疎通（`liff.init` + `liff.getProfile()` の表示）を入れた。ただしこの時点では **クライアントが取得したプロフィールを画面へ表示しているだけ** で、サーバー側は誰がアクセスしているかを検証していない（クライアントから送られてきた識別子はサーバー側で検証できないため、そのままでは本人性の根拠にならない）。回答を Account へ紐づけて保存するには、サーバーが本人性を検証できる必要がある。

あわせて [プロジェクト概要 §5](../../docs/project-overview.md#5-アカウントと本人識別) が次を要確認事項として残している。

> Messaging APIで得られる利用者の識別子とLINE Loginで得られる識別子を同じAccountへ束ねられるかは、LINE側のチャネル設定に依存します。LIFFで取得できる識別子も後者に含まれます。Phase 1の実装ではこの前提を最初に確認します。

LINE の用語集は userId を次のように定義している。**プロバイダー単位**であってチャネル単位ではない。

> Unique identifier for users. Note that the user ID is only unique to an individual provider. The same LINE user will have a different user ID for different providers.

したがって次の 2 ケースに分かれる。

- **ケース A**: LINE Login チャネルと Messaging API チャネルが同一プロバイダー配下 → userId が一致する
- **ケース B**: 別プロバイダー → userId が一致しない

## 既存の DB 構成での可否（調査済み）

`account_identities` は最初から「1 Account に複数のログイン手段」を持つ設計で、ユニークインデックスが `(provider, provider_account_id) WHERE is_deleted = 0` なので **provider 違いの行を同じ `account_id` へぶら下げられる**。**マイグレーションは不要**（インメモリ SQLite に実マイグレーションを適用した単体テストで確認済み）。

不足していたのはアプリ側で、次を追加した。

- `IdentityProvider` に `line_login` を追加（型のみ）
- `linkIdentity`: **既存 Account へログイン手段を追加する**。`upsertIdentity` は見つからなければ新規 Account を作るため、この用途には使えなかった
- `resolveAccountByLineLogin`: `line_login` → `line` の順に探す解決ロジック

## 実装済み（判定フローの 1〜2）

1. `line_login` / `sub` の identity があればその Account（2 回目以降は必ずここで終わる）
2. 無ければ `line` / `sub` を探す。**ケース A ならここで友だち追加時の Account に着地**し、`line_login` を同じ Account へ紐づける
3. どちらも無ければ **Account を作らず 404**（`reason: friendship_required`）。アカウント作成の起点は友だち追加（[§5](../../docs/project-overview.md#5-アカウントと本人識別)）

内容:

- `packages/lib/src/line/id-token.ts`: `line.idToken.verify`。LINE の `POST https://api.line.me/oauth2/v2.1/verify` へ委譲し、`aud` の一致を受け取り側でも確認する。JWKS の取得と署名検証は自前で持たない
- `packages/lib/src/line/id-token.ts`: `resolveLoginChannelId`。`LINE_LOGIN_CHANNEL_ID` 未設定時は LIFF ID の接頭辞から補完（`liff.ts` と共有）
- `apps/api`: `controller/line.ts`（`/api/line/` 配下の HTTP 変換）と `logic/liff-session.ts` / `logic/line-webhook.ts`（HTTP を知らないドメイン層）に分離。ルート定義は controller を呼ぶだけ
- `apps/api` の config に `liffId` / `lineLoginChannelId` を追加。CD から `LIFF_ID` を `apps/api` へ配布
- `apps/web`: `verifyLiffSession` で ID トークンを API へ送り、結果（本人確認済み / 友だち追加が必要 / エラー）を画面へ出す
- `.agents/rules/development.md` §4 に層の分離と運用ルールを追記

## レビュー指摘への対応（PR #25）

- **`linkIdentity` の競合**: 存在確認と INSERT の間に排他がなく、同じ `sub` で初回解決が並行するとユニーク制約違反が伝播して 500 になっていた（`Promise.allSettled` で再現確認）。`upsertIdentity` と同じく catch + 再取得で先に入った行を採用するようにし、同時実行の回帰テストを追加した
- **`accountId` を返さない**: セッションとトークンの管理方式が[ドメイン設計](../../docs/domain-design.md)で未決定のうちにクライアントへ渡すと、後続リクエストで「クライアントが送ってきた `accountId`」を信頼する実装を誘発する。返すのは `displayName` / `pictureUrl` だけにした
- **ID トークンのリプレイ**: **LIFF は `nonce` を指定できない**（`liff.login()` にパラメータが無いことをドキュメントで確認）ため、nonce による対策は採れない。代わりに `maxAgeSeconds` で受け入れる発行後の経過時間を絞れるようにした。既定は LIFF の ID トークンの有効期間と同じ 1 時間（LINE 側の検証より厳しくしない）で、検証成功時に経過秒数だけをログへ出力する。実際の分布を見てから絞る
- **層の分離**: logic が HTTP のステータスコードを返していたのを、ドメイン上の結果を返す形へ変更し、controller を新設した

## 未実装（判定フローの 3 = ケース B）

userId が一致しない場合に、Messaging API 側の userId と LINE Login の `sub` を突き合わせて紐づける導線。候補と評価:

| 手段 | 評価 |
| --- | --- |
| `liff.sendMessages()` で LIFF から nonce を送信し、webhook の `source.userId` と突き合わせる | URL に紐づけ情報を載せないので[リンクに認証情報を持たせない原則](../../docs/project-overview.md#4-想定する利用体験)と整合し、転送耐性も高い。要 `chat_message.write` スコープ。**webhook に届くかは要検証** |
| リンクに nonce を載せる | 実装は最小だが、転送された nonce を第三者が開くと第三者の `sub` が本人の Account へ紐づく。短命・単回・確認画面が必須 |
| LINE 公式の Account Link (`linkToken`) | 堅いが重厚 |

**まず構成の確認を優先する。** LINE Login チャネルを Messaging API チャネルと同一プロバイダーに置けるなら、ケース B ごと消える。

## 残る検討事項

- **サーバー発行のセッション**: ID トークンを毎回送る形のままだと、リプレイ耐性も認可の土台も弱い。書き込み系のエンドポイントを作る前に、セッション方式（[ドメイン設計](../../docs/domain-design.md)で未決定）を決める必要がある
- `(account_id, provider)` のユニーク制約が無いため、同一 Account に `line` identity が 2 本ぶら下がる状態を DB は防げない。DB レベルでも担保するなら制約追加を検討する（現状は `linkIdentity` がアプリ側で他 Account への重複紐づけを拒否している）

## 完了条件

- [ ] Messaging API の `userId` と LINE Login の `sub` の関係が実機で確認され、結論が SSoT へ反映されている
- [x] 改ざんした / 期限切れの / `aud` が異なる ID トークンが 401 で拒否される
- [x] `packages/lib` に ID トークン検証の単体テストがある
- [x] トークン・識別子がログ・レスポンスに出ていない
- [x] `task ci` が成功する
- [ ] ケース B の紐づけ導線（構成を寄せられない場合のみ必要）
