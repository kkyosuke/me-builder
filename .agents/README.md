# Agent向けガイド

## 作業前に読むもの

すべての作業で次のルールを確認します。

- [ドキュメント運用ルール](rules/documentation.md)
- [設計スコープのルール](rules/design-scope.md)

## ドキュメントマップ

| 文書 | 所有する内容 |
| --- | --- |
| [README](../README.md) | プロジェクトの短い入口と文書リンク |
| [プロジェクト概要](../docs/project-overview.md) | 目的、主要要件、MVP、ロードマップ |
| [ドメイン設計](../docs/domain-design.md) | AccountとBrainの責務・境界、今後の設計順序 |
| [Brain内部情報の分類](../docs/brain-content-taxonomy.md) | Brain Itemの分類名、定義、具体例、意思決定での利用方法 |
| [Brainのラベル・アクセス制御設計](../docs/brain-access-label-design.md) | Topic Label、Access Label、Access Profile、MCP提供時の原則 |
| [インフラ・システム構成](../docs/infrastructure-architecture.md) | Cloudflareを全面的に採用したインフラ基盤、システム構成、サービス配置 |

この表は各文書へのナビゲーションです。概念の定義そのものはリンク先だけに記載します。

## 作業フロー

1. 変更する概念のSSoTをドキュメントマップから特定する
2. SSoTを先に更新する
3. 他文書では重複記述を増やさず、必要ならリンクまたは短い要約だけを更新する
4. [ドキュメント運用ルール](rules/documentation.md)のチェックリストで確認する
5. 変更内容と、どのSSoTを更新したかを報告する

新しい概念の所有先が不明な場合、既存文書へ分散して追記してはいけません。先に所有先を決め、[ドキュメントマップ](#ドキュメントマップ)へ追加します。
