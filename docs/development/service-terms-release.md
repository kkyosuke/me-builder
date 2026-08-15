# サービス利用規約の公開運用

## 1. 目的

この文書は、サービス利用規約の新しいversionを安全に追加し、Previewで確認してから本番へ公開する手順を所有します。

### 所有する概念

- 新しい規約versionを追加する作業順序
- `requiresReacceptance`を決定・確認する担当境界
- version、公開日時、本文hashを公開前に検証する方法
- 公開後に問題が見つかった場合のforward-onlyな訂正方法

### 所有しない概念

- 規約本文と再同意要否のプロダクト上の意味
- Accountごとの同意履歴と同意画面
- プライバシーポリシー、問い合わせ先、運営者情報
- D1マイグレーション全般の適用・復旧方法

規約本文、版管理規則、同意体験は[サービス利用規約・同意体験設計](../product/service-terms-consent-experience.md)、D1の適用順序と復旧は[本番データベースマイグレーション運用](production-migration-operations.md)を正とします。

## 2. 公開フロー

```mermaid
flowchart TD
    A[変更内容と影響範囲を整理] --> B[再同意要否を確認]
    B --> C[公開済み一覧の末尾へ新versionを追加]
    C --> D[version・公開日時・本文hashを検証]
    D --> E[Previewで本文と同意導線を確認]
    E --> F[PRレビュー]
    F --> G[mainへのマージで本番公開]
    G --> H[現在versionと同意状態を確認]
```

### 2.1 変更内容を確定する

1. 変更理由と利用者への影響をPRへ記載する
2. 利用者の権利、料金、データの利用目的・提供先、禁止事項、責任範囲に重要な影響がある場合は、法務確認を完了してから`requiresReacceptance: true`とする
3. 意味を変えない誤字修正や説明の明確化だけであることを確認できた場合は、`requiresReacceptance: false`とする
4. 判断が確定していない状態で公開用versionを追加しない

### 2.2 新しいversionを追加する

[`service-terms.ts`](../../packages/shared/src/legal/service-terms.ts)の公開済み一覧の末尾へ追加します。既存要素を編集・並べ替え・削除しません。

- versionは公開日の`YYYY-MM-DD`、同日2件目以降は`YYYY-MM-DD-2`から始まる連番にする
- `publishedAt`は実際に公開する日時をISO 8601で記録し、Asia/Tokyoでの公開日をversionの日付と一致させ、一覧で単調増加させる
- `contentHash`以外の公開文書全体を`JSON.stringify`したUTF-8バイト列のSHA-256を保存する
- 本文表示が変わる場合は、意味を変えない修正でも新versionと新hashを使う

## 3. 自動検証

規約だけを確認する場合は、リポジトリルートで次を実行します。

```bash
task terms:verify
```

この検証は次を確認し、通常の`task ci`でも同じテストを実行します。

- versionの形式、一意性、日付ごとの連番
- `publishedAt`の形式、versionとの日付一致、公開順
- 本文hashの一致とhashの一意性
- 重要改定が1件以上あり、最新の同意必須versionを解決できること
- 公開済み旧版の代表値が意図せず変更されていないこと

## 4. Previewとレビュー

Previewでは、初回利用者と既存利用者の両方で確認します。

- 最新のタイトル、version、適用日、全文が表示される
- 重要改定では既存利用者にも再同意を求め、軽微改定では利用を継続できる
- 同意後は「わたしのまとめ」へ遷移する
- プロフィールの同意履歴へ新しいversion、本文hash、同意日時が追加される
- 同じversionへの再送で履歴が重複しない

PRでは変更理由、`requiresReacceptance`の判断根拠、Preview確認結果を記載します。本文の意味に影響する変更は、実装レビューとは別に必要な内容確認を完了してからマージします。

## 5. 公開後の訂正

公開済みversionは履歴の証拠なので書き換えません。誤りが見つかった場合も、一覧の末尾へ訂正版を新しいversionとして追加します。公開済みversionの削除やhashの差し替えで戻さず、影響に応じて訂正版の`requiresReacceptance`を決めます。
