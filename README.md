# me-builder

me-builderは、さまざまな質問への回答を蓄積し、その人らしく考え、答える「自分の分身（Me Agent）」を作成するサービスです。

現在は、LINEのテキスト日記とWebの選択式診断で回答を蓄積します。写真、動画、音声などの入力と、蓄積した回答を本人が許可した範囲でMCPから利用する機能は、将来の提供範囲です。

## ドキュメント

- [ドキュメントガイド](docs/README.md) — ディレクトリ構造、文書の探し方、全ドキュメントへの入口
- [プロジェクト概要](docs/product/project-overview.md) — 目的、MVP、Phase 1の入力体験とログイン手段
- [サービス紹介サイト設計](docs/product/service-site-design.md) — 公開サイトのサイトマップ、ページ構成、掲載内容と公開前の確認事項
- [サブスクリプション・料金プラン設計](docs/product/subscription-plan-design.md) — Free、Lite、Full、ファミリーパックの価格と提供価値
- [ドメイン設計](docs/domain/domain-design.md) — Account / Brain / Sourceの責務・境界、Diagnosisの位置づけ、設計順序と進捗
- [Agent向けガイド](.agents/README.md) — ドキュメント運用・設計スコープのルール

## 現在のフェーズ

現在はPhase 1（回答を集める）の設計と実装を進めています。最初のリリースでは、以下の2点を中核とします。

1. LINEの日記とWebの選択式診断で、自分を表すデータを蓄積できること
2. 蓄積した診断回答と、AIが生成した「わたしのまとめ」を本人が確認できること

本人が入力した診断回答と日記はWebで確認・訂正・削除できます。生データのエクスポートは提供せず、外部連携向けには認証済みAPIで復元不能なBrain特徴メタデータだけを提供します。診断の自由記述・画像回答はV2で提供します。

MCPによる外部AIエージェントとの接続は、初期リリースには含めずPhase 2で提供します。

Phaseの構成とPhase 1の利用体験は[プロジェクト概要](docs/product/project-overview.md)を参照してください。
