# MCP運用検証runbook

## 1. 目的

この文書は、実装済みの管理者限定MCPを環境ごとに有効化し、互換性、安全性、停止と復旧を確認する手順を管理します。認可、開示、監査と解除の仕様は[MCP連携設計](../architecture/mcp-integration-design.md)をSSoTとします。

### 所有する概念

- 環境別feature flagを有効にする前後の検証
- 実clientとの互換性確認と残す証跡
- 問題発生時の停止・再開手順

### 所有しない概念

- MCPのtransport、認証・認可、同意、開示、監査、解除の決定
- `Access Label`、`Access Profile`と外部提供の共通原則
- 一般利用者向けMCP、課金、原本取得、tool追加

## 2. 実装済みの境界

MCP `2026-07-28`対応の公式TypeScript SDKを固定し、ステートレスな`POST /mcp`、CIMD、Authorization Code + PKCE S256、access／refresh token、`search_my_brain`を実装しています。認可画面、接続・監査履歴・解除は管理者向けWebだけにあります。

検索はVector metadataでOwner Profileを事前filterし、AccountDataで現在の所有者、status、Access Label、機微度、外部提供可否を再確認します。Source Record、Evidence原文、相談本文と添付原本は返しません。成功応答は監査保存後だけ返し、監査は90日を目安にbest effortで定期削除します。

feature flagの既定値は全環境で無効です。無効時の`POST /mcp`と常時非対応の旧`/sse`、`/messages`は`501 MCP_NOT_AVAILABLE`と`Cache-Control: no-store`を返します。実装をmergeしただけでは外部へ公開されません。

## 3. 自動検証

CIでは次を継続して固定します。

- runtime routeとOpenAPIの認証・管理者・CSRF契約
- 公開HTTPSだけを取得するCIMD、redirect・応答容量・metadata内容の検証
- authorization codeの一回利用、client・redirect・resource・PKCEのbinding
- access tokenのresource、現在の管理者Account、接続状態と有効期限の検証
- refresh token rotation、再利用時のtoken family失効、解除直後の失効
- feature flag無効、未認証、外部Origin、旧endpointの拒否
- 検索前filterとAccountData再認可、非公開ItemとEvidence原文の除外
- 成功・拒否・失敗の監査と、監査保存失敗時のfail close
- D1 migration、Wrangler binding、Vector metadata indexの生成物drift

## 4. Preview有効化

1. D1 migrationを適用し、Vectorizeの`owner_scope`と`mcp_owner_scope`がstring indexとして見えることを確認する
2. APIとMCPへ同じ`MCP_TOKEN_HMAC_SECRET`を設定し、GeminiとBrain Vectorの既存secretを確認する
3. Previewだけの`MCP_FEATURE_ENABLED`を`true`にしてAPIとMCPをdeployする
4. 管理者Accountと実際に使用するCIMD対応clientで認可する
5. 外部提供を許可したItemだけが返り、接続画面と取得履歴に同じclient・件数・Item IDが表示されることを確認する
6. token更新、解除、再接続を確認し、解除後の旧access／refresh tokenが拒否されることを確認する
7. flagを`false`へ戻すと`POST /mcp`だけが501へ戻り、APIとWebの他機能が継続することを確認する

証跡には成否、時刻、環境、client製品名と固定理由コードだけを残します。token、認可code、Account ID、検索query、Brain本文、日記・相談本文、添付、個人情報をworkflow出力、Issue、PRへ記録しません。

## 5. Production有効化

Previewの全手順が成功したcommitだけをProductionへ進めます。Productionでもfeature flagを明示的に`true`へ変更するまで停止状態を維持します。有効化後は管理者Accountだけで認可・検索でき、非管理者、利用規約未同意、停止Account、別resource token、旧endpointが拒否されることを再確認します。

次の場合はfeature flagを`false`へ戻し、原因を修正してPreviewから再検証します。

- 認可していないItem、原文、他Account情報を返す
- 監査保存前に検索結果を返す
- 解除後またはrole変更後のtokenを受理する
- tokenや個人コンテンツを運用ログへ出す
- SDKまたは対応仕様の更新で互換性が変わる

## 6. 継続条件

- MCP仕様とSDKを自動追従しない
- 一般利用者への公開、課金、原本取得、tool追加は別Issueで設計する
- 実環境のsecret、client、外部serviceに依存する確認は、このrunbookを使うrelease gateとして継続する
- 機能Issueの完了とProduction公開を同一視せず、feature flagで独立して管理する
