# Agent向けガイド

## 作業前に読むもの

すべての作業で次のルールを確認します。

- [ドキュメント運用ルール](rules/documentation.md)
- [設計スコープのルール](rules/design-scope.md)
- [開発運用ルール](rules/development.md)

## ドキュメントマップ

| 文書 | 所有する内容 |
| --- | --- |
| [README](../README.md) | プロジェクトの短い入口と文書リンク |
| [ドキュメントガイド](../docs/README.md) | `docs/` のディレクトリ構造、文書の探し方、全ドキュメントへの入口 |
| [プロジェクト概要](../docs/product/project-overview.md) | 目的、主要要件、MVP、ロードマップ、Phase 1の入力体験とログイン手段 |
| [自分の傾向サマリー体験設計](../docs/product/profile-summary-experience.md) | 複数の診断回答を横断して本人の現在の傾向を表示する画面、要約規則、導線、状態、完了条件 |
| [ストレスの手がかりとAIセルフケア相談体験設計](../docs/product/self-care-ai-consultation-experience.md) | 本人向けの負荷の手がかり、早期サイン、対処、相談先の表示とAI相談、安全上の切り替え |
| [日記チャット体験設計](../docs/product/diary-chat-experience.md) | 日々の声かけから出来事と行動原理を探り、記憶を使って助言する対話体験と応答時間 |
| [日記チャット実装設計](../docs/architecture/diary-chat-implementation-design.md) | 日記チャットのD1モデル、Cloudflare実行基盤、プロンプト、ガードレール、応答期限 |
| [管理者向け統計ダッシュボード設計](../docs/architecture/admin-statistics-dashboard.md) | 管理者認可、Gemini・LINE統計の項目、取得元、障害時の表示 |
| [Phase 1 診断体験設計](../docs/diagnosis/diagnosis-experience.md) | 診断一覧、回答、回答内容、LINE通知、リッチメニューのUIと遷移、縦切りの完了条件 |
| [Phase 1 診断ドメイン設計](../docs/diagnosis/diagnosis-domain-design.md) | Question、Diagnosis、DiagnosisResponseの集約、状態、不変条件、Account / Sourceとの関係 |
| [人間関係の価値観診断候補](../docs/diagnosis/content/relationship-values-diagnosis.md) | 人間関係で違いが問題になりやすい価値観の分類、質問作成時の原則 |
| [人間関係の価値観 Yes／No質問集](../docs/diagnosis/content/relationship-values-yes-no-question-bank.md) | 人間関係の各話題についてYes／Noで回答できる質問候補 |
| [診断回答のパラメータ変換設計](../docs/diagnosis/scoring/parameter-scoring-design.md) | 診断固有の設定形式、共通の計算手順、版管理、追加手順 |
| [「自分と相手の優先・境界線」パラメータ変換設計](../docs/diagnosis/scoring/relationship-priority-parameter-design.md) | 最初の診断固有の4パラメータ、質問ごとの重み、表示設定 |
| [「お金と消費」パラメータ変換設計](../docs/diagnosis/scoring/money-values-parameter-design.md) | 2つ目の診断固有の5パラメータ、質問ごとの重み、表示設定 |
| [「インドア・アウトドアと余暇」パラメータ変換設計](../docs/diagnosis/scoring/leisure-style-parameter-design.md) | 3つ目の診断固有の4パラメータ、質問ごとの重み、表示設定 |
| [「時間と予定」パラメータ変換設計](../docs/diagnosis/scoring/time-planning-parameter-design.md) | 4つ目の診断固有の4パラメータ、質問ごとの重み、表示設定 |
| [ドメイン設計](../docs/domain/domain-design.md) | Account / Brain / Sourceの責務・境界、Diagnosisの位置づけ、ドメイン間の関係、設計順序と進捗 |
| [Brain内部情報の分類](../docs/domain/brain/brain-content-taxonomy.md) | Brain Itemの分類名、定義、具体例、分類とは別に持つ共通属性、意思決定での利用方法 |
| [根拠・反証・改訂のエッジ設計](../docs/domain/brain/evidence-edge-design.md) | Source RecordとBrain Itemを結ぶエッジの種類と属性、Confidenceとの関係、外部への開示粒度、改訂された旧版の扱い |
| [Source Recordのライフサイクル設計](../docs/domain/source/source-record-lifecycle-design.md) | Source Recordの不変性、訂正・削除・取り消し・撤回、Brain Itemへの波及、エクスポート範囲 |
| [Brainのラベル・アクセス制御設計](../docs/domain/brain/brain-access-label-design.md) | Topic Label、Access Label、Access Profile、MCP提供時の原則、Source Recordの既定ラベル |
| [インフラ・システム構成](../docs/architecture/infrastructure-architecture.md) | Cloudflareを全面的に採用したインフラ基盤、システム構成、サービス配置 |
| [日記チャット実装設計](../docs/architecture/diary-chat-implementation-design.md) | 日記チャットのD1モデル、実行基盤、プロンプト、ガードレール、応答期限 |
| [キャラクターデザイン](../docs/design/character-design.md) | うつし・ミラの名前、役割、外見設定、デザインアセットの置き場所と命名規則 |
| [診断seed運用](../docs/development/diagnosis-seed.md) | Question、Question Version、Choice、DiagnosisをD1へ登録するseedの配置、実行、更新、検証方法 |
| [診断サムネイル生成](../docs/development/diagnosis-thumbnail-generation.md) | 診断一覧用サムネイルの生成プロンプト、共通スタイル、配置手順 |
| [LINEリッチメニュー運用](../docs/development/line-rich-menu.md) | Messaging APIによるリッチメニューの登録、画像更新、CD運用 |
| [診断API契約](../docs/development/diagnosis-api.md) | Web UIとAPI Server間の診断APIのパス、認証、入出力、エラー契約 |
| [API契約とクライアント型の生成](../docs/development/api-contract-generation.md) | API ServerのHTTP契約の配置、OpenAPI documentとWeb UI用TypeScript型の生成運用 |
| [PR作成手順書](../docs/development/pull-request-guidelines.md) | PRタイトルの命名規則、概要の書き方、作成前の準備・検証手順 |

この表は各文書へのナビゲーションです。概念の定義そのものはリンク先だけに記載します。

## 作業フロー

1. 変更する概念のSSoTをドキュメントマップから特定する
2. SSoTを先に更新する
3. 他文書では重複記述を増やさず、必要ならリンクまたは短い要約だけを更新する
4. [ドキュメント運用ルール](rules/documentation.md)のチェックリストで確認する
5. 変更内容と、どのSSoTを更新したかを報告する

新しい概念の所有先が不明な場合、既存文書へ分散して追記してはいけません。先に所有先を決め、[ドキュメントマップ](#ドキュメントマップ)へ追加します。
