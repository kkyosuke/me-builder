---
number: 11
title: feat(web): Phase 1 の Web を LIFF で表示できるようにする
status: in-progress
priority: high
labels: [web, docs, line]
dependson: []
related: [12, 13]
created_at: 2026-07-26T12:14:51.723094+00:00
updated_at: 2026-07-26T12:46:23.982317+00:00
---

## 背景

Phase 1 のスワイプアンケートは Web が担当し、LINE からリンクを配信する導線になっている（[プロジェクト概要 §4](../../docs/project-overview.md#4-想定する利用体験)）。ただし現状の同節「LINEからWebへの遷移とログイン」では **LIFF が「採らなかった代替案」** として記載されており、「Phase 1ではWebを独立して開ける形を優先する。LIFF化は後から追加できる実装手段なので、この段階では決めない」と明記されている。

1 日 1 回の反復操作であるスワイプアンケートに対して、毎回 LINE Login の画面を挟むのは摩擦が大きい。LINE 内から LIFF で開ければログイン画面を省いて回答へ入れる。

実装側は `apps/web` が React + Vite のスケルトン（`/api/health` を叩くだけ）で、LIFF SDK は未導入。

## 確定した方針

1. **LIFF を LINE 内からの主導線とし、外部ブラウザから独立して開ける Web + LINE Login も維持する**（LIFF 単独に絞らない）
2. 実装範囲は **最小疎通のみ**（`liff.init` + プロフィール表示）。ID トークン検証や Account 紐づけは後続 issue（#12）へ回す
3. docs 改訂と実装を同一 PR で行う

## やること

### docs

- `docs/project-overview.md` §4「LINEからWebへの遷移とログイン」を、LIFF を代替案から主導線へ昇格させる形で改訂する。既存節の書式に合わせ、根拠と採らなかった代替案を必ず添える
  - 維持する既存の決定: **リンクに認証情報を持たせない原則**（リンクは「どのアンケートか」だけを指し、本人性は LINE 側が保証する）、§4「チャネルごとの役割分担」（公開範囲を広げる操作・MCP 接続管理を Web に限定）
  - 採らなかった代替案として残す: **LIFF 単独に絞る**（実装は減るが、公開範囲設定や MCP 接続管理まで LINE 内に閉じることになり、外部ブラウザで独立して開ける導線を失う）
- `.agents/rules/development.md` に `apps/web` の LIFF 初期化と環境変数の運用ルールを追記する（環境変数未設定時に安全にスキップする既存方針と揃える）
- `docs/infrastructure-architecture.md` は、LIFF が LINE 側の仕組みで Cloudflare の構成要素を変えないため原則として追記しない

### 実装（最小疎通）

1. **依存追加**: ルートから `apps/web` へ `@line/liff` を追加する（個別ディレクトリで `npm install` しない）
2. **設定**: `apps/web/src/config/schema.ts` / `index.ts` に `liffId` を追加し `VITE_LIFF_ID` から取得する（optional）。`apps/web/.env.example` へ追記する
3. **初期化**: `liff.init` を実行しログイン状態を判定する。未ログインなら `liff.login()`、ログイン済なら `liff.getProfile()` の結果を画面に表示する
4. **フォールバック**: 次のいずれでも画面が壊れないこと
   - `VITE_LIFF_ID` 未設定 → LIFF 初期化をスキップし従来画面を表示（`logger` でログ出力）
   - 外部ブラウザで開いた（`liff.isInClient()` が false）/ `liff.init` が失敗した → 白画面にせず状態を画面に出す
5. **テスト**: `config` のテストに `VITE_LIFF_ID` あり / なしのケースを追加。`liff` はモックし、初期化成功・失敗・未設定の分岐をテストする
6. **CD 配線**: `cd-preview.yml` / `cd-production.yml` で `VITE_LIFF_ID: ${{ vars.LIFF_ID }}` を渡す

## 節番号を変えないこと（既知のリスク）

`docs/project-overview.md` の §4 / §5 は他文書から節番号つきで参照されている（#10 に同種のリスクとして整理済み）。**節構成と節番号は変更せず**、§4 内の小見出しの追加・改訂にとどめる。

## プライバシー上の注意

`userId` は本人識別子なので **画面表示もログ出力もしない**。表示するのは `displayName` と `pictureUrl` に限る（[プロジェクト概要 §8](../../docs/project-overview.md#8-プライバシーと安全性)）。

## LINE Developers 側の手動設定

LIFF アプリの作成はコンソール操作なので Agent は実行できない。必要な設定内容と手順を PR 説明に記載する。

- LIFF アプリを作成するチャネル（LINE Login チャネル）
- エンドポイント URL（preview: `https://stg.kagami.kyosuke.dev`、production: `https://kagami.kyosuke.dev`。`apps/web/package.json` の deploy スクリプトが登録するドメインと揃える）
- サイズ、必要な scope（`profile`）
- 発行された LIFF ID の設定先
  - ローカル: `apps/web/.env` の `VITE_LIFF_ID`
  - preview / production: **GitHub Environment の変数 `LIFF_ID`**（preview は `dev`、production は `prd`）。CD ワークフローが `VITE_LIFF_ID` へマップしてビルド時に埋め込む。Vite は GitHub Actions 上のビルドで値を埋め込み、`wrangler pages deploy dist` はビルド済みアセットのみを上げるため、**Cloudflare Pages プロジェクト側の環境変数はバンドルへ反映されない**
  - 進捗: `dev` は設定済み（2026-07-26）。`prd` は production 用 LIFF アプリの作成後に設定が必要

## 前提となる別タスク

- #13 Pages の preview ドメインが preview ブランチを配信するようにし DNS を整備する。現状 `stg.kagami.kyosuke.dev` / `kagami.kyosuke.dev` はどちらも DNS で引けないため、**LIFF アプリのエンドポイント URL が到達可能にならない**。LINE 内での実機確認は #13 の解消後に行う

## スコープ外

- **LIFF の ID トークン検証と Account 紐づけ** → #12
- Pages のドメイン・ブランチ構成の見直し → #13
- スワイプアンケート画面そのものの実装
- LINE 側のリッチメニュー / リンク配信を LIFF URL へ切り替える作業
- 独立 Web 側の LINE Login 実装

## 後続タスク

- #12 LIFF の ID トークンを検証し LINE Login の userId を Account へ束ねる

## 完了条件

- [x] `docs/project-overview.md` §4 が LIFF 主導線を根拠・代替案つきで確定しており、節番号が変わっていない
- [x] `.agents/rules/documentation.md` §9 のレビューチェックリストを満たす（概念の重複定義なし、旧記述が残っていない）
- [x] `VITE_LIFF_ID` 設定時に `liff.init` が成功しプロフィールが表示される実装になっている
- [x] `VITE_LIFF_ID` 未設定時・外部ブラウザ時に画面が壊れない
- [x] `userId` が画面・ログのどちらにも出ていない
- [x] `task ci`（lint / typecheck / test / build）が成功する
- [x] `git diff --check` が成功する
- [x] PR が `docs/pull-request-guidelines.md` の命名規約とテンプレートに沿っている

## PR

<https://github.com/kkyosuke/me-builder/pull/24>
