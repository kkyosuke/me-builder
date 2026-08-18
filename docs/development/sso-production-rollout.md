# SSO Production段階公開Runbook

## 1. 目的

このRunbookは、個人運営の小規模サービスでLIFF内の利用を維持したまま、外部ブラウザSSOを管理者、少数のlink済み協力者、link済み対象者全体の順にProductionへ公開し、安全に停止・再開する手順です。

認証と対象判定の契約は[Web認証・SSO設計](../architecture/web-authentication-design.md)、Previewの通し検証は[SSO Preview検証Runbook](sso-preview-verification.md)、公開方針は[Web認証・SSO実装残タスク](web-authentication-remaining-tasks.md)を正とします。

### 所有する概念

- ProductionへSSOを段階公開するゲート、確認、停止・再開手順
- 各段階で残す最小証跡と段階公開の完了判定

### 所有しない概念

- 認証、Identity、session、段階公開flagと割合判定の意味
- Previewでの成功・失敗シナリオ
- Workers Logsの保持期間や外部observability製品の選定

## 2. 公開前ゲート

次がすべて満たされるまでProductionの`SSO_ROLLOUT_MODE`を`disabled`から変更しません。

- AUTH-A、AUTH-B、AUTH-Cの必須stackがmergeされ、Production対象commitのCIが成功している
- Preview Runbookを実IdP、普段使うスマートフォン、PCの主要ブラウザ1つでpassしている
- Production専用Auth0 tenant／client、完全一致callback、secretがPreviewから分離されている
- SSO開始、callback結果、session発行・失効を匿名trace IDで追える
- 公開操作、停止、問い合わせ、最終承認を行うサービス管理者をrelease記録へ記載している
- 少数の協力者へIdentity追加方法、SSO利用方法、問い合わせ先を案内している

開始前のrelease記録には、少なくとも次の欄を持たせます。担当は同じサービス管理者が兼任できます。

```text
deploy commit:
Preview evidence:
release operator:
emergency stop operator:
final approver:
collaborator notice:
support procedure:
```

空欄や`TBD`が残る場合は管理者確認を開始しません。固定割合、最低試行数、成功率SLOは必須欄にしません。

## 3. 設定の参照先

`SSO_ROLLOUT_MODE`と`SSO_ROLLOUT_PERCENT`の値、既定値、対象判定は[Web認証・SSO設計 §9.3](../architecture/web-authentication-design.md#93-環境とurl)を参照します。Account IDやAuth0 subjectのallowlistは作りません。

少数公開はallowlistではなく、事前にSSO Identityを追加したAccountを少数に保つことで行います。管理者確認では`linked-login`／0%、協力者確認以降は`linked-login`／100%を使用できます。

## 4. 段階公開

### Phase 0: 停止状態とIdentity追加

1. `SSO_ROLLOUT_MODE=disabled`、`SSO_ROLLOUT_PERCENT=0`でLIFFが利用できることを確認する。
2. 短時間だけ`linking`にし、管理者と事前案内した少数の協力者へSSO Identityを追加する。
3. Identity追加の成功または固定error codeをWorkers Logsで確認し、`disabled`へ戻す。

### Phase 1: 管理者

1. `SSO_ROLLOUT_PERCENT=0`のまま`linked-login`へ変更する。
2. 管理者が外部ブラウザSSO、logout、LIFFへの切替を複数回確認する。
3. 未解決の再現可能な問題がなければ協力者確認へ進む。

### Phase 2: 少数のlink済み協力者

1. link済みAccountが管理者と事前案内した協力者に限られることを確認する。
2. `SSO_ROLLOUT_PERCENT=100`へ変更し、協力者が外部ブラウザSSOとLIFFを確認する。
3. Workers Logsでcallback結果、5xx、LIFF交換結果を確認する。
4. 一時的な失敗は再試行し、同じ原因が繰り返す場合や再現する場合は次へ進めず調査する。

### Phase 3: link済み対象者全体

1. 協力者確認に未解決の安全問題がなければ、一般利用者へIdentity追加方法とSSO利用方法を案内する。
2. `linked-login`／100%を維持し、新たにlinkしたAccountを対象へ加える。
3. LIFFを引き続き利用できることと、問い合わせ先を全体案内へ明記する。

## 5. 監視と証跡

専用metrics基盤は設けず、Workers Logsで次を手動確認します。

- `sso.authentication.started`、`sso.authentication.failed`
- `sso.callback.completed`、`sso.callback.cancelled`、`sso.callback.failed`
- session基盤の発行・失効event
- `/api/auth/liff/exchange`、SSO endpoint、LIFF endpointのHTTP status

キャンセルは障害として扱いません。固定の成功率や試行数ではなく、同じerror codeの繰り返し、再現性、利用者影響をサービス管理者が判断します。Account誤連携、個人情報漏えい、不正ログインの疑いは、件数にかかわらず即時停止します。

phaseごとにdeploy commit、日時、確認した端末・ブラウザ、シナリオ、合否をPRまたはIssueへ要約します。token、Cookie、OAuth state／code、subject、Account ID、メールアドレス、個人内容、provider応答は残しません。詳細証跡用の専用ストレージは作りません。

## 6. 即時停止と再開

安全上の停止条件を満たした場合、Production変更権限を持つサービス管理者は事前承認なく`SSO_ROLLOUT_MODE=disabled`へ変更して再deployできます。

1. `disabled`がAPIとWebへ反映されたことを確認する。
2. 新しいSSO開始とIdentity追加が503になり、開始eventが増えていないことを確認する。
3. LIFF実端末で認証交換、本人画面、mutationが継続することを確認する。
4. 既存application sessionを一律失効していないことを確認する。
5. 障害の発生時刻、固定error code、影響の概要だけをincidentへ記録する。

再開時は原因を修正し、Previewで再確認してからProductionの管理者確認をやり直します。停止前の段階へ直接戻しません。再開は最終承認者が承認します。

## 7. 完了条件

管理者と少数の協力者が実ブラウザでSSOとLIFFを確認し、未解決の安全問題がなく、全体向けの利用案内と問い合わせ手順を公開した場合に段階公開を完了とします。
