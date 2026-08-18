# SSO Preview検証Runbook

## 1. 目的と適用範囲

このRunbookは、Auth0 SSOをProductionへ公開する前に、PreviewでLIFF内と外部ブラウザの成功・失敗経路を通しで確認する手順です。SSOだけを停止してLIFF利用を継続できるところまでを検証範囲とします。

認証方式、Identity、session、段階公開flagの設計は[Web認証・SSO設計](../architecture/web-authentication-design.md)、ログに記録できる情報は[アプリケーション運用ログ方針](operational-logging.md)を正とします。

### 所有する概念

- Previewで行うSSO成功・失敗シナリオと開始条件
- Previewでの切り戻し確認、証跡形式、完了判定

### 所有しない概念

- 認証、Identity、session、段階公開flagの意味と安全上の規則
- アプリケーション運用ログへ記録できる情報
- Productionへの段階公開手順

Productionへの公開は[SSO Production段階公開Runbook](sso-production-rollout.md)が所有します。

## 2. 開始条件

検証担当者は、次がすべて満たされるまで通し検証を開始しません。

- 対象commitのCIが成功し、Preview Web、API、D1、短命transaction storeが同じstackでdeploy済み
- Auth0 Preview tenantのcallback、logout、Web originが設計書の完全一致URLで登録済み
- application session issuerと失効処理が接続済みで、SSO transactionを同時実行時にも一度だけconsumeできる
- `SSO_ROLLOUT_MODE=linking`から開始し、SSOを追加する既存Accountを2件以上用意済み
- LIFF実端末、通常の外部ブラウザ、管理者Account、未linkの別Accountを別々のブラウザprofileで操作可能
- 検証中にProductionのtenant、secret、callback URLを使わないことを確認済み

個人の実データを使いません。検証用Accountにも、氏名、メールアドレス、会話、診断回答などの実在する個人内容を登録しません。

## 3. 自動検証

deploy前にリポジトリrootで次を実行します。

```sh
task ci
```

CIでは、state、nonce、PKCE、return path、Identity link、最後のIdentity解除拒否、LIFF／SSO入口選択、session revisionによるcache破棄を確認します。実IdP、実cookie、実端末の確認は次節の手動検証で補います。

デプロイ済み環境のCookie／Origin／CSRF検査、短命LIFF credentialを使うrotation／logout、2 Account・2タブ、KV／D1障害の共通手順は[LIFF交換・アプリケーションセッション境界検証Runbook](application-session-boundary-verification.md)を正とします。SSO Preview検証の前に同RunbookのPreview境界検査を完了します。

## 4. 成功経路

`linking`でIdentityを追加した後、`linked-login`へ変更して新しい外部ブラウザprofileで検証します。各行は独立した操作として実施します。

| ID | 入口 | 操作 | 期待結果 |
| --- | --- | --- | --- |
| P-S01 | LIFF実端末 | 本人画面を開き、再訪後にlogoutする | LIFF Identityでsessionが発行・再利用され、logout後は旧画面を表示しない |
| P-S02 | 外部ブラウザ | SSO link済みAccountで開く | Auth0を経由し、同じ相対pathへ復帰する |
| P-S03 | 診断直接リンク | 未認証profileで結果URLを開く | SSO後に同じ診断結果へ復帰する |
| P-S04 | 相性招待 | 招待URLを未認証profileで開く | secretをURL以外へ複製せず、SSO後に招待画面へ復帰する |
| P-S05 | 管理者URL | 管理者Accountで開く | SSO後に管理者画面へ復帰し、一般AccountはAPIで拒否される |
| P-S06 | 同一Account | LIFFとSSOを順に使う | 同じプロフィール、診断、相性データへ到達する |
| P-S07 | 2 Account・2タブ | Account Aを2タブで開き、一方をAccount BのLIFFへ切り替える | Aの両sessionが401になり、Bの画面だけを表示して前Accountのcacheと履歴を再利用しない |
| P-S08 | 外部ブラウザ | session発行後に再訪し、logoutして戻る | cookieでsessionを再利用し、logout後は旧画面を表示せず再認証を案内する |

## 5. 失敗・境界経路

| ID | 条件 | 期待結果 |
| --- | --- | --- |
| P-N01 | 未linkのSSO Identity | Accountを自動作成・推測せず拒否する |
| P-N02 | transaction期限切れ／callback再送 | sessionを発行せず安全なエラー画面へ戻す |
| P-N03 | IdPで拒否またはキャンセル | transactionをconsumeし、要求画面にキャンセル結果を表示する |
| P-N04 | LIFF初期化失敗 | SSOへ自動fallbackせず、再試行か外部ブラウザ利用を案内する |
| P-N05 | CSRF token欠落・不一致 | mutationを拒否し、既存sessionとデータを変更しない |
| P-N06 | logout後の戻る操作 | 認証済み画面やcacheを再表示せず、再認証を要求する |
| P-N07 | Account復旧完了、Identity解除、Account停止後の旧session | KVの削除反映を待たず旧sessionを拒否し、前Accountの内容を返さない |
| P-N08 | SSO設定／transaction store欠落 | SSO endpointだけが503になり、LIFF交換は継続する |

## 6. 運用ログの確認

Cloudflare Logsでは、対象時間帯と次の固定eventだけで集計します。

- `sso.authentication.started`: `purpose`、`rolloutMode`、`traceId`を持つ
- `sso.callback.completed`: 同じ`traceId`でcallback成功を確認できる
- `sso.callback.cancelled`: 利用者キャンセルを失敗率から分離できる
- `sso.callback.failed`: `errorCode`と工程で失敗件数を集計できる
- application session基盤の発行・失効event: SSO callback後のsession結果を同じ`traceId`で確認できる
- application session境界の障害ログは[境界検証Runbook §6](application-session-boundary-verification.md#6-kvd1障害時)の固定分類と照合する

ログ、スクリーンショット、PR、チケットにはOAuth `state`、認可code、token、Cookie、Auth0 subject、Account ID、メールアドレス、招待secret、個人内容を残しません。trace ID、時刻、deploy commit、シナリオID、HTTP status、固定event／error codeだけを証跡に使います。

## 7. SSOだけの緊急停止

1. Preview APIとWebの`SSO_ROLLOUT_MODE`を`disabled`へ変更し、同じ値で再deployする。
2. `/api/auth/sso/login`とIdentity追加が503になり、新しいAuth0遷移が始まらないことを確認する。
3. LIFF実端末で認証交換、本人画面の表示、mutationを確認する。
4. 既存application sessionが一律失効していないことを確認する。
5. `sso.authentication.started`が停止操作後に増えていないことを確認する。

Auth0 tenant全体の停止、LIFF channel設定変更、全sessionの一括失効は、この切り戻しに含めません。

## 8. 証跡と完了判定

証跡は次の形式で、個人識別子を含まない検証用チケットへ記録します。

```text
deploy: <commit SHA>
scenario: P-S01
time: <UTC timestamp>
result: pass | fail
client: LIFF | external-browser | automated-probe
traceId: <application-generated trace ID or none>
event/status: <fixed event name or HTTP status>
note: <固定分類だけ。画面内容やprovider応答は記載しない>
```

成功経路と失敗経路がすべてpassし、ログの禁止情報が0件で、`disabled`への切り戻し後もLIFFが利用できた場合だけPreview検証を完了とします。不合格の行があれば`linked-login`へ戻さず、修正commitと再検証結果を同じシナリオIDで追加します。
