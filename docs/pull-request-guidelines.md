# Pull Request 作成ガイドライン (PR Creation Guidelines)

## 目的

本ドキュメントは、me-builder リポジトリにおいて Pull Request（PR）を作成する際の手順、タイトルの命名規則、および概要の記述ルールを定義する **SSoT (Single Source of Truth)** です。
PRの形式を標準化することで、コードレビューの品質向上とCI/CD運用の円滑化を図ります。

---

## 1. PR作成前の準備

PRを作成する前に、必ず以下の準備を行ってください。

```
[ローカル開発作業]
       │
       ▼
 1. main ブランチの最新変更を取り込む (git pull / rebase)
       │
       ▼
 2. ローカル検証を実行する (task ci)
       │
       ▼
 3. 不要なコミット・一時ファイルを削除する (git status / git diff --check)
       │
       ▼
 4. 作業ブランチをリモートへ push する (git push origin <branch-name>)
```

### 1-1. `main` ブランチの最新化
ベースブランチとのコンフリクトを回避するため、最新の `origin/main` を取り込みます。
```bash
git fetch origin
git rebase origin/main
```

### 1-2. ローカルでの検証実行
CIで実行される検証が一通り成功するかローカルで確認します。
```bash
task ci
```
*(※ `task ci` は Biome の Lint/Format チェック、TypeScript 型チェック、Vitest による単体テスト、ビルド検証を一元実行します)*

### 1-3. 差分および不要ファイルのチェック
不要なログファイル、ビルド生成物 (`dist/` 等)、または末尾の余分な空白が含まれていないか確認します。
```bash
git diff --check
```

---

## 2. PRタイトルの命名規則

PRのタイトルは [Conventional Commits](https://www.conventionalcommits.org/) の形式に準拠し、以下のフォーマットで記述します。

```text
<type>(<scope>): <簡潔な説明>
```

※ Scope が不要な全体的・汎用的な変更の場合は、`<type>: <簡潔な説明>` とすることも可能です。

### 2-1. Type 一覧

| Type | 説明 | 例 |
| --- | --- | --- |
| `feat` | 新機能の追加 | `feat(api): 認証エンドポイントを追加` |
| `fix` | バグ修正 | `fix(web): ボタンのレスポンシブ表示のズレを修正` |
| `docs` | ドキュメントのみの変更 | `docs: PR作成手順書とテンプレートを作成` |
| `style` | コードの意味に影響を与えない変更（フォーマット等） | `style(shared): インデントとクォートの統一` |
| `refactor` | 仕様変更やバグ修正を含まないコード再構築 | `refactor(mcp): ツールハンドラーの共通処理を抽出` |
| `test` | テストコードの追加・修正 | `test(api): Userモデルのユニットテストを追加` |
| `chore` | ビルドプロセスや補助ツールの変更・依存関係更新 | `chore(deps): パッケージ依存関係を最新化` |
| `ci` | CI/CD 設定ファイルやスクリプトの変更 | `ci(web): Web用GitHub Actionsのトリガー条件を修復` |

### 2-2. Scope 一覧 (モノレポ構成)

| Scope | 対象範囲 |
| --- | --- |
| `web` | `apps/web` (React UI フロントエンド) |
| `api` | `apps/api` (Bun + Hono API サーバー) |
| `mcp` | `apps/mcp` (MCP サーバー) |
| `shared` | `packages/shared` (共有型定義・ユーティリティ) |
| `deps` | パッケージ全体の依存関係管理 |
| `docs` | `docs/` または `.agents/` 内のドキュメント |

---

## 3. PR概要 (Description) の書き方

PR作成時には、`.github/PULL_REQUEST_TEMPLATE.md` で定義されたテンプレートが自動的に挿入されます。以下の各セクションに従って必要な情報を記載してください。

### 3-1. 各セクションの記述ルール

#### 1. 概要 (Summary)
- **目的と背景**: なぜこの変更が必要なのか（解決する課題や追加する価値）を簡潔に書きます。
- **変更の要約**: 主な変更内容を1〜3文程度でまとめます。

#### 2. 関連 Issue / PR (Related Issues / PRs)
- 関連する GitHub Issue や事前PRのリンクを記載します。
- 例: `Closes #12`, `Ref #45`

#### 3. 変更内容 (Changes Made)
- 変更箇所の詳細を箇条書きで記載します。
- モノレポ構造に合わせて、影響範囲ごとに整理するとレビューしやすくなります。

#### 4. 動作確認・検証手順 (Verification / How to Test)
- どのように動作確認・テストを行ったかを明記します。
- 実行したコマンド (`task ci`, `task test` など) や、ローカル環境での手動確認結果を記述します。
- UIに変更がある場合は、スクリーンショットや操作動画を添付することを推奨します。

#### 5. 事前チェックリスト (Checklist)
- 提出前に自身でチェックマーク (`[x]`) を入れます。

---

## 4. PR作成手順

### 4-1. GitHub CLI を使用する場合 (推奨)
ターミナルから `gh` コマンドでPRを作成できます。
```bash
gh pr create --title "docs: PR作成手順書とテンプレートを作成" --body-file .github/PULL_REQUEST_TEMPLATE.md
```
または対話モードで作成します。
```bash
gh pr create
```

### 4-2. GitHub Web UI を使用する場合
1. リポジトリページ (`https://github.com/KKyosuke/me-builder`) を開きます。
2. プッシュしたブランチを選択し、**Compare & pull request** をクリックします。
3. タイトルを規則通りに入力し、テンプレートに従って概要を記述します。
4. **Create pull request** をクリックします。

---

## 5. PR作成後のフロー

1. **CI ワークフローの確認**:
   - PR作成後、自動実行される GitHub Actions (CI) がすべてパス (緑チェック) しているか確認します。
2. **レビュー対応**:
   - レビュアーからのコメントやフィードバックに対応し、必要に応じて追加コミットを push します。
3. **マージ**:
   - CIが成功し、必要な承認を得たらマージします。
