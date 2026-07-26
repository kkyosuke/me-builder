---
number: 2
title: design: 設計順序 step 1 — Phase 1 の利用体験を確定する
status: done
priority: high
labels: [design, docs]
dependson: []
related: []
created_at: 2026-07-26T06:51:28.071641+00:00
updated_at: 2026-07-26T08:06:28.952910+00:00
---

## 背景

`docs/domain-design.md` §8「今後の設計順序」のうち、step 1（AccountとBrainの利用体験を確定する）が未完のまま、step 6 相当のインフラ（D1 / Vectorize / R2 / Workers AI）だけが `docs/infrastructure-architecture.md` で確定していた。実装も既に LINE 起点で進んでおり（`apps/api` の Webhook → Cloudflare Queues → `apps/worker` で返信、`account_identities.provider` に `"line"`）、`docs/project-overview.md` §12 では「最初に対応する利用チャネル」「最初のログイン手段とアカウント復旧方法」が未決のままだった。

この設計順序の逆転を解消する。

## 確定した内容

`docs/project-overview.md` §4 / §5 に、根拠と採らなかった代替案つきで記載する。

- 入力は「LINE での日記」と「Web でのスワイプアンケート」の2本立て
- LINE で「今日のアンケート」リンクを配信し、Web を LINE Login で認証する（リンクに認証情報を持たせない）
- 管理操作（一覧確認・修正・削除・公開範囲設定・MCP 接続管理）は Web。公開範囲を広げる操作は LINE に置かない
- ログイン手段は LINE のみ。Phase 1 は復旧を保証せず、エクスポートで補う
- 質問は運営が作成・審査・更新し、公開済みの質問文は書き換えず新版を追加する
- Phase 1 の入力から蓄積までに AI を使わない

## ゴール

- Phase 1 の利用体験が根拠・代替案つきで文書化されている
- `docs/project-overview.md` §12 が実態に合わせて整理されている
- `.agents/rules/design-scope.md` が現在の設計段階を正しく反映している
- ドキュメント間に概念の重複定義がない

## スコープ外

- アプリケーションコードの変更（`apps/**`, `packages/**` の `.ts`）
- 回答と Brain Item の対応づけ、Access Label の初期候補（Phase 2 → #4）
- AI 推定と本人確認の詳細フロー（step 4 → #5）
- D1 テーブル定義・マイグレーション（step 6 → #6）

## 後続タスク

- #4 Phase 2: 日記・アンケート回答と Brain Item の対応づけ
- #5 step 4: AI 推定と本人確認の流れ
- #6 step 6: 永続化・検索方式
