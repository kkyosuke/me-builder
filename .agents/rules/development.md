# 開発運用ルール

## 1. 目的

本リポジトリで作業する Agent および開発者が、Bun Workspaces を用いたモノレポ環境で安全かつ一貫して開発・保守を行うための注意点と約束事を定義します。

## 2. モノレポ構造とパッケージ管理

- **パッケージ構成**:
  - `apps/web`: React UI (Vite + TypeScript)
  - `apps/api`: Bun.serve + Hono API Server
  - `apps/mcp`: Phase 2向けの MCP Server スケルトン（初期リリースではユーザー向け機能を提供しない）
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
    - `task audit`: `bun audit` による既知脆弱性の検査
    - `task test`: Vitest による全テスト実行
    - `bun run test:unit`: E2Eを除外したテスト実行（`test:pre-push`は同じもののpre-push向けの別名）
    - `bun run test:e2e`: E2EとWorker runtime E2Eだけのテスト実行
    - `task generate:api`: APIのOpenAPI documentとWeb UI用TypeScript型を再生成
    - `task ci`: 依存関係監査, 生成物差分, lint, 未使用export, Markdown lint, typecheck, test（E2Eを含む全体）, build の一括ローカル実行。`cd-production.yml`が本番デプロイ前に実行するものと同じで、リンク切れ確認は含みません（相対リンクは`ci.yml`、外部URLは`scheduled-checks.yml`が担当）
    - `task db:migrate:local` (または `task db:migrate`): D1 データベースマイグレーションのローカル適用
    - `task db:migrate:preview`: プレビュー環境への D1 データベースマイグレーション適用
    - `task db:migrate:production`: 本番環境への D1 データベースマイグレーション適用
    - `task queues:setup:preview`: プレビュー環境の非同期処理用Queue（Billing / Chat Turn / Brain Checkpoint / Profile Summary / Brain Vector / Daily Prompt）と各DLQを冪等に作成
    - `task queues:setup:production`: 本番環境の非同期処理用Queue（Billing / Chat Turn / Brain Checkpoint / Profile Summary / Brain Vector / Daily Prompt）と各DLQを冪等に作成
    - `task vectorize:setup:preview`: プレビュー環境のBrain Vectorize indexと`owner_scope` metadata indexを冪等に作成・検証
    - `task vectorize:setup:production`: 本番環境のBrain Vectorize indexと`owner_scope` metadata indexを冪等に作成・検証
    - metadata indexの作成 (`wrangler vectorize create-metadata-index`) はmutationをキューへ積むだけで、`list-metadata-index`へ現れるまでの時間に保証がありません。**反映をポーリングで待たせないでください**（待っても保証されず、デプロイ時間だけが伸びます）。setupは1回だけ確認し、未反映なら警告を出して続行し、**型違いで既に存在する場合だけ**デプロイを止めます
    - `list-metadata-index`が返す`indexType`は、Cloudflare SDKの型宣言が`'string' | 'number' | 'boolean'`であるのに対し、実際のAPIは`String`のように**先頭を大文字にして返します**。比較するときは大文字小文字を無視してください
    - `task access:setup:preview`: プレビュー環境のOpenAPI documentとSwagger UI用パスをCloudflare Accessで保護
    - `task access:setup:production`: 本番環境のOpenAPI documentとSwagger UI用パスをCloudflare Accessで保護
    - `task stripe:setup:preview`: Stripe test modeの商品catalog、Webhook、Customer PortalとCloudflare secretを冪等に同期
    - `task stripe:setup:production`: 明示確認付きでStripe live modeの商品catalog、Webhook、Customer PortalとCloudflare secretを冪等に同期
    - `bun --cwd apps/worker do:generate`: AccountDataのmigrationを`packages/lib/drizzle-do-account/`へ、ConversationCoordinatorとCompatibilityDataのmigrationを`apps/worker/drizzle/<durable-object>/`へ生成
    - `task db:seed:local`: ローカルD1へ診断seedを適用
    - `task db:seed:preview`: プレビューD1へ診断seedを適用
    - `task db:seed:production`: 本番D1へ診断seedを明示的に適用
    - `task deploy:preview`: D1 マイグレーション適用および全アプリのプレビュー環境へのデプロイ (`wrangler deploy --env preview`, `wrangler pages deploy`)
    - `task deploy:production`: D1 マイグレーション適用および全アプリの本番環境へのデプロイ (`wrangler deploy --env production`, `wrangler pages deploy`)
  - **CI/CD ワークフロー構造 (`.github/workflows/*.yml`)**:
    - CI は単一の `ci.yml` (job 名 `Verify`) にまとめています。パッケージごとに job を分けると、1 回の push で 6〜7 個の job がそれぞれ checkout と `bun install` を払い直し、GitHub Actions の課金が job ごとに分単位へ切り上げられるため、実際の検証時間の 2 倍近くを消費します。**検証内容を増やすためにパッケージ単位のワークフローを復活させないでください。**
    - `ci.yml` は PR (`pull_request`) と手動実行 (`workflow_dispatch`) だけで動きます。`main` への push では CI ワークフローを走らせません。コード変更時は`bun audit`を実行し、既知脆弱性が1件でも検出された場合は失敗します。マージ後の検証は `cd-production.yml` の `bun run ci` が担い、同じ監査を含む検証を二重に課金しません。
    - `ci.yml` はルートの `bun run test:unit` を実行します。1 プロセスの `vitest run` で `apps/web` を含む全パッケージのテストを流します。パッケージごとに `vitest` を起動し直すより速く済みます。
    - **E2E は `ci.yml` では実行しません。** E2E (7 ファイル) だけで通常のテスト全体 (106 ファイル) に匹敵する時間がかかるため、`e2e` ラベルが付いた PR で `ci-e2e.yml` が実行します。ラベルが無ければ job ごと skip され、GitHub Actions の課金対象になりません。`main` へマージする直前は `cd-production.yml` の `bun run ci` が E2E を含めて実行するため、E2E を通さずに本番へ出ることはありません。
    - テストの区分は npm script で表します。`test` が全体、`test:unit` が E2E を除いた分、`test:e2e` が E2E と Worker runtime E2E です。`test:unit` と `test:e2e` は重複も漏れもなく `test` を二分します。**E2E は `e2e/` ディレクトリ配下に置くか `*.e2e.test.*` という名前にしてください**（`test:e2e` はパスに `e2e` を含むかで選別します）。
    - `ci.yml` は `dorny/paths-filter` で変更領域を判定し、コードが変わっていない PR ではコードの検証を、ドキュメントが変わっていない PR では Markdown lint を飛ばします。トリガー側に `paths:` を書かないため、ワークフロー自体は常に結果を報告します。**どちらのフィルタにも一致しない変更は全検証へ倒します**（列挙から漏れたファイルだけの PR が「1 つも検証せず success」になるのを防ぐため）。
    - 同じ PR へ続けて push したときは `concurrency` で古い実行を打ち切ります (`cancel-in-progress: true`)。共有環境を触る CD ワークフローだけは打ち切りません。
    - 外部サービスの応答を待つ検証は `scheduled-checks.yml` (毎週月曜 + 手動実行) に隔離します。対象は Markdown の**外部 URL** のリンク切れ確認と、本番 LINE Webhook への疎通確認 (`register-webhook.ts --force`) です。失敗の原因が外部側の変化であってPRの変更ではないものは、ここへ寄せます。
    - **相対リンクの切れは PR の変更が直接引き起こす**（ファイル名変更など）ため、`ci.yml` で `bun run lint:md:links:relative` として検証します。外部 URL を除外した設定 (`mlc_config.relative.json`) を使うのでネットワーク待ちがありません。
    - `lint:md:links` 系は `find ... -print0 | xargs -0 markdown-link-check` の形で書きます。`find -exec` は実行したコマンドの終了ステータスを伝播せず、**リンクが切れていても常に成功してしまいます**。また 1 プロセスへまとめて渡すことでファイル毎の起動コストを避けます (実測 73 秒 → 1 秒)。knip は pipe の先のバイナリを辿れないため、`markdown-link-check` は `knip.json` の `ignoreDependencies` に入れています。
    - CD ワークフローはプレビュー・本番デプロイ用に分離されています (`cd-preview.yml`, `cd-production.yml`)。
    - `cd-preview.yml` は PR の作成・更新だけでは**デプロイしません**（プレビューは全 PR 共有の単一環境のため、自動デプロイで上書きし合うのを避ける）。デプロイされるのは次の 2 通りだけです。
      - Actions 画面でブランチを選ぶか `gh workflow run cd-preview.yml --ref <branch>` で手動実行したとき (`workflow_dispatch`)
      - PR に `deploy` ラベルが付いているとき（ラベル付与時と、その後の push）。ラベルを外せば以降の push ではデプロイされませんが、**すでにデプロイ済みの環境は元に戻りません**。
    - 共有環境の取り合いを避けるため `concurrency: cd-preview` で直列化しています。実行中のデプロイは中断せず、待機中の実行だけが新しいものへ置き換わります。
    - `reset-preview-migrations.yml` は Actions 画面または `gh workflow run reset-preview-migrations.yml --ref <branch> -f confirmation=reset-preview` からだけ起動します。選択したブランチを基準に Preview D1 のCloudflare予約table以外（`d1_migrations`を含む）と全 Durable Object namespaceを削除し、同じD1 database resourceへD1 migration、診断seedを再適用してWorker / API / MCPを再デプロイします。全Previewデータを復元不能に削除するため確認文字列を必須とし、productionは対象にしません。`cd-preview`と同じconcurrency groupで直列化します。実行時に選んだブランチをそのままcheckoutするため、migration・seed・deployとresource IDのcommit先は同じブランチになります（tagからは実行できません）。
      - 再作成でresource IDが変わったときの反映先は、実行したブランチで変わります。**`main`から実行した場合**は`chore/preview-resource-ids-<run id>`ブランチへcommitしてPRを作成し、同じjobで`bun run ci`が通ったときだけsquash mergeします（`main`はrulesetで直接pushできないため）。検証が落ちたときはPRを開いたまま残します。**それ以外のブランチから実行した場合**は、そのブランチへ直接commitしてpushし、PRは作りません。ブランチの持ち主がそのまま作業を続けられるようにするためで、検証はその人のPRの`ci.yml`が担います。
      - `GITHUB_TOKEN`で作成したPRは`pull_request`イベントを発火せず`ci.yml`が走らないため、GitHubのauto-mergeではなくjob内の検証をマージ条件にします。
    - `setup-stripe-billing.yml` はStripeとCloudflareの課金設定を手動同期します。Environmentごとのsecret、承認、確認文字列、実行方法は[Stripe課金環境の同期運用](../../docs/development/stripe-billing-setup.md)を正とします。
    - `main` ブランチマージ時には `cd-production.yml` が全検証後に Cloudflare 本番環境へ自動デプロイします。ProductionはMVP中核機能を提供する実環境のため、Cloudflare、公開domain、LINE Messaging API / LINE Login / LIFF、Vertex AI、Stripe課金、配送・仮名化secret、API documentationのAccess許可先をデプロイ前に必須検証します。Stripe課金は同期workflowがCloudflareへ永続化したruntime secret binding名も確認します。欠落時はデプロイをskipして成功扱いにせず、外部状態を変更する前にjobを失敗させます。
    - Bun のセットアップ、キャッシュ、および `bun install --frozen-lockfile` の一連の処理は GitHub Composite Action (`.github/actions/setup-bun-workspace`) に共通化されています。
    - キャッシュは 2 種類あります。依存キャッシュ (`~/.bun/install/cache`) はルートの `bun.lock` のハッシュをキーにします (`**/bun.lock` はツリー全体を走査するため使いません)。型チェックの incremental 情報 (`**/*.tsbuildinfo`) は復元だけを全ワークフローで行い、保存は `main` の `cd-production.yml` だけが行います。PR ごとに保存するとリポジトリのキャッシュ上限 (10GB) を圧迫し、依存キャッシュが追い出されるためです。
    - `tsconfig.json` の `incremental` は、この tsbuildinfo キャッシュを効かせるために有効化しています。無効化するとキャッシュが無意味になります。
  - パッケージの追加・削除はルートから `bun add <package> --cwd <workspace-dir>`（例: `bun add @line/liff --cwd apps/web`）を使用し、個別ディレクトリで `npm install` を実行しないこと。ルートで引数なしに `bun add <package>` を実行するとルートの `package.json` に入ってしまうため、対象ワークスペースを必ず指定します。
  - 上流パッケージが脆弱な推移依存を固定している場合は、ルート`package.json`の`overrides`で修正版を固定します。削除・緩和する前に`bun audit`が0件であることと`task ci`が通ることを確認してください。
  - pre-pushではブランチ名、型、E2E以外のテストを検証します。ローカルD1などを使うE2Eはpushの必須条件にせず、`task test`と`task ci`、GitHub Actionsでは`e2e`ラベル付きPRの`ci-e2e.yml`と`cd-production.yml`が実行します。
  - `postinstall`の`lefthook install`はGitHub Actions上でもhookを設置するため、ワークフロー内でcommit / pushするstepには`LEFTHOOK: "0"`を設定してhookを無効化します。hookはローカル開発者向けの検証であり、ワークフロー側は`bun run ci`などで同じ検証を明示的に実行します。
  - ワークフローが`GITHUB_TOKEN`で作成したPRは`pull_request`イベントを発火せず、`ci.yml`が起動しません。自動PRをテスト結果で条件付きにマージする場合は、GitHubのauto-mergeやrequired status checksに頼らず、PRを作った同じjobで検証を実行してからマージします。
  - 環境変数を読む設定関数のテストで「未設定ならundefined」を検証する場合は、`vi.stubEnv(<name>, undefined)`で実行環境の値を消します。`getEnv`はCloudflare Workersの`env`に無いキーを`process.env`から補うため、GitHub Actionsのjob levelの`env`が混ざるとローカルだけ通るテストになります。
- **Web UI (`apps/web`) のカスタムドメイン**:
  - `apps/web` は Cloudflare **Pages** で配信するため、Workers (`api` / `mcp` / `worker`) のように `wrangler.toml` の `routes` で DNS レコードを自動作成できません。ドメインのプロジェクト登録と DNS の CNAME 作成は [`scripts/setup-pages-domain.ts`](../../scripts/setup-pages-domain.ts) が行い、`apps/web` の `deploy:preview` / `deploy:production` から呼び出します。
  - 対象ドメインは `BASE_DOMAIN` を使い、スクリプト側にハードコードしません。CNAME の宛先は preview がブランチエイリアス、production がプロジェクト既定のホストです。
  - preview CDが実行サマリー（`$GITHUB_STEP_SUMMARY`）へ出力する完了メッセージ、および `deploy` ラベル経由の実行でPRへ投稿する完了コメントには、各サービスのカスタムドメインに加えて、`CLOUDFLARE_ACCOUNT_ID`から組み立てたCloudflare DashboardのWorkers & Pages管理画面へのリンクを掲載します。生のURLではなくMarkdownのリンク記法（`[表示テキスト](URL)`）で書き、表示テキストはサービスがホスト名、Dashboardが遷移先を表す文言にします。
  - このスクリプトは実行時の `CLOUDFLARE_API_TOKEN` に Zone:Read / DNS:Edit の権限を必要とします。GitHub Actionsではインフラ専用Secret `CLOUDFLARE_DEPLOY_API_TOKEN` をこの標準環境変数名へマッピングします。権限や環境変数が足りない場合は警告を出して**デプロイを止めずにスキップ**します（DNS の設定漏れでデプロイ自体を失敗させない）。
- **Web UI (`apps/web`) の環境変数**:
  - Vite がクライアントバンドルへ埋め込むのは `VITE_` 接頭辞付きの環境変数だけです。変数を追加した場合は [`apps/web/.env.example`](../../apps/web/.env.example) へ必ず追記します。
  - バンドルへ埋め込まれた値は閲覧者から参照できます。チャネルシークレットや API キーなどのシークレットを `VITE_` 変数へ置いてはいけません。秘匿が必要な値はサーバー側 (`apps/api`) の環境変数として配布します。
  - `VITE_` 変数はビルド時にバンドルへ埋め込まれます。CD ワークフローは GitHub Actions 上で、preview は `bun --filter @me-builder/web build`、production は全検証を兼ねた `bun run ci` によりViteビルドを実行し、`wrangler pages deploy dist` でビルド済みアセットのみをアップロードします。そのため、**値の設定先は GitHub Actions の変数**（`cd-preview.yml` / `cd-production.yml` の `env:` に `${{ vars.* }}` として記述、環境は preview が `dev` / production が `prd`）です。Cloudflare Pages プロジェクト側の環境変数は Pages Functions の実行時にしか効かず、この構成ではバンドルへ反映されません。
  - GitHub Environment の変数名には `VITE_` 接頭辞を付けず、ワークフロー側で `VITE_` 付きの環境変数へマップします（例: `VITE_BASE_DOMAIN: ${{ vars.BASE_DOMAIN }}`、`VITE_LIFF_ID: ${{ vars.LIFF_ID }}`）。
  - 変数を追加した場合は `cd-preview.yml` と `cd-production.yml` の両方へ渡し、環境ごとに異なる値を GitHub Environment の変数として設定します。

## 3. 共有パッケージ (`packages/*`) の開発ルール

- **型・ソースの直参照**:
  - モノレポ内の共有パッケージ（`packages/shared` 等）は、`package.json` の `"main"` および `"types"` に `./src/index.ts` を直接指定します。
  - トランスパイル成果物（`.d.ts`, `.js`, `.js.map`）を `src/` 配下に生成・コミットしてはいけません。
  - ビルドテスト等で `dist/` へ出力される成果物は `.gitignore` により自動的にコミット対象外となります。
- **構造化 JSON ログ基盤 (`Pino`)**:
  - モノレポ全体のログ出力基盤として `packages/shared` が `Pino` を用いたロガー機能 (`createLogger`, `logger`) を提供します。
  - 各アプリケーション (`apps/api`, `apps/mcp` 等) やライブラリでのログ出力には `console.log` / `console.error` の代わりに `@me-builder/shared` の `logger` を使用し、構造化 JSON 形式で統一出力します。
  - フローを横断する追跡、エラー原因と最終結果の記録、記録禁止情報の方針は[アプリケーション運用ログ方針](../../docs/development/operational-logging.md)を正とします。

## 4. アプリケーション実装ルール (API / MCP / Web UI)

- **Web標準 API の遵守**:
  - API サーバーおよび MCP サーバーは `Bun.serve` および **Hono** フレームワークを採用します。
  - 固有の非標準 API や特定のランタイム依存を避け、`Request`, `Response`, `fetch` などの Web標準 API / Web Standard Response に準拠して実装してください。これにより、ローカル (`bun serve`) とクラウド・エッジ (Cloudflare Workers 等) の双方向でそのまま稼働可能にします。
- **層の分離 (`src/controller/` と `src/logic/`)**:
  - **`logic/` は HTTP を知りません。** ステータスコードやレスポンスボディを返さず、ドメイン上の結果を判別可能な union（例: `resolved` / `unauthenticated` / `account-not-found`）として返します。
  - **`controller/` が HTTP との境界**です。リクエストの解釈（ボディのパース、バインディングの確認）と、`logic` が返した結果から `Response` への変換だけを担当します。ルート定義 (`src/index.ts`) からは controller を呼ぶだけにします。
  - controller はパスの区分ごとに 1 ファイルにまとめます（例: `controller/line.ts` が `/api/line/` 配下を担当）。エンドポイントごとにファイルを増やしません。
  - テストも層ごとに分けます。`logic` はドメインの結果を検証し、`controller` は `logic` をモックして HTTP への変換だけを検証します。
  - `apps/worker` の `handler/` と `logic/` も同じ分離です。

- **環境設定管理 (`src/config/`)**:
  - `@me-builder/shared` が提供する `getEnv` 関数を用いて、Cloudflare Workers Bindings (`c.env`) およびローカル環境 (`process.env`) の差分を吸収し、生の環境変数を取得・URL 補完・Valibot パースを行い設定オブジェクトを組み立てて返却します。

- **Vertex AI Express Mode の Gemini 接続**:
  - Vertex AI Express Mode の呼び出しは `apps/worker/src/infrastructure/gemini-client.ts` に閉じ込め、`@google/genai` の `GoogleGenAI` を`vertexai: true`とAPI version `v1`で初期化してGoogleへ直接接続します。
  - `GOOGLE_VERTEX_AI_API_KEY`はWorker Secretだけに配布し、クライアントバンドル、`wrangler.toml`の`[vars]`、APIレスポンス、ログへ出力してはいけません。
  - モデルは `GEMINI_MODEL` で上書きできます。未指定時は設定層の既定値を利用します。
  - ローカルの接続確認は `apps/worker/.env.example` を参照して環境変数を設定し、`bun run --cwd apps/worker check:gemini` を実行します。プロンプトはコマンド末尾の引数で変更できます。

- **LINE Webhook 自動登録および日記返信**:
  - API サーバー起動時 (`src/index.ts`) または CLI スクリプト (`bun run register:webhook`) の実行時、`LINE_CHANNEL_ACCESS_TOKEN` および `LINE_WEBHOOK_URL` (または `BASE_URL`) が環境変数として与えられている場合、公式 SDK (`@line/bot-sdk`) の `MessagingApiClient.setWebhookEndpoint` を用いて自動的に LINE Messaging API へ Webhook Endpoint URL を登録・更新します。
  - 登録処理はまず現在の登録状態を問い合わせ、**要求するURLが既に有効な状態で登録済みなら何もしません**。`testWebhookEndpoint`はLINE PlatformがWebhook URLを実際に呼び出して応答を待つため十数秒かかり、URLが変わらないデプロイで毎回実行する価値がないためです。登録内容を書き換えたときだけ、登録後のURL一致、Webhookの有効化状態、LINE Platformから登録URLへの疎通を公式SDKで検証し、いずれかが不成立ならデプロイを失敗させます。URLを変えずに疎通を確かめたいときは `bun --cwd apps/api scripts/register-webhook.ts --force` を使います。
  - 本番のWebhook URLは環境ごとに固定なので、この短絡によりCDでは疎通確認が事実上走らなくなります。Cloudflare AccessやルーティングでLINE Platformから到達できなくなる劣化を検知するため、`scheduled-checks.yml`が週次で`--force`付きの疎通確認を実行します。
  - Geminiへの最小リクエストによる接続確認は、`cd-production.yml`でのみデプロイ前に実行し、接続不良がある状態を本番へ出しません。共有の使い捨て環境であるpreviewのCDでは実行しません。応答本文やSecretはログへ出力しません。
  - Webhook受信メッセージは決定的なcommand routing後にCloudflare Queues経由でQueue Worker (`apps/worker`) へ配信します。診断commandの返信は既存の`replyToken`経路を使い、日記の最終応答は[日記チャット実装設計](../../docs/architecture/diary-chat-implementation-design.md#9-38秒sloと配送)を正とします。**送られた本文をオウム返ししません。**
  - 署名検証に成功した1対1トークのテキストメッセージでは、API ServerがQueue投入前に`MessagingApiClient.showLoadingAnimation`を呼び、60秒のチャットローディングを表示します。診断、日記、AIチャットを受信側で重複判定せず、いずれも同じ待機表示にします。グループトークと非テキストイベントは対象外です。ローディングAPIの完了はQueue投入前に待たず、Cloudflare Workersでは`executionCtx.waitUntil`へ渡してWebhook応答のクリティカルパスから外します。ローディングAPIの失敗はQueue投入を止めず、本人識別子である`userId`をログへ出力しません（[LINE公式ガイド](https://developers.line.biz/en/docs/messaging-api/use-loading-indicator/)）。
  - 日記では独立した受付Pushを送らず、`showLoadingAnimation`の後にAIの最終応答をPushします。最終応答には診断導線を付加しません。LINE 内から Web を開く主導線はリッチメニューであり、設計は [Phase 1 診断体験設計 §7](../../docs/diagnosis/diagnosis-experience.md#7-リッチメニュー) を正とします。
  - テキストメッセージは**既定で日記として扱い**、診断のリンクを求めるキーワード (`診断` など) だけを例外として切り出します。判定は`packages/lib`の`classifyLineText`へ集約し、API WorkerがQueue投入前に実行します。Queue Workerは渡された`diagnosis-request` / `diary`のunionをschema検証し、同じ関数で再判定して不一致なら処理しません。
    - キーワードの判定は **NFKC 正規化・前後の空白除去・ひらがなからカタカナへの寄せの後で完全一致**させます。部分一致は採りません。部分一致にすると「今日は会社で診断に答えた」のような日記本文がコマンドとして飲み込まれ、蓄積の量を担う日記が記録されなくなります。
    - `diagnosis-request` の返信は診断へのリンクだけを返します。`diary` は待機表示後、診断リンクを付けずにAIの最終応答を返します。
    - 日記の本文はログへ出力せず、判定結果 (`intent`) だけを残します。
  - `LIFF_ID` は `apps/worker` へ配布します。秘密情報ではありませんが、GitHub Environment の変数を単一の出所とするため、CDワークフローが一時的なsecretファイルを作り、`wrangler deploy --secrets-file`でコードと同じWorker Versionへ配布します。未設定の場合は`diagnosis-request`へリンクを利用できない旨を返信します。
  - 環境変数が未設定の場合は自動登録および返信処理がログ出力とともに安全にスキップされます。

- **APIドキュメントのCloudflare Access設定**:
  - PreviewとProductionへのデプロイ前に`task access:setup:preview`または`task access:setup:production`を実行し、[インフラ・システム構成](../../docs/architecture/infrastructure-architecture.md#61-apiドキュメントのcloudflare-access境界)で定めたパスだけを保護します。
  - 許可する開発者メールアドレスはGitHub Environment変数`CLOUDFLARE_ACCESS_ALLOWED_EMAILS`へカンマ区切りで設定します。空、または不正なメールアドレスを含む場合は設定処理とデプロイを失敗させます。
  - `CLOUDFLARE_DEPLOY_API_TOKEN`には、既存のデプロイ権限に加えて`Access: Apps and Policies Write`を付与します。Access APIエラーを警告へ変換せず、保護できない状態でデプロイを続行しません。
  - Access Applicationを作成する前に、Cloudflare DashboardでアカウントのZero Trust organizationを初期化します。organizationの認証ドメインはアカウント全体の設定であり、このデプロイスクリプトの管理対象には含めません。Application作成がError 1010で拒否された場合は、まずこの初期化状態とAPI tokenの権限を確認します。
  - スクリプトは環境ごとのApplication名、または保護対象のOpenAPI documentと同じドメインを持つ既存Applicationを管理対象として解決します。既存Applicationを更新する前にpolicyを検査し、管理していないpolicyが存在する場合は、意図しないAllow条件を温存しないよう自動削除・更新せず停止します。複数のApplicationが管理対象候補になる場合も自動統合せず停止し、Cloudflare Dashboardで内容を確認してから解消してください。

- **LINE Webhook の署名検証 (`x-line-signature`)**:
  - `POST /api/line/webhook` は、Queue 投入前に必ず `x-line-signature` ヘッダを検証します。検証は公式 SDK (`@line/bot-sdk`) の `validateSignature` (HMAC-SHA256 + timing-safe 比較) に委譲し、`packages/lib` の `line.webhook.verifySignature` として提供します。
  - 検証は **受信した生のリクエストボディ文字列** に対して行います。`c.req.json()` の結果を再度 `JSON.stringify` するとバイト列が変わり検証が壊れるため、`await c.req.text()` で取得した文字列を検証し、通過後に `JSON.parse` してください。
  - ヘッダ欠落・署名不一致は `401 Unauthorized` を返し、Queue 投入・LINE 返信・D1 書き込みのいずれも行いません。拒否時は `logger.warn` で構造化ログを出力しますが、**署名値およびチャネルシークレットそのものはログに含めません**。
  - チャネルシークレットは `LINE_CHANNEL_SECRET` として`apps/api`にのみ配布します（CloudflareはCDの`wrangler deploy --secrets-file`、ローカルは`.env`）。`wrangler.toml`の`[vars]`には置きません。CDはsecretをコードと同じWorker Versionへ原子的にアップロードし、デプロイ後の`wrangler secret put`は実行しません。
  - `LINE_CHANNEL_SECRET` は **必須** です。未設定の場合は環境 (`local` / `preview` / `production`) を問わず署名検証をスキップせず、`logger.error` を出力したうえで全ての Webhook リクエストを 401 で拒否します。ローカルで Webhook 受信と返信の動作確認を行う場合も `.env` にチャネルシークレットを設定してください。
  - 署名検証後の `WEBHOOK_QUEUE` 未設定は、preview / production などのデプロイ環境では構成エラーとして 5xx を返し、LINE Platform の再送対象にします。ローカル開発環境では Queue を用意せず署名検証まで確認できるよう、構造化された縮退ログを残して 200 を返します。

- **Web UI のデザインシステム (`apps/web`)**:
  - UI は **Tailwind CSS** のユーティリティと **lucide-react** のアイコンだけで組みます。他の UI コンポーネントライブラリ、アニメーションライブラリ、ジェスチャーライブラリ (framer-motion, react-spring, react-tinder-card 等) は導入しません。スワイプなどの操作は Pointer Events と CSS transform / transition で実装します。
  - Tailwind は `@tailwindcss/vite` プラグインとして読み込み、PostCSS 設定ファイルは持ちません。`src/index.css` はTailwindと基礎スタイルだけを持ち、**コンポーネント固有の素の CSS やクラス定義を増やしません**（要素セレクタが以降のコンポーネントへ暗黙に効くため）。LIFF内の古いWebViewがCascade Layersをブロックごと無視することを避けるため、`tailwindcss/index.css` は使わず、`theme.css`、`preflight.css`、`utilities.css` をこの順で直接読み込み、ビルド後処理で全ての `@layer` を展開します。後処理後のCSSは内容から新しいファイル名を採番し、LIFFブラウザに変換前のCSSがキャッシュされないようにします。
  - APIの`GET`による初回データ取得中は、結果画面のカード、行、画像などの配置に近いSkeleton UIを表示し、取得前後のレイアウト変化を抑えます。画面モジュールの遅延読み込みやLIFF初期化、`POST` / `PUT` / `DELETE`の処理中には一律適用しません。再取得時に表示済みデータがある場合はデータを残し、更新操作の近くへ進行状態を表示します。
  - Skeleton UIは`aria-busy="true"`と処理対象が分かる読み上げ名を持つstatusとして通知し、装飾用の骨格は支援技術から隠します。点滅アニメーションには`motion-reduce:animate-none`を併記します。
  - アニメーションは `prefers-reduced-motion: reduce` を尊重します。移動そのものを止めるのではなく、指の操作への追従は残し、自動で動く演出を省きます。
  - 操作手段をポインタだけに依存させません。LINE 内 (LIFF) の主導線に加えて外部ブラウザの導線も維持しているため ([プロジェクト概要 §4](../../docs/product/project-overview.md#4-想定する利用体験))、同じ操作をボタンとキーボードでも行える状態を保ちます。

- **Web UI のディレクトリ構成 (`apps/web/src`)**:

  ```text
  apps/web/src/
  ├── feature/
  │   └── <feature-name>/
  │       ├── model/            # 型・状態・純粋なビジネスロジック
  │       ├── presentation/     # React UI・UI操作ロジック
  │       │   └── components/
  │       ├── infrastructure/   # API・SDK・ストレージなどのadapter
  │       └── index.ts          # feature外へ公開するAPI
  ├── infrastructure/
  │   └── <shared-adapter>.ts   # feature横断の技術基盤
  ├── generated/                # API契約などから生成したコード（直接編集禁止）
  ├── config/                   # 環境設定の読込・検証
  ├── components/               # feature非依存の共通UI
  ├── App.tsx
  └── main.tsx
  ```

  各featureは、型と純粋なロジックを `model/`、React UIとUI操作ロジックを `presentation/`、API・SDK・ローカルデータとの接続を `infrastructure/`、feature外へ公開する要素を `index.ts` に置きます。`presentation/` と `infrastructure/` は `model/` に依存できますが、`model/` から他の層へは依存しません。feature外からは原則として `index.ts` 経由で参照します。必要な層だけを作り、空の層は用意しません。ルートの `components/` はfeatureに依存しない共通UI、`infrastructure/` は複数featureから利用する技術基盤だけを所有します。

- **スワイプ診断の画面 (`apps/web`)**:
  - Diagnosis機能は `apps/web/src/feature/diagnosis/` に置きます。一覧・質問・保存済み回答は `infrastructure/diagnosis-api.ts` でAPIから取得し、コンポーネントは取得元や採点方法を知りません。
  - 診断一覧、質問、診断IDと採点設定の対応表をWeb UIへ重複定義しません。採点はAPI Serverが所有し、Web UIは計算済み結果だけを表示します。APIから受け取った質問・回答などの画面用モデルは `apps/web/src/feature/diagnosis/model/` に閉じます。
  - Phase 1の回答選択肢は「いいえ」「はい」の2件とし、Choice IDとラベルをAPIから取得します。選択肢固有のアイコン対応表をWeb UIへ持ちません。
  - 判定や座標計算 (しきい値、傾き、transform) は純粋関数として `apps/web/src/feature/diagnosis/presentation/` に置き、DOM を用意せず単体テストできる状態にします。

- **Web UI の LIFF 初期化 (`apps/web`)**:
  - LINE 内から Web を開く主導線は LIFF です。導線の設計と根拠は [プロジェクト概要 §4](../../docs/product/project-overview.md#4-想定する利用体験) を正とし、このルールには再掲しません。
  - LIFF ID は `VITE_LIFF_ID` として与え、`apps/web/src/config` の Valibot スキーマ経由で optional な `liffId` として取得します。SDK を呼ぶコードから `import.meta.env` を直接読まないこと。
  - LIFF機能は `apps/web/src/feature/liff/` に置きます。`@line/liff` の呼び出しは `infrastructure/liff-client.ts`、セッションAPIとの通信は `infrastructure/session-api.ts` に閉じ込め、React コンポーネントから SDK やAPIを直接呼ばないこと。コンポーネントは初期化結果の状態オブジェクトだけを受け取ります。
  - `VITE_LIFF_ID` が未設定の場合は、LIFF 初期化を `logger` へのログ出力とともに安全にスキップし、LIFF なしの画面を表示します（LINE Webhook 自動登録と同じ「環境変数が未設定なら安全にスキップする」方針）。
  - `liff.init` の失敗時、および外部ブラウザで開かれた場合 (`liff.isInClient()` が false) も画面を白にせず、状態を画面へ表示します。LIFF の初期化結果を画面表示の前提条件にしないこと。
  - LINE の `userId` は本人識別子です。**画面表示もログ出力も行わず**、表示は `displayName` と `pictureUrl` に限ります ([プロジェクト概要 §8](../../docs/product/project-overview.md#8-プライバシーと安全性))。ID トークンおよびアクセストークンもログへ出力しません。

- **Web UI のHTTP通信基盤 (`apps/web`)**:
  - `fetch` の直接呼び出しは `apps/web/src/infrastructure/http-client.ts` に閉じ込めます。各featureのAPI adapterは共通HTTPクライアントを介して通信します。
  - 共通HTTPクライアントはベースURLとパスの解決、およびWeb標準の `fetch` 実行だけを担当します。エンドポイント固有のヘッダー、レスポンス検証、HTTPステータスからドメイン・画面表示用結果への変換は各featureの `infrastructure/` が担当します。
  - Web UIが利用するAPIの型はOpenAPIから `apps/web/src/generated/api.ts` へ生成し、直接編集しません。生成方法とAPI ServerのHTTP契約の配置は[API契約とクライアント型の生成](../../docs/development/api-contract-generation.md)を参照します。

- **LIFF の ID トークン検証と Account の解決**:
  - **クライアントから送られてきた識別子は受け付けません。** `liff.getProfile()` が返す値そのものは LINE から取得した本物ですが、サーバー側では「LINE の API が返した値の転送」と「手で書かれた値」を区別できないため、`userId` を識別子として使うと他人になりすませます。本人の識別子は必ず ID トークンの検証で得た `sub` を使います。
  - 用途で使い分けます。**画面表示**（`displayName` / `pictureUrl`）は `liff.getProfile()` の値でよく（嘘をつけても本人の画面の表示が変わるだけ）、**本人の識別・認可**は検証済みの `sub` だけを使います。検証は `packages/lib` の `line.idToken.verify`（LINE の `POST /oauth2/v2.1/verify` へ委譲）で行い、`aud` が LINE Login チャネル ID と一致することを受け取り側でも確認します。
  - エンドポイントは `POST /api/line/liff/session`。
  - LINE Login側のAccount解決は `D1.shared.action.account.resolveAccountByLineLogin` に集約します。`line_login` の identity → 同じ値の `line` の identity（同一プロバイダーならuserIdが一致する）の順に探し、後者で見つかった場合は`line_login`を同じAccountへ紐づけます。どちらも見つからない場合は、検証済みの`sub`から`line_login` identity付きのAccountを作成します。
  - Messaging API側のAccount解決は`D1.shared.action.account.resolveAccountByLineMessagingApi`に集約します。Account作成の競合で同じ人物が2つに分かれないよう、まず同じ値の`line_login` identityを冪等に解決してから`line` identityを追加します。Webから先に利用したAccountも、後日の友だち追加またはメッセージで同じAccountへ接続します。
  - `line_login` identityだけを持つAccountはWeb機能を利用できます。LINEからの日記入力、通知、日々の声かけは`line` identityが追加されるまで利用できません。Account作成起点と利用可能範囲は[プロジェクト概要 §5](../../docs/product/project-overview.md#5-アカウントと本人識別)を正とします。
  - 既存の Account へログイン手段を追加するのは `D1.shared.action.account.linkIdentity` です。`upsertIdentity` は見つからなければ新規 Account を作るため、この用途に使ってはいけません。
  - `LINE_LOGIN_CHANNEL_ID` は `apps/api` へ配布します。LIFF 設定の形式検証と解決は `packages/lib` の LINE 設定を正とし、`apps/api`・`apps/web`・`apps/worker` から共用します。未設定の場合は `LIFF_ID` の接頭辞から補完します。明示した場合は接頭辞と一致しなければならず、不正な設定ではビルド・デプロイやリクエスト処理を開始しません。ID トークン・アクセストークン・`sub` はレスポンスにもログにも含めません。
  - **`accountId` をクライアントへ返しません。** セッションとトークンの管理方式は[ドメイン設計](../../docs/domain/domain-design.md)で未決定であり、返すと後続リクエストで「クライアントが送ってきた `accountId`」を信頼する実装を誘発します。返すのは表示に使う `displayName` / `pictureUrl` と、管理者導線の表示に使う検証済みAccountの`role`だけです。`role`は表示判定のための情報であり、管理者API側の認可を省略する根拠にはしません。
  - **LIFF の ID トークンには `nonce` を設定できません**（`liff.login()` に nonce のパラメータがない）。そのためリプレイを nonce で防げず、代わりに `line.idToken.verify` の `maxAgeSeconds` で受け入れる発行後の経過時間を絞れるようにしています。既定は LIFF の ID トークンの有効期間と同じ 1 時間（LINE 側の検証より厳しくしない）で、検証成功時に経過秒数だけをログへ出力するので、実際の分布を見てから絞れます。恒久的な対策はサーバー発行のセッションであり、方式が決まってから対応します。

- **LIFF アプリのエンドポイント URL の自動登録**:
  - Webhook Endpoint URL と同じく、デプロイのたびに「今デプロイした URL」を LIFF アプリへ反映します。ロジックは `packages/lib` の `line.liff.registerEndpoint`、実行は `bun --cwd apps/web scripts/register-liff.ts <preview|production>` で、CD ワークフローのデプロイ後に呼び出します。
  - LIFF Server API は **LINE Login チャネル** のチャネルアクセストークンを要求します (Messaging API チャネルのトークンでは操作できません)。トークンは client credentials で発行し、有効期間が短くて発行数の上限がないステートレストークンを優先します。
  - `LINE_LOGIN_CHANNEL_SECRET` は Secret、`LINE_LOGIN_CHANNEL_ID` は変数として GitHub Environment へ置きます。チャネル ID が未設定の場合は LIFF ID の接頭辞 (`{チャネルID}-{ランダム}`) から補完します。
  - 更新対象は `LIFF_ID` が一致するアプリ、無ければ `description`（`me-builder-web (preview)` など）が一致するアプリです。どちらも無ければ新規作成し、発行された LIFF ID をログへ出力します。環境名はビルド時の値ではなく引数で渡します（preview と production で同じ description を掴まないため）。
  - リッチメニューのLIFF URLにはデプロイしたコミットの短縮SHAをクエリとして付けます。LINE内WebViewが同じLIFF URLの古い画面セッションを再利用し続けないための表示版であり、本人識別や認可には使用しません。
  - リッチメニュー以外の招待リンクや画面内遷移では、LIFF WebViewがデプロイ前のSPAを保持したまま削除済みlazy chunkを要求する場合があります。Webのビルドには`GITHUB_SHA`を版として埋め込み、ルートのError Boundaryはchunk読み込み失敗に限って、同じ版につき1回だけ版付きURLへ自動遷移します。通常の描画エラーや繰り返し失敗では自動再読み込みせず、エラー画面からの手動再読み込みを残します。
  - **scope は `openid` と `profile` を必ず設定します。** `openid` が無いと `liff.getIDToken()` が ID トークンを返さず、サーバー側で本人性を検証できません（[LIFF リファレンス](https://developers.line.biz/en/reference/liff/#get-id-token)）。エンドポイント URL の更新時にも scope を毎回送り、手で外された場合に次のデプロイで復旧できるようにします。
  - 共通ライブラリは環境変数が未設定の場合に警告と失敗結果を返します。運営用の`register-liff.ts`はその結果を非ゼロ終了に変換し、CDが後続の公開処理へ進まないようにします。チャネルシークレットとチャネルアクセストークンはログへ出力せず、トークンエンドポイントのレスポンス本文も転記しません。

## 5. コミット・Git 運用ルール

- `node_modules`, `.bun`, `dist` などのインストール生成物およびビルド成果物は絶対にコミットに含まないこと。
- 新規ファイル追加時は [`.gitignore`](../../.gitignore) の除外ルールを満たしているか事前に確認すること。
- 変更後は必ず `git diff --check` を実行して不要な末尾空白や構文エラーがないか確認すること。
- PR作成時は [PR作成手順書](../../docs/development/pull-request-guidelines.md) に従い、タイトルの命名規約 (`<type>(<scope>): <説明>`) および PR テンプレート ([`.github/PULL_REQUEST_TEMPLATE.md`](../../.github/PULL_REQUEST_TEMPLATE.md)) に沿って作成すること。
