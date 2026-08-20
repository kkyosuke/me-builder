# 開発用本人データ特徴JSON契約

## 1. 目的

この文書は、開発環境で本人Accountから本文を含まないBrain特徴をAPI取得し、同じ応答をJSONファイルとして書き出す契約を定義します。全量の本人データarchive、原文エクスポート、importは提供しません。

Source Recordの履歴とtombstoneは[Source Recordのライフサイクル設計](../domain/source/source-record-lifecycle-design.md)、開発用の入力データ操作は[開発用本人入力データAPI契約](personal-data-api.md)、保存先は[Accountデータ分離設計](../architecture/account-data-isolation.md)を正とします。Account復旧、各データモデルの意味、料金プラン、決済事業者の支払情報は所有しません。

## 2. データ境界

APIは`metadata`、`active`、`history`の3 scopeを常に返します。各Itemに含めるのはcategory、status、derivation、推定か否か、stability、sensitivity、適用期間、観測日時、作成・更新日時です。永続化された`attributes`は展開しません。

次のデータは返しません。

- 日記・会話本文、診断回答、自由記述、AI応答
- Brain Itemのstatement、Evidence、Confidence、各種内部ID
- 相手AccountやCompatibilityData、認証・運用・model・prompt・課金情報
- 写真原本、thumbnail、EXIF、画像固有metadata、画像由来のAI派生物

形式は`kagami-brain-features`、`formatVersion`は`1`です。この応答から原文、media、根拠の識別子を復元できないことを境界とします。

## 3. API、書き出し、認可

| Method | Path | 結果 |
| --- | --- | --- |
| `GET` | `/api/personal-data/features` | 本人のsanitized Brain特徴を返す |

経路は`development`、`local`、`preview`、`test`だけに公開し、productionでは認証判定より前に`404`を返します。許可環境ではHttpOnlyのアプリセッションCookieからAccountを解決し、本人のAccountDataだけを参照します。Account IDをpath、query、bodyから受け取りません。応答には`Cache-Control: no-store`を付け、内容を運用ログへ記録しません。

Webの`DEV ONLY`入力データ画面は、このGET応答を検証した後、`me-builder-brain-features.json`として同期的に書き出します。非同期生成、期限付きdownload、旧`/api/personal-data/exports`経路は設けません。

## 4. Planとの関係

開発環境ではEntitlement判定を通しません。通常ユーザー向けエクスポートの提供可否は、この検証用実装から推定しません。

## 5. 完了条件

- productionでAPIとWeb導線が利用できない
- 3 scopeと各Itemの構造化特徴をAPIとJSONファイルで取得できる
- 本文、AI応答、Evidence、Confidence、各種内部ID、写真関連情報を返さない
- 別Accountの特徴を取得できない
- 全量archive、原文エクスポート、import経路を提供しない
