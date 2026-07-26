# 開発運用ルール

## 1. 目的

本リポジトリで作業する Agent および開発者が、Bun Workspaces を用いたモノレポ環境で安全かつ一貫して開発・保守を行うための注意点と約束事を定義します。

## 2. モノレポ構造とパッケージ管理

- **パッケージ構成**:
  - `apps/web`: React UI (Vite + TypeScript)
  - `apps/api`: Bun.serve + Hono API Server
  - `apps/mcp`: Cloudflare / Bun 上で動作する MCP Server スケルトン
  - `apps/worker`: Cloudflare Queues メッセージを消費する Worker
  - `packages/shared`: 共有型定義・ユーティリティ
  - `packages/lib`: LINE連携等の共通ドメイン・ヘルパーライブラリ
- **タスク実行とコマンド (`Taskfile.yml`)**:
  - 開発タスクはルートの `Taskfile.yml` 経由で実行します。
    - `task install` (または `task i`): 全パッケージの依存関係インストール (`bun install`)
    - `task dev`: 全開発サーバー（UI, API, MCP, Worker）の並行起動
    - `task dev:ui`: React UI の個別起動
    - `task dev:api`: API サーバーの個別起動
    - `task dev:mcp`: MCP サーバーの個別起動
    - `task dev:worker`: Worker の個別起動
    - `task build`: 全パッケージのビルド
    - `task typecheck`: 全パッケージの TypeScript 型チェック
    - `task lint`: Biome によるコード Lint / フォーマット検証
    - `task lint:fix`: Biome によるコード Lint / フォーマットの自動修復
    - `task test`: Vitest による全テスト実行
    - `task ci`: CI で実行される全検証（lint, typecheck, test, build）の一括ローカル実行
    - `task db:migrate:local` (または `task db:migrate`): D1 データベースマイグレーションのローカル適用
    - `task db:migrate:preview`: プレビュー環境への D1 データベースマイグレーション適用
    - `task db:migrate:production`: 本番環境への D1 データベースマイグレーション適用
    - `task deploy:preview`: D1 マイグレーション適用および全アプリのプレビュー環境へのデプロイ (`wrangler deploy --env preview`, `wrangler pages deploy`)
    - `task deploy:production`: D1 マイグレーション適用および全アプリの本番環境へのデプロイ (`wrangler deploy --env production`, `wrangler pages deploy`)
  - **CI/CD ワークフロー構造 (`.github/workflows/ci-*.yml`, `.github/workflows/cd-*.yml`)**:
    - CI ワークフローはコンポーネントごとの個別の YAML ファイルに分離されています (`ci-lint.yml`, `ci-shared.yml`, `ci-api.yml`, `ci-mcp.yml`, `ci-worker.yml`, `ci-ui.yml`)。
    - CD ワークフローはプレビュー・本番デプロイ用に分離されています (`cd-preview.yml`, `cd-production.yml`)。
    - PR 作成・更新時には `cd-preview.yml` が全検証後に Cloudflare プレビュー環境へ自動デプロイします。
    - `main` ブランチマージ時には `cd-production.yml` が全検証後に Cloudflare 本番環境へ自動デプロイします。
    - リポジトリのチェックアウト、Bun のセットアップ、`actions/cache@v4` によるキャッシュ、および `bun install --frozen-lockfile` の一連の処理は GitHub Composite Action ([.github/actions/setup-bun-workspace](file:///Users/kyosuke/git/github.com/KKyosuke/me-builder/.github/actions/setup-bun-workspace/action.yml)) に共通化されています。
  - パッケージの追加・削除はルートで `bun add <package> --filter <workspace>` を使用し、個別ディレクトリで `npm install` を実行しないこと。


## 3. 共有パッケージ (`packages/*`) の開発ルール

- **型・ソースの直参照**:
  - モノレポ内の共有パッケージ（`packages/shared` 等）は、`package.json` の `"main"` および `"types"` に `./src/index.ts` を直接指定します。
  - トランスパイル成果物（`.d.ts`, `.js`, `.js.map`）を `src/` 配下に生成・コミットしてはいけません。
  - ビルドテスト等で `dist/` へ出力される成果物は `.gitignore` により自動的にコミット対象外となります。
- **構造化 JSON ログ基盤 (`Pino`)**:
  - モノレポ全体のログ出力基盤として `packages/shared` が `Pino` を用いたロガー機能 (`createLogger`, `logger`) を提供します。
  - 各アプリケーション (`apps/api`, `apps/mcp` 等) やライブラリでのログ出力には `console.log` / `console.error` の代わりに `@me-builder/shared` の `logger` を使用し、構造化 JSON 形式で統一出力します。


## 4. API Server および MCP Server の実装ルール

- **Web標準 API の遵守**:
  - API サーバーおよび MCP サーバーは `Bun.serve` および **Hono** フレームワークを採用します。
  - 固有の非標準 API や特定のランタイム依存を避け、`Request`, `Response`, `fetch` などの Web標準 API / Web Standard Response に準拠して実装してください。これにより、ローカル (`bun serve`) とクラウド・エッジ (Cloudflare Workers 等) の双方向でそのまま稼働可能にします。
- **環境設定管理 (`src/config/`)**:
  - `@me-builder/shared` が提供する `getEnv` 関数を用いて、Cloudflare Workers Bindings (`c.env`) およびローカル環境 (`process.env`) の差分を吸収し、生の環境変数を取得・URL 補完・Valibot パースを行い設定オブジェクトを組み立てて返却します。

- **LINE Webhook 自動登録およびオウム返し機能**:
  - API サーバー起動時 (`src/index.ts`) または CLI スクリプト (`bun run register:webhook`) の実行時、`LINE_CHANNEL_ACCESS_TOKEN` および `LINE_WEBHOOK_URL` (または `BASE_URL`) が環境変数として与えられている場合、公式 SDK (`@line/bot-sdk`) の `MessagingApiClient.setWebhookEndpoint` を用いて自動的に LINE Messaging API へ Webhook Endpoint URL を登録・更新します。
  - Webhook 受信メッセージは Cloudflare Queues 経由で Queue Worker (`apps/worker`) に配信され、`replyToken` を使用して `MessagingApiClient.replyMessage` により送信元ユーザーへ同内容を返信 (オウム返し) します。
  - 環境変数が未設定の場合は自動登録および返信処理がログ出力とともに安全にスキップされます。

## 5. コミット・Git 運用ルール

- `node_modules`, `.bun`, `dist` などのインストール生成物およびビルド成果物は絶対にコミットに含まないこと。
- 新規ファイル追加時は [`.gitignore`](../../.gitignore) の除外ルールを満たしているか事前に確認すること。
- 変更後は必ず `git diff --check` を実行して不要な末尾空白や構文エラーがないか確認すること。
- PR作成時は [PR作成手順書](../../docs/pull-request-guidelines.md) に従い、タイトルの命名規約 (`<type>(<scope>): <説明>`) および PR テンプレート ([`.github/PULL_REQUEST_TEMPLATE.md`](../../.github/PULL_REQUEST_TEMPLATE.md)) に沿って作成すること。
