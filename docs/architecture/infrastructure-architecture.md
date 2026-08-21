# me-builder インフラ・システム構成

## 1. この文書の目的

me-builderの開発基盤および全体アーキテクチャにおいて、インフラストラクチャおよびシステム構成のSSoT（Single Source of Truth）を定義します。

本サービスでは、高可用性・低遅延・グローバルエッジでのスケーラビリティ・開発運用コストの最小化を実現するため、インフラストラクチャを全面的に **Cloudflare** エコシステムに統一して構築します。

## 2. 所有する概念と所有しない概念

### 所有する概念

- システム全体のブロック構成および技術スタック
- 各 Cloudflare コンポーネント（Pages, Workers, D1, Vectorize, R2, KV, Durable Objects, Workers AI）の役割と配置
- フロントエンド、API、MCPサーバー、ストレージ間のデータフロー
- 開発・プレビュー・本番環境のインフラ運用方針
- Cloudflare Accessで保護する運用エンドポイントと、公開を維持するエンドポイントの境界

### 所有しない概念

- `Account`、`Brain`、`Source` のドメイン境界や責務の定義 — [ドメイン設計](../domain/domain-design.md)
- ラベルの分類・定義およびMCPアクセス許可規則 — [Brainのラベル・アクセス制御設計](../domain/brain/brain-access-label-design.md)
- Brain Itemの分類名および具体例 — [Brain内部情報の分類](../domain/brain/brain-content-taxonomy.md)
- プロジェクトの目標、MVP範囲、全体ロードマップ — [プロジェクト概要](../product/project-overview.md)
- 具体的なデータベーステーブル定義、GraphQL/REST/MCPツール等の個別スキーマ詳細

日記チャットにおける各コンポーネントの連携、物理データモデル、AI実行、安全制御は[日記チャット実装設計](diary-chat-implementation-design.md)を正とします。

## 3. インフラ・システム構成の全体像

me-builderは、全コンポーネントが Cloudflare のグローバルエッジネットワーク上で動作するサーバーレス・エッジファースト構成を採用します。

```mermaid
flowchart TD
    subgraph Clients["利用チャネル / クライアント"]
        Web["Web App / Admin UI"]
        LINE["LINE Bot (Webhook)"]
        Agent["外部 AI Agent (MCP Client)"]
    end

    subgraph Edge["Cloudflare Edge Network"]
        CF_Sec["Cloudflare Access / WAF / DNS"]
        
        subgraph Compute["コンピュート層"]
            Pages["Cloudflare Pages<br/>(Web / Admin Frontend)"]
            WorkersAPI["Cloudflare Workers<br/>(API Server)"]
            WorkersMCP["Cloudflare Workers<br/>(MCP Server)"]
            WorkersWorker["Cloudflare Workers<br/>(Queue Worker)"]
        end

        subgraph Storage["データ & AI層"]
            D1[("Cloudflare D1<br/>(SQLite Relational DB)")]
            Vectorize[("Cloudflare Vectorize<br/>(Vector Search DB)")]
            R2[("Cloudflare R2<br/>(Object Storage)")]
            KV[("Cloudflare KV<br/>(Cache / Session / KV)")]
            Queues[("Cloudflare Queues<br/>(Webhook Message Queue)")]
            DO["Cloudflare Durable Objects<br/>(Stateful / Realtime Session)"]
            WorkersAI["Cloudflare Workers AI<br/>(Embedding / LLM Inference)"]
        end
    end

    Gemini["Google Vertex AI Express Mode<br/>(Gemini)"]
    IdentityPlatform["Google Cloud Identity Platform<br/>(Google login)"]

    Web --> CF_Sec
    LINE --> CF_Sec
    Agent --> CF_Sec

    CF_Sec --> Pages
    CF_Sec --> WorkersAPI
    CF_Sec --> WorkersMCP

    WorkersAPI --> Queues
    Queues --> WorkersWorker
    WorkersWorker --> Gemini
    WorkersAPI --> IdentityPlatform

    WorkersAPI --> D1
    WorkersAPI --> R2
    WorkersAPI --> KV
    WorkersAPI --> Vectorize
    WorkersAPI --> WorkersAI

    WorkersMCP --> DO
    WorkersMCP --> D1
    WorkersMCP --> Vectorize
    WorkersMCP --> KV

    classDef cfFill fill:#f6821f,stroke:#333,stroke-width:1px,color:#fff;
    class Pages,WorkersAPI,WorkersMCP,WorkersWorker,D1,Vectorize,R2,KV,Queues,DO,WorkersAI cfFill;
```

## 4. コンポーネント別の役割と選定

| コンポーネント | Cloudflare サービス | 主な役割・用途 |
| --- | --- | --- |
| **フロントエンド** | **Cloudflare Pages** | Webアプリケーションおよび管理者画面のビルド・ホスティング。高速なエッジ配信と自動プレビューデプロイを実現。 |
| **API サーバー** | **Cloudflare Workers** | HTTP / REST / Webhook API（LINE連携、認証、データ登録等）の処理。軽量な TypeScript/Hono フレームワーク等で構築。 |
| **MCP サーバー（Phase 2）** | **Cloudflare Workers** | 外部 AI エージェント向け MCP (Model Context Protocol) 端点の提供。Workerは既存の運用経路でデプロイするが、初期リリースではユーザー向けMCP機能を提供せず、Phase 2でSSE (Server-Sent Events) および HTTP 通信を提供する。 |
| **キューワーカー** | **Cloudflare Workers** | Cloudflare Queues から非同期メッセージを受信・消費・バックグラウンド処理する非同期ワーカー。 |
| **メッセージキュー** | **Cloudflare Queues** | Webhook 等のイベントを安全に保持・非同期配送するサーバーレスメッセージキュー。 |
| **構造化データストア** | **Cloudflare D1** | サーバーレスリレーショナルデータベース (SQLite)。Account、Identity、role、status、アバターメタデータ、全Account共通の公開定義、原文を含まない集計projectionを保持。日記や診断回答などの個人コンテンツは保持しない。 |
| **ベクトル検索ストア** | **Cloudflare Vectorize** | 完全マネージドなベクトルデータベース。`Brain Item` の埋め込みベクトル（Embedding）を保存し、コサイン類似度等による高速セマンティック検索を提供。 |
| **メディアストレージ** | **Cloudflare R2** | S3互換のオブジェクトストレージ。環境別のprivate bucketへアバターなどのAccount所有メディア原本を保存し、公開URLを持たせずAPI Server bindingから読み書きする。 |
| **キー・バリュー / キャッシュ** | **Cloudflare KV** | 低遅延グローバルキー・バリューストア。認証トークン、一時セッション、アクセス制御キャッシュ、レート制限カウントを保持。 |
| **状態管理 / ドメイン協調** | **Cloudflare Durable Objects** | 個人コンテンツのSSoT。1 Accountにつき1つのprivate SQLiteへ`Source`・`Brain`・`Diary`・`Diagnosis`回答・プロフィール要約を保存し、連投調停や相性関係の協調も担う。 |
| **AI / 推論基盤** | **Vertex AI Express Mode (Gemini)** | Queue WorkerからAPI key認証でテキスト生成とEmbedding生成を実行。本文、生成結果、API keyをアプリケーションログへ残さない。 |
| **外部認証** | **Google Cloud Identity Platform** | Googleの本人確認結果を環境別Identityへ正規化する。Accountとapplication sessionは所有せず、接続条件はWeb認証設計を正とする。 |
| **セキュリティ & ネットワーク** | **Cloudflare Access / WAF** | DDoS防御、WAFルール適用、SSL/TLS証明書管理、管理画面等へのゼロトラストアクセス制御（Cloudflare Access）。 |

## 5. データ連携フロー原則

1. **メディア登録とメタデータ保持**
   - 検証を通過して永続化するユーザー投稿のバイナリデータ（写真・動画・音声）はCloudflare R2へ保存します。
   - アバターのobject key、content type、byte size、etag、更新日時など、Account運営に必要なメディアメタデータは共有D1へ記録します。個人コンテンツに属するメディアの構造化情報との境界は[Accountデータ分離設計](account-data-isolation.md)を正とします。
   - LINE写真日記はアバターとbucket、metadata、処理経路を分離します。取得後の検証、Private R2、AccountData metadata、派生物の境界は[LINE写真日記入力設計](photo-diary-input-design.md)を正とします。

2. **テキストおよびメディアのベクトル化と検索**
   - activeなBrain Itemは、AccountDataの同期outboxと専用Queueを経由してVertex AI Express ModeのGeminiでEmbeddingへ変換されます。
   - 生成されたベクトルはCloudflare Vectorizeへ保存します。Vectorizeは候補抽出だけを担い、利用時はAccountDataで現在の状態とAccess Policyを再認可します。

3. **MCPアクセス制限と監査（Phase 2）**
   - MCPリクエスト受領時、Cloudflare Workers は D1 および KV に保持された `Access Profile` と `Access Label` を照合し、認可範囲内の情報のみを返却します。
   - すべての閲覧・検索リクエストは D1 または KV に監査ログとして非同期書き込みされます。

4. **非同期 Webhook メッセージ処理**
   - Webhook リクエスト（LINE 等）は API サーバーで受信後、直ちに `Cloudflare Queues` へ投入され 200/202 応答を返却します。
   - バックグラウンドの Queue Worker (`apps/worker`) がキューから非同期バッチメッセージを取り出し順次処理します。LINE日記メッセージの最終応答、応答期限、再試行は[日記チャット実装設計](diary-chat-implementation-design.md#9-38秒sloと配送)を正とします。

5. **外部LLMの呼び出し**
   - Vertex AI Express Mode の Gemini を利用する処理は、Queue Worker からGoogleへ直接呼び出します。
   - `@google/genai`は`vertexai: true`とAPI version `v1`で初期化し、プロジェクトやロケーションの指定を要しないExpress ModeのAPI key認証を使います。
   - Vertex AI authorization key (`GOOGLE_VERTEX_AI_API_KEY`) は Worker の Secret として保持し、Web UI、APIレスポンス、ログへ露出させません。専用service accountへ推論に必要な`aiplatform.endpoints.predict`だけを付与し、API keyのtarget methodも`GenerateContent`と`EmbedContent`へ限定します。
   - 接続確認では、LINEへ `AI: 質問` と明示して送った本文だけをモデルへ渡し、生成結果を同じトークへ返信します。通常の日記と診断要求はモデルへ送りません。
   - モデルへ渡した本文と生成結果はアプリケーションログおよびデータベースへ保存しません。
   - 接続確認の失敗時は、設定不足、空応答、API例外を区別できる構造化ログを出力します。モデルへ渡した本文、生成結果、Google API key はエラーログにも含めません。

## 6. 開発・運用環境方針

開発基盤には **Bun Workspaces** を用いたモノレポ構造（`apps/web`, `apps/api`, `apps/mcp`, `apps/worker`）を採用し、ローカル開発・プレビュー・本番環境で一貫した開発体験と安全なデプロイを実現します。`apps/mcp`はPhase 2向けのスケルトンとしてデプロイを継続しますが、初期リリースのユーザー向け機能には含めません。

- **モノレポ構成 (`Bun Workspaces`)**:

  ```text
  me-builder/
  ├── infra/              # Cloudflare基盤とGCP共通基盤の独立したPulumi project
  ├── Taskfile.yml       # タスクランナー定義 (task dev, task i, task deploy:preview 等)
  ├── package.json       # ルート設定 (workspaces 定義, wrangler devDependency)
  ├── tsconfig.json      # モノレポ共通 TypeScript 設定
  ├── apps/
  │   ├── web/           # Frontend UI (React + Vite + TypeScript, wrangler.toml)
  │   ├── api/           # API Server (Bun.serve / Cloudflare Workers, wrangler.toml)
  │   ├── mcp/           # MCP Server (Bun.serve / Cloudflare Workers, wrangler.toml)
  │   └── worker/        # Queue Worker (Cloudflare Workers, wrangler.toml)
  └── packages/
      ├── shared/        # 共有型定義 & ユーティリティ (純粋な .ts ソース直参照)
      └── lib/           # LINE連携、共有D1とAccountDataのschema・action (Drizzle ORM)
  ```

  - `apps/web`: React (Vite + TypeScript) によるフロントエンド。`apps/web/wrangler.toml` により Pages 設定および環境別設定（local, preview, production）を管理。
  - `apps/api`: `Bun.serve` および Web標準 API 準拠の **Hono** フレームワークを採用。`apps/api/wrangler.toml` により Cloudflare Workers の環境別設定（local, preview, production）を制御。
  - `apps/mcp`: Phase 2でCloudflare Workers / Bun 上に提供する MCP (Model Context Protocol) サーバーのスケルトン。`apps/mcp/wrangler.toml`によりWorkersの環境別設定を制御し、既存のデプロイ経路を維持する。
  - `apps/worker`: Cloudflare Queues メッセージを非同期処理する Cloudflare Workers ワーカー。`apps/worker/wrangler.toml` により Worker の環境別設定を制御。
  - `packages/shared`: 全アプリケーション間で共有されるドメイン型定義およびユーティリティライブラリ。
  - `packages/lib`: LINE Messaging API 連携、共有D1（`d1/shared/`）とAccountData Durable Object（`do/account/`）のschema・action（Drizzle ORM）を所有者ごとに分けて提供するライブラリ。`D1.shared.*`と`DO.account.*`で参照する。境界は[Accountデータ分離設計](account-data-isolation.md)を正とします。

### 6.1 Cloudflareリソースの宣言とデプロイ境界

Cloudflareの基盤リソースは`infra/`のPulumi programをSSoTとします。Pulumiは環境ごとのD1 database、Private R2 bucket、QueueおよびDLQを作成・変更・削除し、stack outputからリポジトリ内の`wrangler.toml`を生成します。リソースIDやbucket名を手作業でTOMLへ複製しません。

Worker scriptのbundle、Secretの配布、Durable Object migrationとQueue consumerの登録はWranglerが担当します。Durable Object namespaceとmigration履歴はWorker scriptが所有し、独立したPulumiリソースとして作成・削除できないためです。`infra`のライフサイクルコマンドは、この所有関係に従って実行順を制御します。

```mermaid
flowchart LR
    Program["infra/ Pulumi program"] --> Up["pulumi up"]
    Up --> Base["D1 / Private R2 / Queues / DLQs"]
    Base --> Output["stack output"]
    Output --> Generate["wrangler.toml生成"]
    Generate --> Deploy["Wrangler deploy"]
    Deploy --> Worker["Workers / DO migrations / Queue consumers"]

    Destroy["環境削除"] --> Stop["API・MCP Workerとconsumerを先に削除"]
    Stop --> Unbind["削除用WorkerでQueue bindingを解除"]
    Unbind --> QueueWorker["Queue Worker / DOを削除"]
    QueueWorker --> PulumiDestroy["pulumi destroy"]
    PulumiDestroy --> Removed["D1 / Private R2 / Queues / DLQsを削除"]
```

Previewの破壊的な検証はPreview専用stackでのみ行います。削除時はAPI・MCP WorkerとQueue consumerを先に削除し、Private R2を空にしてから、削除専用の最小Workerを一度デプロイしてproducer bindingも解除します。その後、Queue Workerの削除で所有するDOとmigration履歴を破棄し、`pulumi destroy`でD1・Private R2・Queue・DLQを削除します。再構築時は`pulumi up`、TOML生成、D1 migration、Workerデプロイの順とします。Productionを破壊対象とするコマンドは提供しません。

GitHub Actionsの手動resetは常に最新`main`を対象にこのライフサイクルを実行し、復旧確認後に新しいD1・Private R2・Queueの情報をmanifestとWrangler TOMLへ反映するPRを自動作成します。通常のPreview CDはデプロイ前にPrivate R2がなければ同じ命名規則で作成し、Cloudflare上の現在リソースを検証・同期するため、自動PRがマージされる前でも古いD1 IDを参照しません。Production CDもPrivate R2の存在をデプロイ前に保証します。

- **環境分類と Pulumi / Wrangler 構成 (`Local` / `Preview` / `Production`)**:
  - **ローカル開発環境 (`Local`)**:
    - `wrangler.toml` 内の `env.local` ターゲット（`me-builder-api-local`, `me-builder-mcp-local`, `me-builder-web-local`）。
    - ルートの `bun dev` または `wrangler dev --env local` によりローカルエミュレーション実行。
  - **プレビュー環境 (`Preview`)**:
    - `wrangler.toml` 内の`env.preview`ターゲット（`me-builder-api-preview`, `me-builder-mcp-preview`, `me-builder-web`）。
    - 全 PR で共有する単一の検証環境。プルリクエストの作成・更新だけでは自動デプロイせず、`CD / Preview` ワークフローが次のいずれかで起動したときのみ `wrangler deploy --env preview` / `wrangler pages deploy` を実行。
      - ブランチを指定した手動実行 (`workflow_dispatch`)
      - `deploy` ラベルが付いた PR（ラベル付与時と、その後の push）
    - **カスタムドメイン・ルーティング配置**:
      - UI (`apps/web`): `stg.kagami.kyosuke.dev`
      - API (`apps/api`): `api.stg.kagami.kyosuke.dev`
      - MCP (`apps/mcp`): `mcp.stg.kagami.kyosuke.dev`
  - **本番環境 (`Production`)**:
    - `wrangler.toml` 内の`env.production`ターゲット（`me-builder-api-production`, `me-builder-mcp-production`, `me-builder-web`）。
    - `main`の対象commitを指定し、CI成功後にサービス運用者が確認文字列を入力した手動workflowだけが`wrangler deploy --env production`を実行する。
    - **カスタムドメイン・ルーティング配置**:
      - UI (`apps/web`): `kagami.kyosuke.dev`
      - API (`apps/api`): `api.kagami.kyosuke.dev`
      - MCP (`apps/mcp`): `mcp.kagami.kyosuke.dev`

APIとMCPがブラウザへ返すCORSヘッダは、環境manifestのベースドメインから生成したWeb UIのオリジンだけを許可します。LocalはVite開発サーバーのオリジンを使用し、設定が欠けている場合や一致しないOriginには`Access-Control-Allow-Origin`を返しません。

### 6.2 GCP共通リソースの宣言境界

`infra/gcp-platform/`はCloudflare基盤と別のPulumi projectとし、`development`と`production`のStackを持ちます。各Stackは環境別GCP project、Cloud Billing接続、Identity Platform設定、Google provider、Identity Toolkit APIだけへ制限したAPI keyを所有します。同じStackでVertex AI API、推論だけを許す専用service account、`GenerateContent`と`EmbedContent`だけへ制限したservice-account-bound authorization keyを所有します。Productionだけでなく認証データを持つDevelopment projectも削除保護します。authorization keyのorganization policyはproject単位でPulumi管理し、runtime credentialを無効にした状態では作成を明示的に禁止します。有効化後も制約自体は維持し、`allowedServices`で`aiplatform.googleapis.com`だけを許可します。organization配下にないprojectではauthorization keyを作りません。

API keyは`primary`と`secondary`のrotation slotを持ち、平常時はactive slotだけを作成します。Stack configに非active slotのgenerationを追加して移行期間だけ2 keyを併存させ、配布先の切り替え後に旧slotを`null`へ戻して削除します。key自体へ削除保護を付けず、project、Identity Platform、IAM、予算などの永続的な基盤だけを削除保護します。これにより、固定名の長期credentialを壊さずに置換できない状態と、不要な予備credentialの常設をともに避けます。

各Stackはproject全体の月額Cloud Billing予算をPulumiで管理し、gross costの50%、80%、100%で警告します。通常の予算通知は利用を停止しないため、Vertex AIの実費上限にはGoogle Cloud Billingのservice別Spend capを併用します。Spend capは現行の公開Cloud Billing Budget APIとPulumi GCP providerから設定できないため、最初の基盤適用後にCloud Consoleで手動設定し、確認済みconfigがない限りPulumiはVertex AI authorization keyを作りません。DevelopmentとProductionは別の上限額を持ち、上限到達時にAI機能が停止することを可用性上の正常な縮退として扱います。

Google Auth PlatformはOAuth同意画面と一般ユーザー向けWeb OAuth clientを所有します。Development clientにはLocalとPreviewの完全一致callback、Production clientにはProduction callbackだけを登録します。Web OAuth clientの作成はPulumi管理対象外とし、そのClient IDとSecretを環境別Pulumi configへ入力してIdentity PlatformのGoogle providerへ接続します。IAP用またはworkload用OAuth clientで代用しません。

Pulumi Stack outputのactiveなIdentity Platform API keyとVertex AI authorization keyはsecretとして扱い、対応するGitHub Environmentから必要なCloudflare Workerだけへ配布します。OAuth Client SecretもPulumi configとGitHub Environmentの両方でsecretにし、Stack output、CIログ、artifactへ出力しません。CloudflareとGCPのPulumi projectはbootstrap済みのstate用GCP projectにある`gs://kagami-infra/`を使い、`kagami/cloudflare/`と`kagami/gcp-platform/`のManaged Folder、暗号化passphrase、IAM accessを分離します。Pulumi Cloudやlocal file backendへ状態を分岐させません。backendの認証・暗号化・初回adoptionは[`infra/README.md`](../../infra/README.md#one-time-state-backend-bootstrap)、GCP共通projectの適用手順は[`infra/gcp-platform/README.md`](../../infra/gcp-platform/README.md)を正とします。

### 6.3 APIドキュメントのCloudflare Access境界

PreviewとProductionでは、APIドキュメントを利用者向けAPIとは別のCloudflare Access Applicationで保護します。ApplicationはAPIホスト全体ではなく、次のパスだけを対象にします。

| パス | Access | 用途 |
| --- | --- | --- |
| `/api/openapi.json` | 必須 | 機械可読なOpenAPI document |
| `/api/docs`、`/api/docs/*` | 必須 | Swagger UIを提供する場合の画面と配下のアセット |
| `/api/health` | 不要 | 外形監視と死活確認 |
| `/api/ready` | 不要 | 共有D1への接続を含む受付可能性の確認 |

```mermaid
flowchart LR
    Client[Request] --> Edge[Cloudflare Edge]
    Edge -->|/api/openapi.json<br/>/api/docs/*| Access[Cloudflare Access]
    Access -->|許可された開発者| API[API Worker]
    Access -->|未認証・対象外| Deny[拒否]
    Edge -->|/api/health<br/>/api/ready| API
```

`/api/health`はWorkerが応答できることだけを示すliveness、`/api/ready`は共有D1へ問い合わせできることまでを示すreadinessです。readinessが失敗した場合も、外部レスポンスには依存先名や例外詳細を含めず、`503`と固定状態だけを返します。

AccessのAllow policyは、IdPが検証した個別メールアドレスまたは開発者グループを対象にし、`Everyone`を指定しません。対象外の主体はAccessのdeny-by-defaultで拒否します。PreviewとProductionはホスト名が異なるため環境ごとにApplicationを持ちますが、同じアクセス境界を適用します。

診断・プロフィール等の利用者向けAPIとLINE WebhookはこのApplicationへ含めません。それぞれが所有するLIFF IDトークン認証またはLINE署名検証を継続します。LocalではCloudflare Accessを経由せず、生成・検証作業から直接OpenAPI documentへアクセスできます。

Access ApplicationとAllow policyが作成され、許可された開発者と未認証リクエストの両方を確認できるまでは、Swagger UIをPreviewまたはProductionへ公開しません。

Applicationとpolicyは`scripts/setup-api-docs-access.ts`で冪等に作成・更新し、CDでAPI Serverのデプロイ前に適用します。デプロイ後は`scripts/verify-api-docs-access.ts`が未認証requestでOpenAPI documentとSwagger UI用パスを取得できないことを確認し、公開されている場合はCDを失敗させます。許可対象やAPI token権限などの実行設定は[開発運用ルール](../../.agents/rules/development.md#apiドキュメントのcloudflare-access設定)を正とします。

### 6.3 Production運用境界

個人開発のため、営業時間、on-call、数値SLO、RTO、RPO、データ損失ゼロは約束せず、復旧と問い合わせ対応はベストエフォートとします。利用者向けアプリ内に運用アラート画面は設けません。

監視Workerは次を検知し、同じ事象について発生時と回復時に各1回だけCloudflare Dashboardと運用メールへ通知します。

- `/api/ready`の失敗が5分継続
- 終端Queue messageが1件以上、またはDLQ最古messageが10分超
- 本人データ保存の失敗が1件以上
- safety経路の失敗が1件以上
- system起因の認証失敗が5分続き、成功がない

ログはCloudflare標準保持だけを利用し、外部ログ基盤やR2へ複製しません。safety監査はroute種別、成功可否、固定error code、時刻の集計だけとし、Account、入力本文、AI出力を含めません。

公開status pageはサービス、Web、LINE、AIの現在状態と過去30日を表示します。監視から自動反映し、手動workflowによるoverrideも許可します。RSS、購読、メール配信機能は提供しません。

通常のProduction deployはCI後の手動実行です。破壊的操作は直前backupと再確認を必須とし、標準Cloudflare機能による復旧を優先します。緊急時はサービス運用者が停止、maintenance表示、rollbackを実行できます。インフラ操作についてアプリ内監査記録は追加しません。

## 7. 関連ドキュメント

LIFFとGoogleログインを同じAccountおよびアプリケーションセッションへ収束させる境界は、[Web認証・アプリケーションセッション設計](web-authentication-design.md)を正とします。

- [Agent向けガイド](../../.agents/README.md)
- [開発運用ルール](../../.agents/rules/development.md)
- [プロジェクト概要](../product/project-overview.md)
- [ドメイン設計](../domain/domain-design.md)
- [Brain内部情報の分類](../domain/brain/brain-content-taxonomy.md)
- [Brainのラベル・アクセス制御設計](../domain/brain/brain-access-label-design.md)
- [日記チャット実装設計](diary-chat-implementation-design.md)
