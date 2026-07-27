---
number: 17
title: feat(web): Web にスワイプアンケートの回答 UI を実装する
status: done
priority: high
labels: [web, ui]
dependson: []
related: [11, 12, 19]
created_at: 2026-07-27T21:51:44.225873+00:00
updated_at: 2026-07-27T22:17:57.563106+00:00
---

## 背景

Phase 1 の入力は「日記（LINE）」と「スワイプアンケート（Web）」の 2 本立てで確定している（[プロジェクト概要 §4](../../docs/project-overview.md#4-想定する利用体験)）。Web 側は issue 11 / 12 で LIFF の初期化と ID トークン検証まで通ったが、**肝心の回答画面がまだ無い**。`apps/web` は `/api/health` を叩くだけのスケルトンで、`src/index.css` に素の CSS と CSS 変数がある状態。

## 確定した方針

### デザインシステム

**Tailwind CSS（v4 / `@tailwindcss/vite`）と lucide-react のみを使う。** アニメーション・ジェスチャーのライブラリ（framer-motion, react-spring, react-tinder-card 等）は導入せず、スワイプは Pointer Events + CSS transform / transition で自前実装する。

理由: スワイプの追従・回転・飛ばしは transform と transition だけで表現でき、依存を増やすとバンドルサイズと LIFF 内 WebView での挙動確認の対象が増える。

### 既存 CSS の扱い

**既存の `src/index.css` を Tailwind へ全面移行する**（素の CSS を残して併存させない）。

理由:

- `index.css` の CSS 変数の色はすべて Tailwind 既定パレットと同値（`#0f172a` = `slate-900`、`#1e293b` = `slate-800`、`#38bdf8` = `sky-400`、`#34d399` = `emerald-400`）。1:1 で置き換えられ、見た目が変わらない
- `button { ... }` のような**要素セレクタ**が残ると、以降に追加するすべてのコンポーネントのボタンへ暗黙に効く。スワイプアンケートは選択ボタンを持つため、併存させると原因の分かりにくい上書きを抱え込む
- Tailwind v4 のユーティリティに `.container` があり、既存の `.container` クラスと名前が衝突する。レイヤーの優先順位に頼った共存は脆い

### 型の置き場所

**質問・回答の型は `apps/web/src/survey/` に閉じる。`packages/shared` へは置かない。**

理由: `packages/shared` へ置くと、アプリ間で共有する契約＝サーバーとのスキーマを確定したことになる。[設計スコープのルール §2](../../.agents/rules/design-scope.md) は「質問（アンケート）の具体的なエンティティや集約」と「API、イベントの具体的なスキーマ」を後続設計へ延期しており、それに反する。共有先はサーバー連携を実装する時点（issue 19）で判断する。

## やったこと

1. `bun add tailwindcss @tailwindcss/vite lucide-react --cwd apps/web`（[開発運用ルール §2](../../.agents/rules/development.md)）
2. `vite.config.ts` へ `@tailwindcss/vite` を追加し、`index.css` を `@import "tailwindcss"` + `@layer base` へ置き換え。`App.tsx` の既存 2 カード（LIFF / API health）と inline style をユーティリティクラスへ移行
3. `src/survey/` を追加
   - `types.ts`: 質問・選択肢・回答の型。回答は「選択」と「スキップ」の union。質問は版 (`version`) を持ち、回答は回答時点の版を指す
   - `questions.ts`: `fetchSurveyQuestions()` と 6 問のモック。**後でサーバー実装へ差し替えるモジュール境界**
   - `swipe.ts`: しきい値・傾き・transform・キー割り当ての純粋関数
   - `answers.ts`: 回答の組み立てと集計
   - `swipe.test.ts` / `answers.test.ts`: DOM を用意しない単体テスト
4. `src/components/` にカードスタックの UI を追加
   - 最前面を Pointer Events でドラッグ（`setPointerCapture` で要素外へ出ても追従）
   - しきい値はカード幅の 28%（56〜140px にクランプ）。傾きの上限は 14°
   - 選択予告のオーバーレイ（アイコン + ラベル、濃さがドラッグ量に比例）
   - スワイプ以外に選択ボタンとキーボード（← / → で回答、↓ であとで回答）。すべて同じ `commit()` へ集約
   - スキップは方向を持たないのでカードを飛ばさず即座に進む
   - 進捗（何問目 / 全何問）とプログレスバー、完了表示（回答数 / スキップ数、やり直し）
   - `prefers-reduced-motion: reduce` で飛ばすアニメーションと transition を省く
5. アイコンはアイコン名の union → lucide コンポーネントのレジストリ（`survey-icon.tsx`）を表示層に置き、質問データを JSON のまま保った

## 実機相当の確認で見つけて直した表示の問題

ヘッドレス Chromium（幅 390px / 1280px）で操作して見つけたもの。

- 選択予告のオーバーレイが質問文に重なっていた → 質問文の上にオーバーレイ用の帯を確保
- 重なりのカードを半透明（`opacity: 1 - depth * 0.3`）にしていたため、手前のカードの背景を通して**さらに奥のカードの文字が透けて読めていた** → 重なり内は不透明にし、位置と大きさの差だけで表現
- 選択ボタンに `min-w-0` が無く、ラベルの最小幅の分だけ横へはみ出して横スクロールが出ていた
- カードを画面外へ飛ばすと横スクロールが生まれていた → `html` と `body` の両方へ `overflow-x: clip`（片方だけでは実際のスクロールが残る）
- 完了アイコンが縦 flex の中で高さだけ縮んで潰れていた（48×14px）→ `shrink-0`

## スコープ外

- **質問の取得・回答の保存 API（サーバー連携）** → issue 19
- 回答の一覧・修正・削除の画面
- 質問の版管理の実装（型に版を持たせるところまで）

## 完了条件

- [x] スワイプ・ボタン・キーボードのいずれでも回答できる
- [x] しきい値未満で元位置へ戻り、超えると次のカードが前面に出る
- [x] スキップができ、完了表示まで到達する
- [x] `prefers-reduced-motion: reduce` で飛ばしのアニメーションが無効になる
- [x] 既存の LIFF カード / API health カードの表示が壊れていない
- [x] Tailwind と lucide-react 以外の UI 系依存を追加していない
- [x] `task ci` が成功する

## PR

<https://github.com/kkyosuke/me-builder/pull/26>
