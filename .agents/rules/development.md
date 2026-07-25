# 開発運用ルール

## 1. 目的

本リポジトリで作業する Agent および開発者が、Bun Workspaces を用いたモノレポ環境で安全かつ一貫して開発・保守を行うための注意点と約束事を定義します。

## 2. モノレポ構造とパッケージ管理

- **パッケージ構成**:
  - `apps/web`: React UI (Vite + TypeScript)
  - `apps/api`: Bun.serve + Hono API Server
  - `apps/mcp`: Cloudflare / Bun 上で動作する MCP Server スケルトン
  - `packages/shared`: 共有型定義・ユーティリティ
- **タスク実行とコマンド (`Taskfile.yml`)**:
  - 開発タスクはルートの `Taskfile.yml` 経由で実行します。
    - `task install` (または `task i`): 全パッケージの依存関係インストール (`bun install`)
    - `task dev`: 全開発サーバー（UI, API, MCP）の並行起動
    - `task dev:ui`: React UI の個別起動
    - `task dev:api`: API サーバーの個別起動
    - `task dev:mcp`: MCP サーバーの個別起動
    - `task build`: 全パッケージのビルド
  - パッケージの追加・削除はルートで `bun add <package> --filter <workspace>` を使用し、個別ディレクトリで `npm install` を実行しないこと。

## 3. 共有パッケージ (`packages/*`) の開発ルール

- **型・ソースの直参照**:
  - モノレポ内の共有パッケージ（`packages/shared` 等）は、`package.json` の `"main"` および `"types"` に `./src/index.ts` を直接指定します。
  - トランスパイル成果物（`.d.ts`, `.js`, `.js.map`）を `src/` 配下に生成・コミットしてはいけません。
  - ビルドテスト等で `dist/` へ出力される成果物は `.gitignore` により自動的にコミット対象外となります。

## 4. API Server および MCP Server の実装ルール

- **Web標準 API の遵守**:
  - API サーバーおよび MCP サーバーは `Bun.serve` および **Hono** フレームワークを採用します。
  - 固有の非標準 API や特定のランタイム依存を避け、`Request`, `Response`, `fetch` などの Web標準 API / Web Standard Response に準拠して実装してください。これにより、ローカル (`bun serve`) とクラウド・エッジ (Cloudflare Workers 等) の双方向でそのまま稼働可能にします。

## 5. コミット・Git 運用ルール

- `node_modules`, `.bun`, `dist` などのインストール生成物およびビルド成果物は絶対にコミットに含まないこと。
- 新規ファイル追加時は [`.gitignore`](../../.gitignore) の除外ルールを満たしているか事前に確認すること。
- 変更後は必ず `git diff --check` を実行して不要な末尾空白や構文エラーがないか確認すること。
