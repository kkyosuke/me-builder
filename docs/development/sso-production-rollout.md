# SSO Production段階公開Runbook

## 1. 目的

このRunbookは、LIFF内の利用を維持したまま、外部ブラウザSSOを運営Account、link済みAccountの少数割合、対象全体の順にProductionへ公開し、安全に停止・再開する手順です。

認証と割合判定の契約は[Web認証・SSO設計](../architecture/web-authentication-design.md)、Previewの通し検証は[SSO Preview検証Runbook](sso-preview-verification.md)を正とします。

### 所有する概念

- ProductionへSSOを段階公開するゲート、phase、監視、停止・再開手順
- 各phaseで残す証跡と段階公開の完了判定

### 所有しない概念

- 認証、Identity、session、段階公開flagと割合判定の意味
- Previewでの成功・失敗シナリオと切り戻し判定
- アプリケーション運用ログへ記録できる情報

## 2. 公開前ゲート

次がすべて満たされるまでProductionの`SSO_ROLLOUT_MODE`を`disabled`から変更しません。

- AUTH-A、AUTH-B、AUTH-Cの必須stackがmergeされ、Production対象commitのCIが成功している
- Preview Runbookの成功、negative、rollbackシナリオがすべてpassしている
- Production専用Auth0 tenant／client、完全一致callback、secretがPreviewから分離されている
- SSO開始、callback結果、session発行・失効を匿名trace IDで追える
- Productionの基準期間でLIFF認証成功率、session失効件数、5xx率を記録済み
- 公開担当、監視担当、rollback担当、問い合わせ担当と実施時間をrelease記録へ確定済み

release記録には各phaseの最低試行数、観測時間、認証成功率、callback失敗率、Account未解決率、LIFF成功率の許容差を事前に記載します。観測後に基準を緩めません。

## 3. 設定の参照先

`SSO_ROLLOUT_MODE`と`SSO_ROLLOUT_PERCENT`の値、既定値、対象判定は[Web認証・SSO設計 §9.3](../architecture/web-authentication-design.md#93-環境とurl)を参照します。このRunbookでは、その契約を変更せずphaseごとの操作順だけを定めます。Account IDやAuth0 subjectのallowlistは作りません。

## 4. 段階公開

### Phase 0: 停止状態とIdentity追加

1. `SSO_ROLLOUT_MODE=disabled`、`SSO_ROLLOUT_PERCENT=0`でLIFF基準値を確認する。
2. 短時間だけ`linking`にし、運営Accountと検証合意済みAccountへSSO Identityを追加する。
3. Identity追加件数と失敗件数を固定eventで確認し、`disabled`へ戻す。

### Phase 1: 運営Account

1. `SSO_ROLLOUT_PERCENT=0`を維持したまま`linked-login`へ変更する。
2. 管理者roleの外部ブラウザSSO、直接リンク、logout、LIFFへの切替を確認する。
3. 事前に定めた観測時間と最低試行数を満たし、全指標が基準内なら次へ進む。

### Phase 2: link済みAccountの少数割合

1. release記録で定めた小さい割合へ`SSO_ROLLOUT_PERCENT`を上げる。
2. 認証成功、callback失敗、`identity_unlinked`、`rollout_excluded`、session発行・失効、LIFF成功率を監視する。
3. 観測ゲートを満たす場合だけ割合を一段ずつ上げる。一度に100へ変更しない。

### Phase 3: 対象全体

1. 直前phaseが観測ゲートを満たした後に`SSO_ROLLOUT_PERCENT=100`へ変更する。
2. link済みAccount全体の指標とLIFF基準値を継続監視する。
3. 外部ブラウザの旧LINE Loginを終了する場合は、事前に公開案内、Identity追加案内、問い合わせ手順、復旧手順を更新する。

## 5. 監視と証跡

phaseごとに次を固定event／error codeと件数で集計します。

- `sso.authentication.started`、`sso.callback.completed`、`sso.callback.cancelled`、`sso.callback.failed`
- session基盤の発行、rotation、失効
- `identity_unlinked`と`rollout_excluded`
- LIFF交換の成功／失敗と、Production基準期間からの成功率差
- SSO endpointとLIFF endpointの5xx率

証跡にはdeploy commit、phase、mode、percent、UTC時刻、匿名trace ID、件数、固定結果だけを残します。token、Cookie、OAuth state／code、subject、Account ID、メールアドレス、個人内容、provider応答は残しません。

## 6. 即時停止と再開

いずれかの停止条件を満たした場合、割合を下げるだけでなく`SSO_ROLLOUT_MODE=disabled`へ変更して再deployします。

1. `disabled`がAPIとWebの両方へ反映されたことを確認する。
2. 新しいSSO開始とIdentity追加が503になり、開始eventが増えないことを確認する。
3. LIFF実端末で認証交換、本人画面、mutationが継続することを確認する。
4. 既存application sessionを一律失効していないことを確認する。
5. 障害phase、最初と最後の発生時刻、固定error code、影響件数だけをincidentへ記録する。

再開時は、原因修正をPreview Runbookで再検証し、ProductionをPhase 1の`linked-login`／0%からやり直します。停止前の割合へ直接戻しません。

## 7. 完了条件

100% phaseが事前の観測ゲートを満たし、LIFFの成功率が許容差内で、即時停止と0%からの再開を実施でき、公開案内とサポート手順が更新済みの場合だけ段階公開を完了とします。
