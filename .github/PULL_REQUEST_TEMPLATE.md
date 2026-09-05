<!-- 
PRタイトル規約: <type>(<scope>): <簡潔な説明>
例: feat(api): 認証エンドポイントを追加
例: fix(web): ボタンのレスポンシブ表示を修正
例: docs: PR作成手順書を作成

Type: feat, fix, docs, style, refactor, test, chore, ci
Scope: web, api, mcp, shared, deps, docs
詳細は docs/development/pull-request-guidelines.md を参照してください。
-->

## 概要 (Summary)
<!-- なぜこの変更を行うのか、目的や背景を簡潔に記述してください -->

## 関連 Issue / PR (Related Issues / PRs)
<!-- 関連する Issue や PR があれば記載してください (例: Closes #123, Ref #456) -->

## 変更内容 (Changes Made)
<!-- 主な変更点や追加・削除した機能を箇条書きで記述してください -->
-

## 動作確認・検証手順 (Verification / How to Test)
<!-- 対象テストやローカル開発サーバーでの画面確認など、変更範囲に応じて実施した内容を記述してください -->
- [ ] 変更内容に応じたローカル検証または手動確認を実施（不要な場合は理由を記載）
-

## 事前チェックリスト (Checklist)
<!-- PR提出前に該当する項目にチェックを入れてください -->
- [ ] PRタイトルが `<type>(<scope>): <説明>` の規約に従っている
- [ ] 関連するドキュメントや SSoT を確認・更新した
- [ ] 不要なファイルやビルド成果物がコミットに含まれていない (`git diff --check` クリア)
