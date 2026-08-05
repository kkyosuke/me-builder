# me-builder

me-builderは、さまざまな質問への回答を蓄積し、その人らしく考え、答える「自分の分身（Me Agent）」を作成するサービスです。

ユーザーはテキストだけでなく、選択肢、写真、動画、音声などを使って質問に回答できます。蓄積した回答は、本人が許可した範囲でMCPを通じてAIエージェントへ提供します。

## ドキュメント

- [ドキュメントガイド](docs/README.md) — ディレクトリ構造、文書の探し方、全ドキュメントへの入口
- [プロジェクト概要](docs/product/project-overview.md) — 目的、MVP、Phase 1の入力体験とログイン手段
- [ドメイン設計](docs/domain/domain-design.md) — Account / Brain / Sourceの責務・境界、Diagnosisの位置づけ、設計順序と進捗
- [Agent向けガイド](.agents/README.md) — ドキュメント運用・設計スコープのルール

## 現在のフェーズ

現在はPhase 1（回答を集める）の設計と実装を進めています。最初のリリースでは、以下の2点を中核とします。

1. 多様な形式の質問に回答し、自分を表すデータを蓄積できること
2. 蓄積した回答を、権限管理されたMCP経由でエージェントに提供できること

Phaseの構成とPhase 1の利用体験は[プロジェクト概要](docs/product/project-overview.md)を参照してください。
