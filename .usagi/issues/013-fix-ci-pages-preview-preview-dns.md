---
number: 13
title: fix(ci): Pages の preview ドメインが preview ブランチを配信するようにし DNS を整備する
status: in-progress
priority: high
labels: [ci, web, infra]
dependson: []
related: [11, 12]
created_at: 2026-07-26T12:42:29.267733+00:00
updated_at: 2026-07-26T13:08:11.058719+00:00
---

## 背景

`apps/web` は Cloudflare **Pages** で配信しており、`api` / `mcp` / `worker`（Workers）と違って **1 プロジェクト (`me-builder-web`) の中の production / preview** で環境を分けている。`apps/web/package.json` の deploy スクリプトが `wrangler pages deploy dist --branch=preview` / `--branch=main` でブランチを切り替える構造。

Pages はドメインをプロジェクトへ登録するだけでは配信を開始せず、DNS レコードが揃うまで "Verifying"（Complete DNS setup）のまま止まる。Workers 側は `wrangler.toml` の `routes` に `custom_domain = true` を書いているため DNS レコードが自動作成されるが、Pages にはその仕組みがない。旧 deploy スクリプトはドメイン登録の curl だけを実行していたため、`stg.kagami.kyosuke.dev` / `kagami.kyosuke.dev` はどちらも未配信のままだった。

## 対応済み（#11 の PR <https://github.com/kkyosuke/me-builder/pull/24> に含む）

- `scripts/setup-pages-domain.ts` を追加し、ドメインのプロジェクト登録と DNS CNAME の upsert を Cloudflare API で行うようにした
  - preview → `preview.me-builder-web.pages.dev`、production → `me-builder-web.pages.dev`
  - 対象ドメインは `BASE_DOMAIN` から取得（スクリプトへハードコードしない）
  - 環境変数や権限が足りない場合は警告のみでスキップし、デプロイを失敗させない
- `apps/web` の `deploy:preview` / `deploy:production` をこのスクリプトの呼び出しへ置き換えた
- `CLOUDFLARE_API_TOKEN` に Zone:Edit / DNS:Edit を付与済み（2026-07-26）
- preview デプロイで `stg.kagami.kyosuke.dev → preview.me-builder-web.pages.dev` の CNAME が作成され、DNS で解決するようになった

```console
$ dig +short stg.kagami.kyosuke.dev
104.21.26.42
172.67.168.56
```

## 残っていること

1. `https://stg.kagami.kyosuke.dev` が実際に 200 を返すか（証明書の発行完了と、Pages のドメイン状態が Active になること）を確認する。CNAME 作成直後は TLS ハンドシェイクが失敗し、plain HTTP は 522 になる
2. **`stg` が preview ブランチの内容を返すことを確認する。** ブランチエイリアスへ CNAME を向けているが、Pages のプロジェクトカスタムドメインは production デプロイを指す仕様のため、production の内容が返る可能性がある
   - その場合は preview 用に Pages プロジェクトを分ける（例: `me-builder-web-preview`。Workers 側の `-preview` / `-production` 命名と揃う）方針へ切り替える
3. `kagami.kyosuke.dev`（production）は `main` へマージして `cd-production.yml` が走ったときに CNAME が作成される。マージ後に配信を確認する
4. `docs/infrastructure-architecture.md` の記述と実態が合っているか確認し、必要なら更新する（Pages と Workers で環境の分け方・DNS の作り方が違う点）

## 完了条件

- [ ] `https://stg.kagami.kyosuke.dev` が preview ブランチの内容を返す
- [ ] `https://kagami.kyosuke.dev` が production（`main`）の内容を返す
- [x] deploy スクリプトが実態と一致している（手動で作った設定に依存していない）
- [x] `task ci` が成功する
