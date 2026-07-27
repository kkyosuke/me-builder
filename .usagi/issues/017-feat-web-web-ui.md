---
number: 17
title: feat(web): Web にスワイプアンケートの回答 UI を実装する
status: in-progress
priority: high
labels: [web, ui]
dependson: []
related: [11, 12, 19]
created_at: 2026-07-27T21:51:44.225873+00:00
updated_at: 2026-07-27T21:52:49.737358+00:00
---

## 背景

Phase 1 の入力は「日記（LINE）」と「スワイプアンケート（Web）」の 2 本立てで確定している（[プロジェクト概要 §4](../../docs/project-overview.md#4-想定する利用体験)）。Web 側は #11 / #12 で LIFF の初期化と ID トークン検証まで通ったが、**肝心の回答画面がまだ無い**。`apps/web` は `/api/health` を叩くだけのスケルトンで、`src/index.css` に素の CSS と CSS 変数がある状態。

## 確定した方針

### デザインシステム

**Tailwind CSS（v4 / `@tailwindcss/vite`）と lucide-react のみを使う。** アニメーション・ジェスチャーのライブラリ（framer-motion, react-spring, react-tinder-card 等）は導入せず、スワイプは Pointer Events + CSS transform / transition で自前実装する。

理由: スワイプの追従・回転・飛ばしは transform と transition だけで表現でき、依存を増やすとバンドルサイズと LIFF 内 WebView での挙動確認の対象が増える。

### 既存 CSS の扱い

**既存の `src/index.css` を Tailwind へ全面移行する**（素の CSS を残して併存させない）。

理由:

- `index.css` の CSS 変数の色はすべて Tailwind 既定パレットと同値（`#0f172a` = `slate-900`、`#1e293b` = `slate-800`、`#38bdf8` = `sky-400`、`#34d399` = `emerald-400` など）。1:1 で置き換えられ、見た目が変わらない
- `button { ... }` のような**要素セレクタ**が残ると、以降に追加するすべてのコンポーネントのボタンへ暗黙に効く。スワイプアンケートは選択ボタンを持つため、併存させると原因の分かりにくい上書きを抱え込む
- Tailwind v4 のユーティリティに `.container` があり、既存の `.container` クラスと名前が衝突する。レイヤーの優先順位に頼った共存は脆い

### 型の置き場所

**質問・回答の型は `apps/web/src/survey/` に閉じる。`packages/shared` へは置かない。**

理由: `packages/shared` へ置くと、アプリ間で共有する契約＝サーバーとのスキーマを確定したことになる。[設計スコープのルール §2](../../.agents/rules/design-scope.md) は「質問（アンケート）の具体的なエンティティや集約」と「API、イベントの具体的なスキーマ」を後続設計へ延期しており、それに反する。サーバー連携を実装する時点（#19）で共有先を判断する。

## やること

1. `bun add tailwindcss @tailwindcss/vite lucide-react --cwd apps/web`（[開発運用ルール §2](../../.agents/rules/development.md)）
2. `vite.config.ts` へ `@tailwindcss/vite` を追加し、`index.css` を `@import "tailwindcss"` + `@layer base` へ置き換える。`App.tsx` の既存 2 カード（LIFF / API health）と inline style をユーティリティクラスへ移行する
3. `src/survey/` を追加する
   - `types.ts`: 質問・選択肢・回答の型。回答は「選択」と「スキップ」の union
   - `questions.ts`: 型付きのモック質問と `fetchSurveyQuestions()`。**後でサーバー実装へ差し替えるモジュール境界**にする
   - `swipe.ts`: しきい値判定・カードの transform 計算などの純粋関数（Vitest の node 環境で単体テストできる形にする）
4. `src/components/` にカードスタックの UI を追加する
   - 質問カードを縦に重ね、最前面のカードを Pointer Events でドラッグ
   - ドラッグ量に応じて追従・回転し、どちら側を選ぼうとしているかをアイコン + ラベルのオーバーレイで表示
   - しきい値超えで飛ばして次のカードへ、未満なら元位置へ戻す
   - **スワイプ以外の操作手段を必ず用意する**: 左右の選択ボタン、キーボード（←／→）。外部ブラウザ導線があるため（[プロジェクト概要 §4](../../docs/project-overview.md#4-想定する利用体験)）両方で操作できること
   - スキップ（あとで回答）の導線（[プロジェクト概要 §3.1](../../docs/project-overview.md#31-多様な質問に回答する) の回答の入力形式に含まれる）
   - 進捗（何問目 / 全何問）と全問終了時の完了表示
   - アイコンは lucide-react のみ。文言・コメントは日本語
   - `prefers-reduced-motion` を尊重する（追従は残し、飛ばしのアニメーションを省く）
5. lucide のアイコンは**質問データにコンポーネントを持たせず**、アイコン名の union → コンポーネントのレジストリを表示層に置く（質問データを JSON 化可能なまま保つ）

## スコープ外

- **質問の取得・回答の保存 API（サーバー連携）** → #19
- 回答の一覧・修正・削除の画面
- 質問の版管理の実装（型に版を持たせるところまで）

## 完了条件

- [ ] スワイプ・ボタン・キーボードのいずれでも回答できる
- [ ] しきい値未満で元位置へ戻り、超えると次のカードが前面に出る
- [ ] スキップができ、完了表示まで到達する
- [ ] `prefers-reduced-motion: reduce` で飛ばしのアニメーションが無効になる
- [ ] 既存の LIFF カード / API health カードの表示が壊れていない
- [ ] Tailwind と lucide-react 以外の UI 系依存を追加していない
- [ ] `task ci` が成功する
