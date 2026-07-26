---
number: 13
title: fix(ci): Pages の preview ドメインが preview ブランチを配信するようにし DNS を整備する
status: todo
priority: high
labels: [ci, web, infra]
dependson: []
related: [11, 12]
created_at: 2026-07-26T12:42:29.267733+00:00
updated_at: 2026-07-26T13:00:58.220935+00:00
---

## 背景

`apps/web` は Cloudflare **Pages** で配信しており、`api` / `mcp` / `worker`（Workers）と違って **1 プロジェクト (`me-builder-web`) の中の production / preview** で環境を分けている。`apps/web/package.json` の deploy スクリプトが `wrangler pages deploy dist --branch=preview` / `--branch=main` でブランチを切り替える構造。

この構造のまま、deploy スクリプトが Cloudflare API (`POST /pages/projects/me-builder-web/domains`) で次の 2 つを **同じプロジェクトのカスタムドメイン** として登録している。

- `deploy:preview` → `stg.kagami.kyosuke.dev`
- `deploy:production` → `kagami.kyosuke.dev`

Pages のプロジェクトカスタムドメインは production デプロイ（`--branch=main`）を指すため、`stg.kagami.kyosuke.dev` を preview ブランチへ向けるには branch 別の扱いが必要になる。

さらに現時点でどちらのドメインも DNS で引けない。

```console
$ dig +short stg.kagami.kyosuke.dev
$ dig +short kagami.kyosuke.dev
$ dig +short api.stg.kagami.kyosuke.dev
172.67.168.56
104.21.26.42
```

Workers 側は `wrangler.toml` の `routes` に `custom_domain = true` を書いているため DNS レコードが自動作成されるが、Pages 側は API でプロジェクトへドメインを登録するだけで DNS が未整備。結果として web は preview / production のどちらも独自ドメインで配信されていない。

一方、Pages のブランチエイリアスは到達可能。

```console
$ curl -s -o /dev/null -w '%{http_code}\n' https://preview.me-builder-web.pages.dev/
200
```

## なぜ急ぐか

LIFF アプリ（#11 / #12）のエンドポイント URL は `https://stg.kagami.kyosuke.dev` / `https://kagami.kyosuke.dev` を指す前提。**ドメインが到達可能でないと LINE 内で開けない**。

暫定回避として LIFF アプリのエンドポイント URL に `https://preview.me-builder-web.pages.dev` を指定すれば #13 を待たずに LINE 内の動作確認はできる（#11 の PR 説明に記載）。この issue の完了後に独自ドメインへ差し替える。

## やること

1. Pages のカスタムドメインとブランチの対応方針を決める
   - 案 A: preview 用に Pages プロジェクトを分ける（例: `me-builder-web-preview`）。Workers 側の `-preview` / `-production` 命名と揃い、ドメインとブランチの対応が単純になる
   - 案 B: 1 プロジェクトのまま、`stg.kagami.kyosuke.dev` を branch alias (`preview.me-builder-web.pages.dev`) への CNAME として DNS 側で解決する
   - 決めた方針で `apps/web/package.json` の deploy スクリプトと `apps/web/wrangler.toml` を揃える
2. DNS レコードを整備し、両ドメインが実際に配信されることを確認する
3. `docs/infrastructure-architecture.md` の記述と実態が合っているかを確認し、必要なら更新する（Pages と Workers で環境の分け方が違う点）
4. `.agents/rules/development.md` §2 の Web UI の項へ、確定した方針を短く反映する
5. LIFF アプリのエンドポイント URL を暫定の `pages.dev` から独自ドメインへ戻す（#11 の暫定回避を採った場合）

## 完了条件

- [ ] `https://stg.kagami.kyosuke.dev` が preview ブランチの内容を返す
- [ ] `https://kagami.kyosuke.dev` が production（`main`）の内容を返す
- [ ] deploy スクリプトが実態と一致している（手動で作った設定に依存していない）
- [ ] `task ci` が成功する
