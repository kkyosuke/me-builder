---
number: 20
title: refactor: 最新コードの厳格レビュー指摘を解消する
status: todo
priority: high
labels: [review, architecture, ui, ux, docs]
dependson: []
related: []
created_at: 2026-08-27T13:53:16+00:00
updated_at: 2026-08-27T13:53:16+00:00
---

## 目的

2026-08-27 時点の `origin/main` / `e5f13a28` を、SSoT、クリーンアーキテクチャ、UI、UXの観点で厳格にレビューした結果を、優先度順に修正する。

## レビュー結果

### P0: セルフケアのSSoTと表示モデルが不一致で、確認済み情報を「未登録」と誤表示する

#### 根拠

- SSoT `docs/product/self-care-ai-consultation-experience.md:91-112` は、「負荷の手がかり」「早めのサイン」「合いやすかったこと」を、本人確認済み情報から最大1件ずつ表示すると定義している。
- 一方、共有、API、Webの実装モデルは `worked | did-not-work | recent-state` しか持たない。
  - `packages/lib/src/self-care-context.ts:1`
  - `apps/api/src/contract/profile/self-care-context.ts:11`
  - `apps/web/src/feature/profile/model/self-care-context.ts:1`
- サマリーUIは `worked` だけを抽出し、負荷とサインは常に未登録CTAを表示する。
  - `apps/web/src/feature/profile/presentation/self-care-section.tsx:83-105`
- テストも、確認済み `recent-state` をサマリーへ出さない挙動を正として固定している。
  - `apps/web/src/feature/profile/presentation/self-care-section.test.tsx:43-53`

#### 影響

本人が確認した「今週は肩に力が入っている」等の情報が存在しても、サマリーでは「AIと一緒に見つける」と表示される。保存済み事実と画面上の空状態が矛盾し、利用者の信頼を損なう。現行3値からは「負荷の場面」と「早めのサイン」を決定的に区別できないため、UIだけの修正では解消できない。

#### 修正方針

- 先にSSoT上の表示分類と保存分類の対応を確定する。
- 表示用分類を原本へ追加するか、既存Brain分類から決定的にprojectionするかを決め、共有型、API contract、Web modelを同時に更新する。
- 未確認推定を表示しない安全境界は維持する。
- テストは「確認済み3分類を最大1件ずつ表示」「無い分類だけCTA」を固定する。

### P1: Workerで `logic` と `handler` の依存が循環し、層分離ルールに反する

#### 根拠

- 開発ルール `.agents/rules/development.md:117-122` は、Workerでも `handler` を境界、`logic` をユースケースとして分離すると定義している。
- `apps/worker/src/handler/queue.ts:16` が `../logic/webhook` をimportする一方、`apps/worker/src/logic/webhook.ts:22-38` が8個の `handler/*` をimportしている。
- `logic/webhook.ts:205-294` 自体が、Queue messageの型判定、Cloudflare binding確認、handler dispatch、ack/retryを担っており、実質的にQueue adapterまたはcomposition rootになっている。
- 他にもlogicから具体adapterへの直接依存が残る。
  - `apps/worker/src/logic/brain-context.ts:11-12`
  - `apps/worker/src/logic/brain-dedup.ts:15`
  - `apps/api/src/logic/admin-statistics.ts:3`

#### 影響

handlerとlogicを単独で差し替え、テストできず、Queue種別追加のたびに境界層とユースケース層が相互変更になる。ES module cycleも生じ、初期化順依存の回帰を招く。

#### 修正方針

- Queue dispatch、binding解決、ack、retry、各handlerの組み立てを `handler/queue.ts` または明示したcomposition rootへ移す。
- logicはHTTP、Queue、Cloudflareを知らない入力、結果union、portに依存させる。
- concrete adapterはcomposition rootから注入する。
- `logic -> handler` を禁止する静的検査またはarchitecture testを追加する。

### P1: 詳細画面でも無関係なデータ取得を開始し、LIFFモバイル体験を悪化させる

#### 根拠

- `apps/web/src/feature/profile/presentation/profile-application.tsx:16-20` はroute判定前に、まとめ、進行度、週次振り返り、Goal、セルフケアの5 hookをすべて実行する。
- セルフケア詳細のroute分岐はその後の `:45-59` にある。
- そのため `/me/self-care` へ直接遷移しても、詳細表示に不要な複数API requestが発生する。

#### 影響

LINE内WebViewや低速回線で、不要な通信、認証処理、AccountDataアクセス、電力消費が増える。詳細画面自身のrequestと競合し、表示や操作の応答性を落とす。

#### 修正方針

- routeを先に解決し、画面単位のapplication componentへ分割する。
- 詳細画面ではセルフケア取得だけを開始する。
- E2Eまたは統合testで `/me/self-care` 初期表示時のAPI呼び出し集合を固定する。

### P1: prefix一致の手書きroutingが未知URLを正規画面として受理する

#### 根拠

- `apps/web/src/root-application.tsx:14-30` は公開siteの既知routeでなければすべてWeb applicationへフォールバックする。
- `apps/web/src/App.tsx:104,114-117` は `/admin*`、`/me/*`、`/compatibility/*` を広く正規routeとして扱う。
- `apps/web/src/feature/profile-settings/model/profile-navigation.ts:24-35` は `/profile/billing-old` 等もbillingまたはprofile画面として扱う。
- `apps/web/src/feature/profile/presentation/profile-application.tsx:45` は `/me/self-care-anything` もセルフケア詳細として扱う。

#### 影響

壊れたリンクやtypoが404にならず、別の正常画面を表示する。URLと画面状態が一致しないため、共有リンク、戻る操作、障害調査が難しくなる。管理APIの認可とは別問題だが、権限画面のroute判定をprefixへ委ねる設計も保守上危険である。

#### 修正方針

- route matcherを単一の純粋関数へ集約し、完全一致または明示した動的segmentだけを許可する。
- 未知routeはNot Found画面を表示し、適切な戻り先を提示する。
- prefix衝突、末尾slash、query、hash、動的ID不正をtable testで固定する。

### P2: セルフケア詳細の戻る操作と撤回後フォーカスが支援技術に不親切

#### 根拠

- `apps/web/src/feature/profile/presentation/profile-application.tsx:51-54` の「戻る」は常に `replaceState("/me")` を使う。アプリ内リンクでpushした履歴も置換するため、履歴に `/me` が重複しうる。
- `apps/web/src/feature/profile/presentation/self-care-details-screen.tsx:43-67` の撤回成功後、フォーカス中のボタンを含むカードが消えるが、成功通知と次のフォーカス先がない。
- エラーには `role="alert"` がある一方、成功結果は通知されない。

#### 影響

ブラウザBackを押しても同じ `/me` に留まることがあり、戻る履歴が直感とずれる。キーボード、スクリーンリーダー利用者は、撤回が成功したか、次にどこを操作すべきか把握しにくい。

#### 修正方針

- アプリ内遷移から来た場合は `history.back()`、direct entry時だけ安全なfallbackへreplaceする。
- 撤回成功をpolite live regionで通知し、次カードの撤回ボタン、一覧見出し、空状態のいずれかへフォーカスを移す。
- 履歴長、戻る先、フォーカス、読み上げを統合testで固定する。

## 受け入れ条件

- [ ] セルフケアSSoTと保存、API、表示分類の対応が1か所で定義される
- [ ] 確認済みの「負荷」「サイン」「合いやすかったこと」が各最大1件表示される
- [ ] 未確認情報は本人の事実として表示されない
- [ ] `apps/worker/src/logic/**` から `handler/**` へのimportが0件になる
- [ ] Queueのack、retry、binding処理が境界層に閉じる
- [ ] `/me/self-care` で詳細に不要なAPI requestが発生しない
- [ ] 未知URLは正規画面へ誤マッチせずNot Foundになる
- [ ] 戻る操作と撤回後の通知、フォーカスがkeyboard、screen reader testで検証される
- [ ] `bun run lint`、`bun run typecheck`、関連unit、E2Eが成功する

## レビュー時の検証

- `bun run lint`: 成功（1063 files）
- `bun run typecheck`: 実行環境の依存未導入により失敗（`@types/bun`、workspace package、React等を解決できず）。コード由来の成否は未判定。
- 関連Vitest: 同じく `@me-builder/lib`、`@testing-library/react` 未解決のためsuiteを開始できず。
