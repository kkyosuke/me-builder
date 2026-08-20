# 本人データ特徴API実装契約

## 1. 目的

この文書は、本人Accountから本文を含まないBrain特徴だけをAPI連携用に取得する契約を定義します。ダウンロード用archive、Web UI、importは提供しません。

本人入力の訂正・削除は[本人入力データ訂正・削除API契約](personal-data-api.md)、保存先は[Accountデータ分離設計](../architecture/account-data-isolation.md)を正とします。

## 2. データ境界

APIは次の3 scopeを常に返します。

- `attributes`: Brain Itemの構造化済み特徴
- `active`: 現在有効なItem
- `history`: `superseded`または`invalidated`となったItem

各Itemに含めるのはcategory、attributes、status、derivation、stability、sensitivity、適用期間、観測日時、作成・更新日時です。次は返しません。

- 日記・会話本文、診断回答、自由記述、AI応答
- Brain Itemのstatement、Evidence、Confidence
- Brain Item ID、Source Record ID、Evidence ID、Account ID
- 相手Accountの情報、CompatibilityData
- 認証、運用、model、prompt、課金に関する情報

形式は`kagami-brain-features`、`formatVersion`は`1`です。この応答から原文や根拠の識別子を復元できないことを境界とします。

## 3. APIと認可

| Method | Path | 結果 |
| --- | --- | --- |
| `GET` | `/api/personal-data/features` | 本人のsanitized Brain特徴を返す |

HttpOnlyのアプリセッションCookieからAccountを解決し、本人のAccountDataだけを参照します。Account IDをpath、query、bodyから受け取りません。応答には`Cache-Control: no-store`を付け、本文を運用ログへ記録しません。

Web画面、ダウンロードボタン、ファイル生成、非同期archive、import経路は設けません。旧`/api/personal-data/exports`経路は公開しません。

## 4. Planとの関係

Free、Lite、Full、ファミリーパックのすべてで同じAPIを利用できます。Entitlement、AI利用上限、課金projectionの状態によって内容を変えません。

## 5. 完了条件

- 3 scopeと各Itemの構造化特徴をAPIで取得できる
- 本文、AI応答、Evidence、Confidence、各種内部IDを返さない
- 別Accountの特徴を取得できない
- JSON archiveとエクスポートUIを提供しない
- すべてのPlanで同じ境界を適用する
