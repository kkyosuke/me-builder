---
number: 13
title: fix(ci): Pages の preview ドメインが preview ブランチを配信するようにし DNS を整備する
status: done
priority: high
labels: [ci, web, infra]
dependson: []
related: [11, 12]
created_at: 2026-07-26T12:42:29.267733+00:00
updated_at: 2026-07-26T13:19:51.230614+00:00
---

## 背景

`apps/web` は Cloudflare **Pages** で配信しており、`api` / `mcp` / `worker`（Workers）と違って **1 プロジェクト (`me-builder-web`) の中の production / preview** で環境を分けている。`apps/web/package.json` の deploy スクリプトが `wrangler pages deploy dist --branch=preview` / `--branch=main` でブランチを切り替える構造。

Pages はドメインをプロジェクトへ登録するだけでは配信を開始せず、DNS レコードが揃うまで "Verifying"（Complete DNS setup）のまま止まる。Workers 側は `wrangler.toml` の `routes` に `custom_domain = true` を書いているため DNS レコードが自動作成されるが、Pages にはその仕組みがない。旧 deploy スクリプトはドメイン登録の curl だけを実行していたため、`stg.kagami.kyosuke.dev` / `kagami.kyosuke.dev` はどちらも未配信のままだった。

## やったこと（#11 の PR <https://github.com/kkyosuke/me-builder/pull/24> に含む）

- `scripts/setup-pages-domain.ts` を追加し、ドメインのプロジェクト登録と DNS CNAME の upsert を Cloudflare API で行うようにした
  - preview → `preview.me-builder-web.pages.dev`、production → `me-builder-web.pages.dev`
  - 対象ドメインは `BASE_DOMAIN` から取得（スクリプトへハードコードしない）
  - 環境変数や権限が足りない場合は警告のみでスキップし、デプロイを失敗させない
- `apps/web` の `deploy:preview` / `deploy:production` をこのスクリプトの呼び出しへ置き換えた
- `.agents/rules/development.md` §2 に Pages のカスタムドメイン運用ルールを追記した
- `CLOUDFLARE_API_TOKEN` に Zone:Edit / DNS:Edit を付与済み（2026-07-26）

### preview 側は配信を確認済み

preview デプロイで CNAME が作成され、証明書の発行後（CNAME 作成から約 2 分）に配信が開始した。

```console
$ dig +short stg.kagami.kyosuke.dev
104.21.26.42
172.67.168.56
$ curl -s -o /dev/null -w '%{http_code}\n' https://stg.kagami.kyosuke.dev/
200
```

**`stg` は preview ブランチの内容を返している。** 配信中のバンドル (`/assets/index-JbFnHf6i.js`) が `preview.me-builder-web.pages.dev` と同一で、`VITE_LIFF_ID` の値を含んでいることを確認した（production にはまだ LIFF のコードが入っていないため、production の内容ではないと判別できる）。ブランチエイリアスへ CNAME を向ける方針（案 B）で成立したため、Pages プロジェクトを分ける案 A は採らない。

## クローズ理由と残る確認

スクリプトと運用ルールの整備は完了し、preview 側は実際に配信されることを確認したためクローズする。

production 側（`kagami.kyosuke.dev`）の CNAME は同じスクリプトが `cd-production.yml` の実行時に作成する。**PR #24 のマージ後に `https://kagami.kyosuke.dev` が 200 を返すことを確認する**（証明書の発行に数分かかる。もし配信されない場合はこの issue を再オープンする）。

`docs/infrastructure-architecture.md` は Cloudflare の構成要素そのものが変わらないため更新しない。Pages と Workers で DNS の作り方が違う点は `.agents/rules/development.md` §2 に運用ルールとして記載した。

## 完了条件

- [x] `https://stg.kagami.kyosuke.dev` が preview ブランチの内容を返す
- [ ] `https://kagami.kyosuke.dev` が production（`main`）の内容を返す（マージ後に確認）
- [x] deploy スクリプトが実態と一致している（手動で作った設定に依存していない）
- [x] `task ci` が成功する
