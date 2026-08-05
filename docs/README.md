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

### 診断を設計する

- [Phase 1 診断体験設計](diagnosis/diagnosis-experience.md) — 診断一覧、回答、回答内容、LINE通知、リッチメニューのUIと遷移
- [Phase 1 診断ドメイン設計](diagnosis/diagnosis-domain-design.md) — Question、Diagnosis、DiagnosisResponseの集約、状態、不変条件、Account / Sourceとの関係
- [人間関係の価値観診断候補](diagnosis/content/relationship-values-diagnosis.md) — 価値観の分類と質問作成時の原則
- [人間関係の価値観 Yes／No質問集](diagnosis/content/relationship-values-yes-no-question-bank.md) — Yes／Noで回答できる質問候補
- [診断回答のパラメータ変換設計](diagnosis/scoring/parameter-scoring-design.md) — 共通の設定形式、計算手順、版管理、追加手順
- [「自分と相手の優先・境界線」パラメータ変換設計](diagnosis/scoring/relationship-priority-parameter-design.md) — 最初の診断固有のパラメータ、重み、表示設定
- [「お金と消費」パラメータ変換設計](diagnosis/scoring/money-values-parameter-design.md) — 2つ目の診断固有のパラメータ、重み、表示設定
- [「インドア・アウトドアと余暇」パラメータ変換設計](diagnosis/scoring/leisure-style-parameter-design.md) — 3つ目の診断固有のパラメータ、重み、表示設定

### ドメインを設計する

- [ドメイン設計](domain/domain-design.md) — Account / Brain / Sourceの責務・境界、Diagnosisの位置づけ、設計順序と進捗
- [Brain内部情報の分類](domain/brain/brain-content-taxonomy.md) — Brain Itemの分類、共通属性、意思決定での利用方法
- [Brainのラベル・アクセス制御設計](domain/brain/brain-access-label-design.md) — Topic Label、Access Label、Access Profile、MCP提供時の原則
- [根拠・反証・改訂のエッジ設計](domain/brain/evidence-edge-design.md) — Source RecordとBrain Itemを結ぶエッジ
- [Source Recordのライフサイクル設計](domain/source/source-record-lifecycle-design.md) — 不変性、訂正、削除、取り消し、撤回、エクスポート

### システム・デザイン・開発運用を確認する

- [インフラ・システム構成](architecture/infrastructure-architecture.md) — Cloudflareを利用するシステム構成とサービス配置
- [キャラクターデザイン](design/character-design.md) — うつし・ミラの設定とデザインアセット
- [診断seed運用](development/diagnosis-seed.md) — 診断をD1へ登録するseedの配置、実行、更新、検証方法
- [診断API契約](development/diagnosis-api.md) — Web UIとAPI Server間の診断API契約
- [API契約とクライアント型の生成](development/api-contract-generation.md) — HTTP契約の配置とOpenAPI・Web UI用型の生成運用
- [PR作成手順書](development/pull-request-guidelines.md) — PRタイトル、概要、作成前の準備と検証手順

## ドキュメントを更新する

文書の責務とSSoTは[Agent向けガイドのドキュメントマップ](../.agents/README.md#ドキュメントマップ)で確認します。追加・移動・更新時は[ドキュメント運用ルール](../.agents/rules/documentation.md)に従います。
