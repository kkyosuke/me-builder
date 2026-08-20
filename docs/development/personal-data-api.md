# 開発用本人入力データAPI契約

## 1. 目的

この文書は、開発環境で本人の現在有効な診断回答と日記を検証し、日記だけを訂正または削除するAPI契約を定義します。通常ユーザー向けのデータ管理画面ではなく、開発・試験のための機能です。

Source Recordの不変性、Revision、tombstoneは[Source Recordのライフサイクル設計](../domain/source/source-record-lifecycle-design.md)、診断回答の不変性は[Phase 1 診断ドメイン設計](../diagnosis/diagnosis-domain-design.md)、画面の入口と戻る操作は[プロフィール設定体験設計](../product/profile-settings-experience.md)を正とします。Account削除、Identity削除、Brain特徴JSON、LINEの送信取り消しは所有しません。

## 2. 環境境界と認可

この文書が所有する経路は`development`、`local`、`preview`、`test`だけに公開し、productionでは認証判定より前に`404`を返します。許可環境でもHttpOnlyのアプリセッションCookieからAccountを解決し、変更系では同一OriginとCSRF tokenを検証します。Account IDはclientから受け取りません。

一覧と応答には`Cache-Control: no-store`を付け、運用ログへSource Record ID、診断回答、日記本文、訂正後本文を記録しません。

## 3. API

| Method | Path | 結果 |
| --- | --- | --- |
| `GET` | `/api/personal-data/records` | 現在有効な診断回答と日記を返す |
| `PATCH` | `/api/personal-data/records/:sourceRecordId` | 日記だけを改訂し、新しいSource RecordとRevisionを作る |
| `DELETE` | `/api/personal-data/records/:sourceRecordId` | 日記だけをtombstoneへ遷移する |

診断回答は一覧でread-onlyです。診断Source Recordへの`PATCH`と`DELETE`は、本人のRecordであっても`409 Diagnosis answer is immutable`を返します。同じ質問への回答変更も診断回答APIが`409 answer_is_immutable`で拒否します。

日記本文は空文字を受け付けず5,000文字を上限とします。訂正は旧版を上書きせず、新しいSource RecordとRevision edgeを作ります。同じ本文への再送は`unchanged`です。削除はmetadata、Revision、Evidenceの来歴を残し、payloadを利用不能にします。

日記の訂正・削除で影響を受けるBrain Itemは同期的に`invalidated`へ遷移し、Vector削除jobを同じ操作で永続化します。Vectorizeの物理削除は再試行可能なQueue経路で収束させます。生成済みまとめと相性共有projectionも利用不能にし、残った入力から再生成できるようにします。

## 4. 完了条件

- productionでは全経路が認証より前に`404`となる
- 診断回答を確認できるが、訂正・個別削除できない
- 日記訂正で旧版を上書きせずRevisionを保持する
- 日記削除直後から原文と派生物を利用できない
- 別Account、削除済み、改訂済みのSource Recordを操作できない
- API、Web、運用ログからAccount IDと本人の原文を漏らさない
