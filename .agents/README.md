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
| [プロジェクト概要](../docs/project-overview.md) | 目的、主要要件、MVP、ロードマップ、Phase 1の入力体験とログイン手段 |
| [Phase 1 アンケート体験設計](../docs/questionnaire-experience.md) | アンケート一覧、回答、回答内容、LINE通知、リッチメニューのUIと遷移、縦切りの完了条件 |
| [ドメイン設計](../docs/domain-design.md) | Account / Brain / Sourceの責務・境界、ドメイン間の関係、Source Recordの粒度とkind、設計順序と進捗 |
| [Brain内部情報の分類](../docs/brain-content-taxonomy.md) | Brain Itemの分類名、定義、具体例、分類とは別に持つ共通属性、意思決定での利用方法 |
| [根拠・反証・改訂のエッジ設計](../docs/evidence-edge-design.md) | Source RecordとBrain Itemを結ぶエッジの種類と属性、Confidenceとの関係、外部への開示粒度、改訂された旧版の扱い |
| [Brainのラベル・アクセス制御設計](../docs/brain-access-label-design.md) | Topic Label、Access Label、Access Profile、MCP提供時の原則、Source Recordの既定ラベル |
| [インフラ・システム構成](../docs/infrastructure-architecture.md) | Cloudflareを全面的に採用したインフラ基盤、システム構成、サービス配置 |
| [キャラクターデザイン](../docs/character-design.md) | うつし・ミラの名前、役割、外見設定、デザインアセットの置き場所と命名規則 |
| [PR作成手順書](../docs/pull-request-guidelines.md) | PRタイトルの命名規則、概要の書き方、作成前の準備・検証手順 |

この表は各文書へのナビゲーションです。概念の定義そのものはリンク先だけに記載します。

## 作業フロー

1. 変更する概念のSSoTをドキュメントマップから特定する
2. SSoTを先に更新する
3. 他文書では重複記述を増やさず、必要ならリンクまたは短い要約だけを更新する
4. [ドキュメント運用ルール](rules/documentation.md)のチェックリストで確認する
5. 変更内容と、どのSSoTを更新したかを報告する

新しい概念の所有先が不明な場合、既存文書へ分散して追記してはいけません。先に所有先を決め、[ドキュメントマップ](#ドキュメントマップ)へ追加します。
