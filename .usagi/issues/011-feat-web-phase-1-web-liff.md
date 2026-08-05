---
number: 11
title: feat(web): Phase 1 の Web を LIFF で表示できるようにする
status: done
priority: high
labels: [web, docs, line]
dependson: []
related: [12, 13]
created_at: 2026-07-26T12:14:51.723094+00:00
updated_at: 2026-07-26T13:19:27.552831+00:00
---

## 背景

Phase 1 のスワイプ診断は Web が担当し、LINE からリンクを配信する導線になっている（[プロジェクト概要 §4](../../docs/product/project-overview.md#4-想定する利用体験)）。ただし改訂前の同節「LINEからWebへの遷移とログイン」では **LIFF が「採らなかった代替案」** として記載されており、「Phase 1ではWebを独立して開ける形を優先する。LIFF化は後から追加できる実装手段なので、この段階では決めない」と明記されていた。

1 日 1 回の反復操作であるスワイプ診断に対して、毎回 LINE Login の画面を挟むのは摩擦が大きい。LINE 内から LIFF で開ければログイン画面を省いて回答へ入れる。

実装側は `apps/web` が React + Vite のスケルトン（`/api/health` を叩くだけ）で、LIFF SDK は未導入だった。

## 確定した方針

1. **LIFF を LINE 内からの主導線とし、外部ブラウザから独立して開ける Web + LINE Login も維持する**（LIFF 単独に絞らない）
2. 実装範囲は **最小疎通のみ**（`liff.init` + プロフィール表示）。ID トークン検証や Account 紐づけは後続 issue（#12）へ回す
3. docs 改訂と実装を同一 PR で行う

## やったこと

### docs

- `docs/project-overview.md` §4「LINEからWebへの遷移とログイン」を改訂し、LIFF を代替案から主導線へ昇格。導線ごとの本人性の保証を表と Mermaid 図で整理し、根拠と採らなかった代替案（LIFF 単独に絞る / LIFF を採らず外部ブラウザだけ / 使い捨てトークン）を添えた
  - **リンクに認証情報を持たせない原則**と §4「チャネルごとの役割分担」は維持
  - **節構成と節番号は変更していない**（#10 に整理済みの既知リスク）
- §5 の「WebはLINE Loginで認証します」を §4 へ委ねる形へ修正し、識別子の要確認事項に LIFF が含まれることを追記
- `.agents/rules/development.md` に `apps/web` の環境変数・カスタムドメイン・LIFF 初期化の運用ルールを追記
- `docs/infrastructure-architecture.md` は変更なし（LIFF は LINE 側の仕組みで Cloudflare の構成要素が変わらない）

### 実装（最小疎通）

1. `@line/liff` と `@me-builder/shared`（`logger`）を `apps/web` へ追加
2. `apps/web/src/config` に optional な `liffId` を追加し `VITE_LIFF_ID` から取得（空文字・空白のみは未設定として扱う）。`.env.example` へ追記
3. `apps/web/src/liff/index.ts` に `initializeLiff(liffId)` を追加。SDK 呼び出しをこのモジュールへ閉じ込め、`loading` / `disabled` / `login-required` / `ready` / `error` の状態を返す（例外を投げない）
   - `liffId` に既定値を持たせない。既定値にすると `initializeLiff(undefined)` が「未設定」を表現できず、環境変数の有無で挙動が変わる（実際に CD で検出して修正した）
4. `App.tsx` に `LiffCard` を追加し、どの状態でも画面へ表示する
5. `liff` をモックしたテストで、初期化成功 / 初期化失敗 / プロフィール取得失敗 / 未ログイン / 外部ブラウザ / 未設定の分岐を検証。`userId` と `statusMessage` が表示用プロフィールに含まれないことも検証
6. `cd-preview.yml` / `cd-production.yml` で `VITE_LIFF_ID: ${{ vars.LIFF_ID }}` を渡す

## プライバシー上の注意

`userId` は本人識別子なので **画面表示もログ出力もしない**。表示するのは `displayName` と `pictureUrl` に限る（[プロジェクト概要 §8](../../docs/product/project-overview.md#8-プライバシーと安全性)）。

## LIFF ID の設定先

- ローカル: `apps/web/.env` の `VITE_LIFF_ID`
- preview / production: **GitHub Environment の変数 `LIFF_ID`**（preview は `dev`、production は `prd`）。CD ワークフローが `VITE_LIFF_ID` へマップしてビルド時に埋め込む
  - Vite は GitHub Actions 上のビルドで値を埋め込み、`wrangler pages deploy dist` はビルド済みアセットのみを上げるため、**Cloudflare Pages プロジェクト側の環境変数はバンドルへ反映されない**
  - `dev` は設定済み（2026-07-26）。`prd` は production 用 LIFF アプリの作成後に設定が必要

## 関連する別タスク

- #13 Pages のカスタムドメインと DNS。本 PR で DNS の自動設定を入れ、`https://stg.kagami.kyosuke.dev` が preview ブランチを配信することを確認済み。production 側（`kagami.kyosuke.dev`）は `main` へのマージ後に確認する
- #12 LIFF の ID トークン検証と Account 紐づけ（後続）

## スコープ外

- **LIFF の ID トークン検証と Account 紐づけ** → #12
- スワイプ診断画面そのものの実装
- LINE 側のリッチメニュー / リンク配信を LIFF URL へ切り替える作業
- 独立 Web 側の LINE Login 実装

## 完了条件

- [x] `docs/project-overview.md` §4 が LIFF 主導線を根拠・代替案つきで確定しており、節番号が変わっていない
- [x] `.agents/rules/documentation.md` §9 のレビューチェックリストを満たす（概念の重複定義なし、旧記述が残っていない）
- [x] `VITE_LIFF_ID` 設定時に `liff.init` が成功しプロフィールが表示される実装になっている
- [x] `VITE_LIFF_ID` 未設定時・外部ブラウザ時に画面が壊れない
- [x] `userId` が画面・ログのどちらにも出ていない
- [x] `task ci`（lint / typecheck / test / build）が成功する
- [x] `git diff --check` が成功する
- [x] PR が `docs/pull-request-guidelines.md` の命名規約とテンプレートに沿っている

## 残っている手動確認（依頼者）

- LINE アプリから LIFF を開く実機確認（エンドポイント URL は到達可能な状態）
- production 用 LIFF アプリの作成と `prd` への `LIFF_ID` 設定

## PR

<https://github.com/kkyosuke/me-builder/pull/24>
