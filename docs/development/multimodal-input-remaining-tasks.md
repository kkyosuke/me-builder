# マルチモーダル入力実装残タスク

## 1. 目的

この文書は、[LINE写真日記入力設計](../architecture/photo-diary-input-design.md)で確定した写真入力を段階的に実装し、その他のmediaを未対応のまま分離するための残タスクを管理します。

### 所有する概念

- 写真の保存段階とAI利用段階を公開するまでの実装順
- Preview、実端末、再配送、削除を含むrelease gate
- 動画、音声、file、location、stickerを未対応として維持する作業

### 所有しない概念

- 写真の受付、保存、安全性、削除に関する決定
- Plan別の保存容量
- 利用規約の版管理と法務判断
- 動画、音声など将来mediaの具体的な設計

写真の確定仕様は[LINE写真日記入力設計](../architecture/photo-diary-input-design.md)、Plan別容量は[サブスクリプション・料金プラン設計 §4.6](../product/subscription-plan-design.md#46-写真保存容量)、規約と法務の残作業は[サービス利用規約・同意残タスク §2.3](service-terms-remaining-tasks.md#23-検討必須media入力の法務確認と規約改定を完了する)を正とします。

## 2. 現在の安全境界

現在の本人入力はLINEのテキスト日記とWebの`single_choice`診断です。LINEのimage、video、audio、file、location、stickerは署名検証後にテキストeventから分離し、本人へ未対応案内を返します。media contentを取得せず、Queue、Source Record、Brain、Vector、AI providerへ渡しません。

アバター画像はプロフィール表示専用であり、日記、診断、Brainのmedia入力として再利用しません。

## 3. 保存段階

依存順に次を実装します。

1. 写真日記専用Private R2、AccountDataのmedia metadata、使用量と予約を追加する
2. LINE画像eventを専用取得Queueへ投入し、設計済みのkeyで冪等化する
3. LINE取得の再試行、終端失敗、本人への成功・失敗案内を実装する
4. 許可形式、size、pixel数、decode、animation、実形式を永続化前に検証する
5. 原本を変えず、表示用metadataを除いたthumbnailを生成する
6. 本人の日記履歴で、認証付きの閲覧、汎用代替テキスト、削除を提供する
7. 削除直後の利用停止と物理削除を設計の期限内にjobで収束させる
8. Plan downgradeと同時uploadを含む容量判定を実装する
9. 写真保存だけのfeature flagを追加し、AI、Brain、Vectorへの経路が閉じていることをnegative testで固定する

保存段階では写真のbinary exportを追加しません。本人データ特徴APIに写真bytes、画像固有metadata、画像由来のAI派生物を混ぜないことを検証します。

### 3.1 【検討必須】Production公開前の法務・規約gate

[サービス利用規約・同意残タスク §2.3](service-terms-remaining-tasks.md#23-検討必須media入力の法務確認と規約改定を完了する)を完了し、承認済みの重要改定へ再同意済みのAccountだけから写真を取得します。このgateが未完了ならPreviewで技術検証できてもProduction flagを有効にしません。

## 4. AI利用段階

保存段階のProduction検証後、別PRで次を実装します。

1. safety結果と`usage_eligibility`を保存状態から分離する
2. EXIF／GPSを除去した一時派生物だけをVertex AI Express ModeのGeminiへ送る
3. `blocked`を再送、別model、Brain Item、Vector、意味検索、推薦から除外する
4. 写真だけの日記への応答と、画像を根拠にしたBrain Itemのschema・Evidence制約を追加する
5. AI用派生物を成功、失敗、timeoutのすべてで破棄する
6. AI利用量を保存容量と別に計測し、上限でも保存・閲覧・削除を維持する
7. 顔認識、人物特定、属性推定をprompt、schema、negative datasetで拒否する

### 4.1 【検討必須】写真AI分析のPlan別上限

写真AI分析の1回の定義、Free／Lite／Full／ファミリーパックの月間上限、再試行とsafety blockを消費へ数える条件を決定します。決定前はAI利用段階のfeature flagを有効にしません。

## 5. 検証

- LINE実端末から1枚を送り、原本、thumbnail、日記履歴、削除まで確認する
- 同じWebhook、同じmessage、同じQueue jobを再配送しても1件だけ保存される
- LINE content取得の一時失敗、終端失敗、再試行期限経過を再現する
- size、実形式、decode、pixel数、animationの各拒否caseをfixtureで固定する
- 同時uploadでPlan上限を超えず、保存失敗時に予約が戻る
- downgrade後も既存写真を閲覧・削除でき、新規uploadだけが止まる
- 別Accountと未同意Accountが原本、thumbnail、存在を取得できない
- 原本以外からEXIFとGPSが除去される
- 削除後のR2、AI派生、Brain、Vectorに対するnegative testが通る
- 保存段階ではGemini呼び出しが0件である
- AI利用段階では`blocked`の再利用が0件である
- 写真本文と識別子を含まないmetricsだけで成功、失敗、bytes、遅延を確認できる

## 6. 将来media

動画、音声、file、location、sticker、Web upload、診断画像回答は、この写真設計をそのまま流用して有効にしません。種別ごとにsizeまたはduration、形式、metadata、malware、再生、accessibility、AI provider送信、保存容量、削除を決定し、別のrelease gateを作ります。

## 7. 更新ルール

- 実装済みの作業は削除し、実環境で未完了の確認だけを残す
- 写真の決定を変更する場合は、先にLINE写真日記入力設計を更新する
- Plan上限、規約、exportの詳細をこの文書へ複製しない
- 将来mediaを写真の完了と同時に完了扱いにしない
