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

LINE写真日記の保存段階は実装済みですが、`PHOTO_DIARY_STORAGE_ENABLED`の既定値を全環境で`false`としています。無効時は従来どおりimage、video、audio、file、location、stickerを署名検証後にテキストeventから分離し、本人へ未対応案内を返します。

法務・規約gateを通過した環境で保存flagを有効にした場合だけ、1対1トークのLINE provider画像を取得し、Cloudflare Imagesで検証とthumbnail生成を行い、写真専用Private R2とAccountData metadataへ保存します。保存処理にはGemini、Brain、Vector、意味検索、推薦へのbindingや呼び出しを持たせていません。動画、音声、file、location、stickerはflagに関係なく未対応です。

アバター画像はプロフィール表示専用であり、日記、診断、Brainのmedia入力として再利用しません。

## 3. 保存段階の公開残タスク

保存段階のrepository実装は完了しています。Private R2、AccountDataの直列化された容量予約、LINE取得再試行、file検証、Cloudflare Images thumbnail、本人Web UI、認証付き画像response、即時利用停止と30分間隔・47回再試行の専用削除Queue／DLQ、Account削除・dev resetへの削除波及、feature flagまで接続済みです。容量は原本とthumbnailの実bytes合計で判定します。

repositoryに残すのは、環境へ変更を適用した後にしか実施できない次のrelease作業だけです。

1. 法務確認と重要改定を完了し、保存flagを有効にできる規約versionを確定する
2. Previewへ専用R2とAccountData migrationを適用し、保存flagをPreviewだけで有効にする
3. LINE実端末で、1枚の送信、再配送、容量超過、閲覧、削除、Account削除を確認する
4. R2／LINEの一時障害とDLQを演習し、本文、LINE user ID、message ID、R2 keyがログへ出ないことを確認する
5. Preview証跡と法務承認をrelease checklistへ記録してからProduction flagを有効にする

保存段階では写真のbinary exportを追加しません。本人データ特徴APIにも写真bytes、画像固有metadata、画像由来のAI派生物を含めません。

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

repository CIでは、MIMEとmagic bytesの不一致、decode失敗、10MB、4,000万pixel、APNG、容量合計、再配送の一意性、即時tombstone、R2削除失敗時の再試行、CSRF付き削除、1対1 LINE provider限定を自動検証します。保存用schemaと処理からBrain Item、Vector、text payloadを生成しないnegative testも維持します。

実環境でだけ確認できる項目は§3のrelease作業へ集約します。AI利用段階では、`blocked`の再利用が0件であること、Geminiの実safety応答、AI用派生物の全終了経路での破棄を別のdatasetとPreview検証で追加します。

## 6. 将来media

動画、音声、file、location、sticker、Web upload、診断画像回答は、この写真設計をそのまま流用して有効にしません。種別ごとにsizeまたはduration、形式、metadata、malware、再生、accessibility、AI provider送信、保存容量、削除を決定し、別のrelease gateを作ります。

## 7. 更新ルール

- 実装済みの作業は削除し、実環境で未完了の確認だけを残す
- 写真の決定を変更する場合は、先にLINE写真日記入力設計を更新する
- Plan上限、規約、exportの詳細をこの文書へ複製しない
- 将来mediaを写真の完了と同時に完了扱いにしない
