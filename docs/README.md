# ドキュメントガイド

## 目的

この文書は、`docs/` 配下の構造と文書の探し方を案内します。各概念の定義はリンク先の文書を正とし、ここでは再掲しません。

### 所有する概念

- `docs/` のディレクトリ構造
- 文書を探すためのナビゲーション
- 新しい文書を配置する基準

### 所有しない概念

- プロダクトやドメインの定義
- 各文書の詳細な責務とSSoT
- ドキュメントの更新ルール

これらは、それぞれリンク先の設計文書、[Agent向けガイドのドキュメントマップ](../.agents/README.md#ドキュメントマップ)、[ドキュメント運用ルール](../.agents/rules/documentation.md)を正とします。

## ディレクトリ構造

```text
docs/
├── README.md                     # このガイド
├── product/                      # プロダクトの目的・要件・ロードマップ
├── diagnosis/               # 診断の体験、モデル、設問、採点
│   ├── content/                  # 診断のテーマと質問候補
│   └── scoring/                  # 回答からパラメータへの変換
├── domain/                       # Account / Brain / Sourceのドメイン設計
│   ├── brain/                    # Brain Item、根拠、アクセス制御
│   └── source/                   # Source Record
├── architecture/                 # インフラとシステム構成
├── design/                       # キャラクターなどのデザイン仕様
├── assets/                       # 文書から参照する画像
│   └── characters/               # キャラクター画像
└── development/                  # 開発・コントリビューション手順
```

ディレクトリは、実装コンポーネントではなく「何について知りたいか」で分けます。新しい文書を追加するときは、その文書が所有する概念に最も近いディレクトリへ配置します。

## 文書を探す

### プロダクト全体を知る

- [プロジェクト概要](product/project-overview.md) — 目的、主要要件、MVP、ロードマップ、Phase 1の入力体験とログイン手段
- [全体画面遷移設計](product/screen-navigation.md) — LINEとWebをまたぐ入口と、利用者・管理者向け画面の全体遷移
- [わたしのまとめ仕様](product/profile-summary-experience.md) — 診断と日記からAI生成した版付きの「わたしのまとめ」と診断テーマの表示規則
- [相性診断・うつし共有体験設計](product/compatibility-experience.md) — 招待リンクとLINE共有、双方の同意、相性一覧、「それぞれについて」と「2人について」、共有終了
- [サービス利用規約・同意体験設計](product/service-terms-consent-experience.md) — 規約の版管理、Accountごとの同意履歴、初回・改定時の同意ゲート
- [成長・報酬体験の提案](product/progression-reward-experience.md) — Brainの成長イベントによる上限のないレベル、集めたかけらと有効なかけら、ペア単位の共有レベル
- [プロフィール設定体験設計](product/profile-settings-experience.md) — 右上の入口、アバター設定への接続、ライト・ダークテーマの選択と保存
- [アバター設定体験設計](product/avatar-experience.md) — LINEプロフィール画像の初期表示、端末画像の選択・プレビュー・設定、差し替え・削除
- [ストレスの手がかりとAIセルフケア相談体験設計](product/self-care-ai-consultation-experience.md) — 自分用のセルフケア情報、AI相談、安全上の切り替え
- [日記チャット体験設計](product/diary-chat-experience.md) — 日々の声かけの配信判断・個別化情報・段階導入、出来事と行動原理を探り、記憶を使って助言する対話体験と応答時間

### 診断を設計する

- [Phase 1 診断体験設計](diagnosis/diagnosis-experience.md) — 診断一覧、回答、回答内容、LINE通知、リッチメニューのUIと遷移
- [Phase 1 診断ドメイン設計](diagnosis/diagnosis-domain-design.md) — Question、Diagnosis、DiagnosisResponseの集約、状態、不変条件、Account / Sourceとの関係
- [人間関係の価値観診断候補](diagnosis/content/relationship-values-diagnosis.md) — 価値観の分類と質問作成時の原則
- [人間関係の価値観 Yes／No質問集](diagnosis/content/relationship-values-yes-no-question-bank.md) — Yes／Noで回答できる質問候補
- [診断回答のパラメータ変換設計](diagnosis/scoring/parameter-scoring-design.md) — 共通の設定形式、計算手順、版管理、追加手順
- [「自分と相手の優先・境界線」パラメータ変換設計](diagnosis/scoring/relationship-priority-parameter-design.md) — 最初の診断固有のパラメータ、重み、表示設定
- [「お金と消費」パラメータ変換設計](diagnosis/scoring/money-values-parameter-design.md) — 2つ目の診断固有のパラメータ、重み、表示設定
- [「インドア・アウトドアと余暇」パラメータ変換設計](diagnosis/scoring/leisure-style-parameter-design.md) — 3つ目の診断固有のパラメータ、重み、表示設定
- [「時間と予定」パラメータ変換設計](diagnosis/scoring/time-planning-parameter-design.md) — 4つ目の診断固有のパラメータ、重み、表示設定
- [「会話と感情表現」パラメータ変換設計](diagnosis/scoring/conversation-emotion-parameter-design.md) — 5つ目の診断固有のパラメータ、重み、表示設定
- [「優先順位と人生の方向性」パラメータ変換設計](diagnosis/scoring/life-priorities-parameter-design.md) — 6つ目の診断固有のパラメータ、重み、表示設定、Relationship Category
- [「仕事の価値観・働き方」パラメータ変換設計](diagnosis/scoring/work-values-parameter-design.md) — 7つ目の診断固有のパラメータ、重み、表示設定、Relationship Category
- [「仕事の変化・周囲との関わり方」パラメータ変換設計](diagnosis/scoring/work-relationship-style-parameter-design.md) — 8つ目の診断固有のパラメータ、重み、表示設定、Relationship Category
- [「家族との距離感・支え合い」パラメータ変換設計](diagnosis/scoring/family-support-style-parameter-design.md) — 9つ目の診断固有のパラメータ、重み、表示設定、Relationship Category
- [「友達との距離感・付き合い方」パラメータ変換設計](diagnosis/scoring/friendship-style-parameter-design.md) — 10個目の診断固有のパラメータ、重み、表示設定、Relationship Category
- [「決め方・迷いとの向き合い方」パラメータ変換設計](diagnosis/scoring/decision-making-style-parameter-design.md) — 11個目の診断固有のパラメータ、重み、表示設定、Relationship Category
- [「仕事の進め方・優先順位」パラメータ変換設計](diagnosis/scoring/work-priority-style-parameter-design.md) — 12個目の診断固有のパラメータ、重み、表示設定、Relationship Category

### ドメインを設計する

- [ドメイン設計](domain/domain-design.md) — Account / Brain / Sourceの責務・境界、Diagnosisの位置づけ、設計順序と進捗
- [Brain内部情報の分類](domain/brain/brain-content-taxonomy.md) — Brain Itemの分類、共通属性、意思決定での利用方法
- [Brain Item生成設計](domain/brain/brain-item-generation-design.md) — Source RecordからBrain Itemを生成する共通入出力、診断と日記の差分、登録タイミング
- [Brainのラベル・アクセス制御設計](domain/brain/brain-access-label-design.md) — Topic Label、Access Label、Access Profile、MCP提供時の原則
- [根拠・反証・改訂のエッジ設計](domain/brain/evidence-edge-design.md) — Source RecordとBrain Itemを結ぶエッジ
- [Source Recordのライフサイクル設計](domain/source/source-record-lifecycle-design.md) — 不変性、訂正、削除、取り消し、撤回、エクスポート

### システム・デザイン・開発運用を確認する

- [インフラ・システム構成](architecture/infrastructure-architecture.md) — Cloudflareを利用するシステム構成とサービス配置
- [Accountデータ分離設計](architecture/account-data-isolation.md) — 1 Account = 1 AccountData DO、保存先の判定規則、内部module、共有D1が保存するもの
- [相性共有データ実装設計](architecture/compatibility-data-design.md) — 1関係 = 1 CompatibilityData DO、Account別一覧参照、相手単位の継続同意、状態遷移
- [日記チャット実装設計](architecture/diary-chat-implementation-design.md) — 日記チャットのAccountDataモデル、声かけコンテキストの保存、実行基盤、プロンプト、ガードレール、応答期限
- [管理者向けダッシュボード設計](architecture/admin-statistics-dashboard.md) — 管理者認可、Account一覧、うつしレベル・かけら数、Gemini・LINEの利用統計
- [キャラクターデザイン](design/character-design.md) — うつし・ミラの設定とデザインアセット
- [診断seed運用](development/diagnosis-seed.md) — 診断をD1へ登録するseedの配置、実行、更新、検証方法
- [診断サムネイル生成](development/diagnosis-thumbnail-generation.md) — 診断一覧用サムネイルの生成プロンプトと配置手順
- [LINEリッチメニュー運用](development/line-rich-menu.md) — Messaging APIによるリッチメニューの登録、画像更新、CD運用
- [診断API契約](development/diagnosis-api.md) — Web UIとAPI Server間の診断API契約
- [プロフィールAPI契約](development/profile-api.md) — 本人プロフィールとアバター画像の取得・保存・削除API契約
- [相性API契約](development/compatibility-api.md) — Web UIとAPI Server間の相性API契約
- [API契約とクライアント型の生成](development/api-contract-generation.md) — HTTP契約の配置とOpenAPI・Web UI用型の生成運用
- [アプリケーション運用ログ方針](development/operational-logging.md) — 一連の処理を追跡し、エラー原因と最終結果を判断できる運用ログの目的と進め方
- [本番データベースマイグレーション運用](development/production-migration-operations.md) — forward-only、expand-contract、適用順序、D1とDurable Objectの復旧方針
- [Brain Item残タスク](development/brain-item-remaining-tasks.md) — Brain Item生成・意味的重複判定・Vectorize利用に残っている検証、品質改善、延期中の機能
- [アバター設定残タスク](development/avatar-remaining-tasks.md) — アバター設定に残っている実ブラウザE2E、LIFF実端末確認、Private R2の運用改善
- [わたしのまとめ残タスク](development/profile-summary-remaining-tasks.md) — 「わたしのまとめ」で未完了の実環境検証と完了条件
- [日記入力残タスク](development/diary-remaining-tasks.md) — 日記入力で未実装の送信取り消し（unsend）と写真添付
- [PR作成手順書](development/pull-request-guidelines.md) — PRタイトル、概要、作成前の準備と検証手順

## ドキュメントを更新する

文書の責務とSSoTは[Agent向けガイドのドキュメントマップ](../.agents/README.md#ドキュメントマップ)で確認します。追加・移動・更新時は[ドキュメント運用ルール](../.agents/rules/documentation.md)に従います。
