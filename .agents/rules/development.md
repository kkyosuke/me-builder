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
    - `task generate:api`: APIのOpenAPI documentとWeb UI用TypeScript型を再生成
    - `task ci`: CI で実行される全検証（lint, typecheck, test, build）の一括ローカル実行
    - `task db:migrate:local` (または `task db:migrate`): D1 データベースマイグレーションのローカル適用
    - `task db:migrate:preview`: プレビュー環境への D1 データベースマイグレーション適用
    - `task db:migrate:production`: 本番環境への D1 データベースマイグレーション適用
    - `task queues:setup:preview`: プレビュー環境のChat Turn QueueとDLQを冪等に作成
    - `task queues:setup:production`: 本番環境のChat Turn QueueとDLQを冪等に作成
    - `task db:seed:local`: ローカルD1へ診断seedを適用
    - `task db:seed:preview`: プレビューD1へ診断seedを適用
    - `task db:seed:production`: 本番D1へ診断seedを明示的に適用
    - `task deploy:preview`: D1 マイグレーション適用および全アプリのプレビュー環境へのデプロイ (`wrangler deploy --env preview`, `wrangler pages deploy`)
    - `task deploy:production`: D1 マイグレーション適用および全アプリの本番環境へのデプロイ (`wrangler deploy --env production`, `wrangler pages deploy`)
  - **CI/CD ワークフロー構造 (`.github/workflows/ci-*.yml`, `.github/workflows/cd-*.yml`)**:
    - CI ワークフローはコンポーネントごとの個別の YAML ファイルに分離されています (`ci-lint.yml`, `ci-shared.yml`, `ci-api.yml`, `ci-mcp.yml`, `ci-worker.yml`, `ci-ui.yml`)。
    - CD ワークフローはプレビュー・本番デプロイ用に分離されています (`cd-preview.yml`, `cd-production.yml`)。
    - PR 作成・更新時には `cd-preview.yml` が全検証後に Cloudflare プレビュー環境へ自動デプロイします。
    - `main` ブランチマージ時には `cd-production.yml` が全検証後に Cloudflare 本番環境へ自動デプロイします。
    - リポジトリのチェックアウト、Bun のセットアップ、`actions/cache@v4` によるキャッシュ、および `bun install --frozen-lockfile` の一連の処理は GitHub Composite Action ([.github/actions/setup-bun-workspace](file:///Users/kyosuke/git/github.com/KKyosuke/me-builder/.github/actions/setup-bun-workspace/action.yml)) に共通化されています。
  - パッケージの追加・削除はルートから `bun add <package> --cwd <workspace-dir>`（例: `bun add @line/liff --cwd apps/web`）を使用し、個別ディレクトリで `npm install` を実行しないこと。ルートで引数なしに `bun add <package>` を実行するとルートの `package.json` に入ってしまうため、対象ワークスペースを必ず指定します。
- **Web UI (`apps/web`) のカスタムドメイン**:
  - `apps/web` は Cloudflare **Pages** で配信するため、Workers (`api` / `mcp` / `worker`) のように `wrangler.toml` の `routes` で DNS レコードを自動作成できません。ドメインのプロジェクト登録と DNS の CNAME 作成は [`scripts/setup-pages-domain.ts`](../../scripts/setup-pages-domain.ts) が行い、`apps/web` の `deploy:preview` / `deploy:production` から呼び出します。
  - 対象ドメインは `BASE_DOMAIN` を使い、スクリプト側にハードコードしません。CNAME の宛先は preview がブランチエイリアス、production がプロジェクト既定のホストです。
  - preview CDがPRへ投稿する完了コメントには、各サービスのカスタムドメインに加えて、`CLOUDFLARE_ACCOUNT_ID`から組み立てたCloudflare DashboardのWorkers & Pages管理画面へのリンクを掲載します。生のURLではなくMarkdownのリンク記法（`[表示テキスト](URL)`）で書き、表示テキストはサービスがホスト名、Dashboardが遷移先を表す文言にします。
  - このスクリプトは `CLOUDFLARE_API_TOKEN` に Zone:Read / DNS:Edit の権限を必要とします。権限や環境変数が足りない場合は警告を出して**デプロイを止めずにスキップ**します（DNS の設定漏れでデプロイ自体を失敗させない）。
- **Web UI (`apps/web`) の環境変数**:
  - Vite がクライアントバンドルへ埋め込むのは `VITE_` 接頭辞付きの環境変数だけです。変数を追加した場合は [`apps/web/.env.example`](../../apps/web/.env.example) へ必ず追記します。
  - バンドルへ埋め込まれた値は閲覧者から参照できます。チャネルシークレットや API キーなどのシークレットを `VITE_` 変数へ置いてはいけません。秘匿が必要な値はサーバー側 (`apps/api`) の環境変数として配布します。
  - `VITE_` 変数はビルド時にバンドルへ埋め込まれます。CD ワークフローは GitHub Actions 上で `bun run ci`（Vite ビルド）を実行し、`wrangler pages deploy dist` でビルド済みアセットのみをアップロードするため、**値の設定先は GitHub Actions の変数**（`cd-preview.yml` / `cd-production.yml` の `env:` に `${{ vars.* }}` として記述、環境は preview が `dev` / production が `prd`）です。Cloudflare Pages プロジェクト側の環境変数は Pages Functions の実行時にしか効かず、この構成ではバンドルへ反映されません。
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

- **Cloudflare AI Gateway 経由の Gemini 接続**:
  - Google AI Studio の呼び出しは `apps/worker/src/infrastructure/gemini-client.ts` に閉じ込め、`@google/genai` の `GoogleGenAI` を Cloudflare AI Gateway の Google AI Studio provider URL へ接続します。
  - `GOOGLE_AI_STUDIO_API_KEY` と `CLOUDFLARE_AIG_TOKEN` は Worker の Secret として配布します。クライアントバンドル、`wrangler.toml` の `[vars]`、ログへ出力してはいけません。
  - Gateway URL は `CF_AI_GATEWAY_BASE_URL`、モデルは `GEMINI_MODEL` で上書きできます。未指定時は設定層の既定値を利用します。
  - ローカルの接続確認は `apps/worker/.env.example` を参照して環境変数を設定し、`bun --cwd apps/worker run check:gemini` を実行します。プロンプトはコマンド末尾の引数で変更できます。

- **LINE Webhook 自動登録および日記の受付返信**:
  - API サーバー起動時 (`src/index.ts`) または CLI スクリプト (`bun run register:webhook`) の実行時、`LINE_CHANNEL_ACCESS_TOKEN` および `LINE_WEBHOOK_URL` (または `BASE_URL`) が環境変数として与えられている場合、公式 SDK (`@line/bot-sdk`) の `MessagingApiClient.setWebhookEndpoint` を用いて自動的に LINE Messaging API へ Webhook Endpoint URL を登録・更新します。
  - Webhook受信メッセージは決定的なcommand routing後にCloudflare Queues経由でQueue Worker (`apps/worker`) へ配信します。診断commandの返信は既存の`replyToken`経路を使い、日記の受領応答と最終応答は[日記チャット実装設計](../../docs/architecture/diary-chat-implementation-design.md#9-38秒sloと配送)を正とします。**送られた本文をオウム返ししません。**
  - 署名検証に成功した1対1トークのテキストメッセージでは、API ServerがQueue投入前に`MessagingApiClient.showLoadingAnimation`を呼び、60秒のチャットローディングを表示します。診断、日記、AIチャットを受信側で重複判定せず、いずれも同じ待機表示にします。グループトークと非テキストイベントは対象外です。ローディングAPIの完了はQueue投入前に待たず、Cloudflare Workersでは`executionCtx.waitUntil`へ渡してWebhook応答のクリティカルパスから外します。ローディングAPIの失敗はQueue投入を止めず、本人識別子である`userId`をログへ出力しません（[LINE公式ガイド](https://developers.line.biz/en/docs/messaging-api/use-loading-indicator/)）。
  - 返信には「今日の診断」への導線として LIFF の URL (`https://liff.line.me/{LIFF_ID}`) を添えます。LINE 内から Web を開く主導線であり、設計は [プロジェクト概要 §4](../../docs/product/project-overview.md#4-想定する利用体験) を正とします。文面の組み立ては `apps/worker` の `buildReplyText` に集約します。
  - テキストメッセージは**既定で日記として扱い**、診断のリンクを求めるキーワード (`診断` など) だけを例外として切り出します。判定は`packages/lib`の`classifyLineText`へ集約し、API WorkerがQueue投入前に実行します。Queue Workerは渡された`diagnosis-request` / `diary`のunionをschema検証し、同じ関数で再判定して不一致なら処理しません。
    - キーワードの判定は **NFKC 正規化・前後の空白除去・ひらがなからカタカナへの寄せの後で完全一致**させます。部分一致は採りません。部分一致にすると「今日は会社で診断に答えた」のような日記本文がコマンドとして飲み込まれ、蓄積の量を担う日記が記録されなくなります。
    - `diagnosis-request` の返信は診断へのリンクだけを返します。`diary` の返信は従来どおり受け付けた旨とリンクを返します（日記の返信は診断への主要な再訪導線なので、キーワードの追加でも変えません）。
    - 日記の本文はログへ出力せず、判定結果 (`intent`) だけを残します。
  - `LIFF_ID` は `apps/worker` へ配布します。秘密情報ではありませんが、GitHub Environment の変数を単一の出所とするため、CDワークフローが一時的なsecretファイルを作り、`wrangler deploy --secrets-file`でコードと同じWorker Versionへ配布します。未設定の場合はリンクを省き、受け付けた旨だけを返します。
  - 環境変数が未設定の場合は自動登録および返信処理がログ出力とともに安全にスキップされます。

- **LINE Webhook の署名検証 (`x-line-signature`)**:
  - `POST /api/line/webhook` は、Queue 投入前に必ず `x-line-signature` ヘッダを検証します。検証は公式 SDK (`@line/bot-sdk`) の `validateSignature` (HMAC-SHA256 + timing-safe 比較) に委譲し、`packages/lib` の `line.webhook.verifySignature` として提供します。
  - 検証は **受信した生のリクエストボディ文字列** に対して行います。`c.req.json()` の結果を再度 `JSON.stringify` するとバイト列が変わり検証が壊れるため、`await c.req.text()` で取得した文字列を検証し、通過後に `JSON.parse` してください。
  - ヘッダ欠落・署名不一致は `401 Unauthorized` を返し、Queue 投入・LINE 返信・D1 書き込みのいずれも行いません。拒否時は `logger.warn` で構造化ログを出力しますが、**署名値およびチャネルシークレットそのものはログに含めません**。
  - チャネルシークレットは `LINE_CHANNEL_SECRET` として`apps/api`にのみ配布します（CloudflareはCDの`wrangler deploy --secrets-file`、ローカルは`.env`）。`wrangler.toml`の`[vars]`には置きません。CDはsecretをコードと同じWorker Versionへ原子的にアップロードし、デプロイ後の`wrangler secret put`は実行しません。
  - `LINE_CHANNEL_SECRET` は **必須** です。未設定の場合は環境 (`local` / `preview` / `production`) を問わず署名検証をスキップせず、`logger.error` を出力したうえで全ての Webhook リクエストを 401 で拒否します。ローカルで Webhook 受信と返信の動作確認を行う場合も `.env` にチャネルシークレットを設定してください。

- **Web UI のデザインシステム (`apps/web`)**:
  - UI は **Tailwind CSS** のユーティリティと **lucide-react** のアイコンだけで組みます。他の UI コンポーネントライブラリ、アニメーションライブラリ、ジェスチャーライブラリ (framer-motion, react-spring, react-tinder-card 等) は導入しません。スワイプなどの操作は Pointer Events と CSS transform / transition で実装します。
  - Tailwind は `@tailwindcss/vite` プラグインとして読み込み、PostCSS 設定ファイルは持ちません。`src/index.css` はTailwindと基礎スタイルだけを持ち、**コンポーネント固有の素の CSS やクラス定義を増やしません**（要素セレクタが以降のコンポーネントへ暗黙に効くため）。LIFF内の古いWebViewがCascade Layersをブロックごと無視することを避けるため、`tailwindcss/index.css` は使わず、`theme.css`、`preflight.css`、`utilities.css` をこの順で直接読み込み、ビルド後処理で全ての `@layer` を展開します。後処理後のCSSは内容から新しいファイル名を採番し、LIFFブラウザに変換前のCSSがキャッシュされないようにします。
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
  - Account の解決は `d1.action.account.resolveAccountByLineLogin` に集約します。`line_login` の identity → 同じ値の `line` の identity（同一プロバイダーなら userId が一致する）の順に探し、後者で見つかった場合は `line_login` を同じ Account へ紐づけます。
  - **どちらも見つからない場合は Account を作らず 404 を返します。** アカウント作成の起点は LINE 公式アカウントの友だち追加です（[プロジェクト概要 §5](../../docs/product/project-overview.md#5-アカウントと本人識別)）。userId が一致しない構成での紐づけ手段は未設計です。
  - 既存の Account へログイン手段を追加するのは `d1.action.account.linkIdentity` です。`upsertIdentity` は見つからなければ新規 Account を作るため、この用途に使ってはいけません。
  - `LINE_LOGIN_CHANNEL_ID` は `apps/api` へ配布します。未設定の場合は `LIFF_ID` の接頭辞から補完します。ID トークン・アクセストークン・`sub` はレスポンスにもログにも含めません。
  - **`accountId` をクライアントへ返しません。** セッションとトークンの管理方式は[ドメイン設計](../../docs/domain/domain-design.md)で未決定であり、返すと後続リクエストで「クライアントが送ってきた `accountId`」を信頼する実装を誘発します。返すのは表示に使う `displayName` / `pictureUrl` だけです。
  - **LIFF の ID トークンには `nonce` を設定できません**（`liff.login()` に nonce のパラメータがない）。そのためリプレイを nonce で防げず、代わりに `line.idToken.verify` の `maxAgeSeconds` で受け入れる発行後の経過時間を絞れるようにしています。既定は LIFF の ID トークンの有効期間と同じ 1 時間（LINE 側の検証より厳しくしない）で、検証成功時に経過秒数だけをログへ出力するので、実際の分布を見てから絞れます。恒久的な対策はサーバー発行のセッションであり、方式が決まってから対応します。

- **LIFF アプリのエンドポイント URL の自動登録**:
  - Webhook Endpoint URL と同じく、デプロイのたびに「今デプロイした URL」を LIFF アプリへ反映します。ロジックは `packages/lib` の `line.liff.registerEndpoint`、実行は `bun --cwd apps/web scripts/register-liff.ts <preview|production>` で、CD ワークフローのデプロイ後に呼び出します。
  - LIFF Server API は **LINE Login チャネル** のチャネルアクセストークンを要求します (Messaging API チャネルのトークンでは操作できません)。トークンは client credentials で発行し、有効期間が短くて発行数の上限がないステートレストークンを優先します。
  - `LINE_LOGIN_CHANNEL_SECRET` は Secret、`LINE_LOGIN_CHANNEL_ID` は変数として GitHub Environment へ置きます。チャネル ID が未設定の場合は LIFF ID の接頭辞 (`{チャネルID}-{ランダム}`) から補完します。
  - 更新対象は `LIFF_ID` が一致するアプリ、無ければ `description`（`me-builder-web (preview)` など）が一致するアプリです。どちらも無ければ新規作成し、発行された LIFF ID をログへ出力します。環境名はビルド時の値ではなく引数で渡します（preview と production で同じ description を掴まないため）。
  - **scope は `openid` と `profile` を必ず設定します。** `openid` が無いと `liff.getIDToken()` が ID トークンを返さず、サーバー側で本人性を検証できません（[LIFF リファレンス](https://developers.line.biz/en/reference/liff/#get-id-token)）。エンドポイント URL の更新時にも scope を毎回送り、手で外された場合に次のデプロイで復旧できるようにします。
  - 環境変数が未設定の場合は警告を出して安全にスキップします。チャネルシークレットとチャネルアクセストークンはログへ出力せず、トークンエンドポイントのレスポンス本文も転記しません。

## 5. コミット・Git 運用ルール

- `node_modules`, `.bun`, `dist` などのインストール生成物およびビルド成果物は絶対にコミットに含まないこと。
- 新規ファイル追加時は [`.gitignore`](../../.gitignore) の除外ルールを満たしているか事前に確認すること。
- 変更後は必ず `git diff --check` を実行して不要な末尾空白や構文エラーがないか確認すること。
- PR作成時は [PR作成手順書](../../docs/development/pull-request-guidelines.md) に従い、タイトルの命名規約 (`<type>(<scope>): <説明>`) および PR テンプレート ([`.github/PULL_REQUEST_TEMPLATE.md`](../../.github/PULL_REQUEST_TEMPLATE.md)) に沿って作成すること。
