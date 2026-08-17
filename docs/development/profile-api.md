# プロフィールAPI契約

## 1. この文書の目的

この文書は、Web UIが本人のプロフィールとうつしレベル進行度を取得し、アバター画像を保存・削除するHTTP API契約と保存境界のSSoTです。APIのパス、認証、入出力、画像検査、共有D1、AccountData、Private R2の更新境界と失敗時の扱いを所有します。

プロフィール画面とアバター変更の利用体験は[プロフィール設定体験設計](../product/profile-settings-experience.md)と[アバター設定体験設計](../product/avatar-experience.md)、Account所有データの配置は[Accountデータ分離設計](../architecture/account-data-isolation.md)、Cloudflareサービスの配置は[インフラ・システム構成](../architecture/infrastructure-architecture.md)を正とします。

この文書は、テーマ設定の保存、LINEプロフィール画像そのものの複製、人物判定、AI加工、画像編集UIを所有しません。

## 2. 結論

- 本人のプロフィール取得は`GET /api/profile`とし、Account IDをpath、query、bodyで受け取らない
- うつしレベル進行度は`GET /api/profile/progression`で取得し、AccountDataにある差分反映済みの累積値と現在有効なBrain Itemから集計する
- HttpOnlyのアプリセッションCookieを検証して解決したAccountだけを読み書きする
- 取得結果には表示名、role、現在表示するアバターを含める
- 相性画面など画像をJSONへ埋め込まない利用箇所向けに、`GET /api/profile/avatar`で本人の現在画像をバイナリ返却する
- 保存は`PUT /api/profile/avatar`、削除は`DELETE /api/profile/avatar`とする
- 保存・削除の応答も更新後のプロフィール全体を返し、直後の再取得を不要にする
- 画像本体は環境別のPrivate R2、現在画像のメタデータは共有D1のAccount運営情報へ保存する
- 日記、診断回答、Source、Brain、プロフィール要約はAccountDataに残し、アバターメタデータを複製しない
- アバターの更新間隔による拒否は行わず、`updatedAt`は現在画像の更新日時としてだけ扱う

`/api/accounts/:accountId/profile`は採用しません。本人専用操作へAccount IDを指定させると、認証結果ではなくクライアント入力を認可に使う実装を誘発するためです。`/api/profile`は常にアプリセッションで解決した本人を表します。

## 3. エンドポイント

| Method | Path | 用途 | 成功時 |
| --- | --- | --- | --- |
| `GET` | `/api/profile` | 本人の表示用プロフィールを取得 | `200`とプロフィール |
| `GET` | `/api/profile/progression` | 本人のうつしレベル進行度を取得 | `200`と進行度 |
| `GET` | `/api/profile/avatar` | 本人の現在のアバター画像を取得 | `200`と画像、画像がなければ`204` |
| `PUT` | `/api/profile/avatar` | 現在のアバターを画像bodyで置換 | `200`と更新後プロフィール |
| `DELETE` | `/api/profile/avatar` | 保存画像を外してLINE画像へ戻す | `200`と更新後プロフィール |

すべてのエンドポイントは`__Host-me_builder_session` Cookieを要求します。変更系リクエストは同一Originと`X-CSRF-Token`も要求します。Accountを解決できない場合の`401`、`404`は既存の認証済みAPIと同じ契約にします。

## 4. プロフィール応答

プロフィールは次の形で返します。

```json
{
  "role": "user",
  "displayName": "表示名",
  "avatar": {
    "source": "uploaded",
    "url": "data:image/webp;base64,...",
    "updatedAt": "2026-08-11T00:00:00.000Z"
  }
}
```

`avatar`の決定順は次のとおりです。

1. 共有D1のAccount運営情報が参照するPrivate R2の保存画像
2. IDトークン交換時に検証してアプリセッションへ保持したLINEプロフィール画像
3. `null`

LINE画像の場合は`source`を`line`、`url`をLINEのHTTPS URL、`updatedAt`を`null`にします。保存画像はPrivate R2から読み出した内容をData URLとして同じJSONへ含めます。最大512×512pxのプロフィール画像に限定することで、Web UIがプロフィールJSONの後に認証付き画像APIを追加で呼ばずに表示できます。

共有D1に保存画像のメタデータがある一方、参照先のR2 objectが存在しない、またはobjectのbyte size、etag、Content-Typeがメタデータと一致しない場合は、保存画像がないものとして2以降へ縮退します。これによりプロフィール取得全体を成功させ、本人がWeb UIから画像を再設定または削除できます。

応答は本人の画像を含むため`Cache-Control: no-store`とします。Account ID、R2 object key、etag、元ファイル名は返しません。

### 4.1 画像バイナリ応答

`GET /api/profile/avatar`は、アプリセッションから解決した本人について、保存画像、セッションへ保持した検証済みLINE画像の順に解決します。画像があれば`Content-Type`を付けた画像bodyを`200`で返し、どちらも利用できなければbodyなしの`204`を返します。Private R2の不整合やLINE画像の取得失敗はプロフィール画面全体の失敗にせず、次の候補または`204`へ縮退します。

Web UIはこのAPIをcredential付き`fetch`で取得し、取得したBlobのObject URLを表示に使います。セッショントークンやIDトークンをquery parameterや画像URLへ含めません。応答には`Cache-Control: no-store`と`X-Content-Type-Options: nosniff`を付けます。

### 4.2 うつしレベル進行度応答

`GET /api/profile/progression`は、認証で解決した本人のAccountDataから次の表示専用集計を返します。成長値、レベル式、加点条件の意味は[成長・報酬体験の提案](../product/progression-reward-experience.md)を正とします。

```json
{
  "level": 2,
  "growthValue": 8,
  "currentLevelThreshold": 5,
  "nextLevelThreshold": 20,
  "collectedPieces": 2,
  "activePieces": 2,
  "categoryCount": 2
}
```

成長イベントはBrain更新と同じAccountDataのbatchで未処理差分へ追加し、進行度取得時は未処理差分だけを重複排除して累積値へ反映します。反映済みの全イベントを取得のたびに再走査しません。Brain ItemやEvidenceの削除後も`growthValue`と`collectedPieces`を減らしません。`activePieces`と`categoryCount`は取得時点で利用可能なBrain Itemから集計します。既存Accountは初回取得時に現在利用可能なデータから開始値を確定します。データがない場合も`Lv.1`として成功応答を返します。

応答にBrain Itemのstatement、Evidence、分類名、Account IDは含めません。本人のprivate SQLiteが失敗した場合に架空の進行度へ縮退せず、`500`を返します。

## 5. アバター保存入力

`PUT /api/profile/avatar`はJSONやmultipartではなく画像本体をrequest bodyとして受け取ります。`Content-Type`は次のいずれかです。

- `image/jpeg`
- `image/png`
- `image/webp`

サーバーは次を検査します。

- bodyが空でなく2 MiB以下
- `Content-Type`と実データの形式が一致する
- 画像全体の構造が正しく、headerから寸法を取得できる
- 幅と高さが同じ
- 幅と高さが1px以上512px以下

Web UIによる縮小・切り抜きは通信量と操作体験のための一次処理です。サーバー検査の代わりにはしません。SVG、拡張子だけが画像のファイル、上限を超える画像、正方形でない画像は保存しません。

## 6. 保存モデル

```mermaid
flowchart LR
    W[Web UI] -->|session cookie + image body| API[API Server]
    API -->|session verify<br/>avatar metadata| D1[(Shared D1<br/>Account operation)]
    API -->|未処理差分の反映・累積値取得| AD[(AccountData<br/>progression state)]
    API -->|image bytes| R2[(Private R2)]
    API -->|profile / progression JSON| W
    API -->|sessionで認可したimage response| W
```

R2 object keyは認証で解決したAccount IDとアップロードごとの一意なIDから決定します。同じ画像を再送してもkeyを再利用しないため、並行した置換・削除の後処理が新しい現在画像を削除しません。別Accountとobjectを共有しません。

共有D1の`account_profiles`は現在画像のobject key、content type、byte size、etag、更新日時を持ちます。更新日時は表示・監査用の現在値であり、次回変更可能日時ではありません。R2は画像bytesとHTTP metadataだけを持ち、どの画像が現在値かを決めません。

## 7. 更新順序と回復

保存は次の順序で行います。

1. 認証
2. 画像検査
3. 新しいobjectをPrivate R2へ保存
4. 共有D1の現在画像メタデータを置換
5. 以前のobjectが別keyなら削除
6. 入力済みbytesから更新後プロフィールを返却

共有D1更新に失敗した場合は、D1を再読込して新しいobjectが現在値でないことを確認してからR2 objectを削除し、失敗を返します。D1を再確認できない場合は参照中の可能性があるobjectを削除せず、本文やobject keyを含めないerrorログを残します。以前のobject削除だけが失敗した場合は現在画像の更新を成功として返し、同じ安全なerrorログを残します。孤立objectの定期清掃はこのAPIの提供範囲に含めません。

削除は共有D1の現在画像を先に外し、以前のR2 objectを削除します。R2削除に失敗しても、削除済みのプロフィールへ戻し、同じ安全なerrorログを残します。

GETで保存画像の不整合を検出した場合、共有D1のメタデータはその場で削除しません。GETと並行するPUTが設定した新しい現在値を誤って外さないためです。不整合の種類を本人識別子やobject keyを含めないerrorログへ記録し、応答はLINE画像または`null`へ縮退します。残したメタデータは、本人による次のPUTで置換され、DELETEで現在値から外れます。

## 8. エラー契約

| Status | 意味 |
| --- | --- |
| `400` | bodyが空 |
| `401` | アプリセッションCookieがない、無効、または期限切れ |
| `403` | OriginまたはCSRFトークンが不正 |
| `404` | 対応するAccountがない |
| `413` | 画像が2 MiBを超える |
| `415` | 対応外形式、または`Content-Type`と実データが一致しない |
| `422` | 寸法を取得できない、正方形でない、または512pxを超える |
| `503` | 共有D1またはPrivate R2のbindingが設定されていない |
| `500` | 縮退できない保存先エラーまたは未処理エラー |

認証失敗時にAccountやobjectの存在を開示しません。保存画像のメタデータとR2 objectの欠落・不一致は`200`のプロフィール応答へ縮退し、不整合の詳細をクライアントへ開示しません。

## 9. 利用プラン表示

`GET /api/profile/entitlement`はアプリセッションで解決した本人について、現在Plan、契約状態、付与元、適用開始、利用可能期限、AI返信とまとめ生成の上限・利用量・予約量・残量・次回更新日時を返します。`Cache-Control: no-store`とし、Account ID、支払者Account ID、Stripeの識別子を応答へ含めません。値の解決規則とAPI / Workerの実行境界は[課金・Plan紐付け実装設計](../architecture/billing-implementation-design.md#33-機能境界への接続)を正とします。

## 10. プライバシーと運用ログ

- 画像bytes、Data URL、元ファイル名、Account ID、LINE user ID、R2 object keyをログへ出さない
- R2 bucketは公開せず、API Server bindingからだけ読み書きする
- 画像を人物判定、属性推定、AI加工、Brain Item生成へ利用しない
- Content-Type、byte size、検査結果、最終outcomeなど、原因特定に必要な非識別情報だけを構造化ログへ残す

## 11. 完了条件

- Account IDをクライアント指定せず、認証済みの本人だけを読み書きできる
- GET 1回で表示名、role、現在のアバターを取得できる
- Brainがない本人にも`Lv.1`を返し、診断の有無に依存せず進行度を表示できる
- 同じBrain上の出来事を再読込しても重複加算せず、削除後も累積成長値を下げない
- PNG、JPEG、WebPの正方形画像をPrivate R2へ保存できる
- 現在画像のメタデータを共有D1へ保存できる
- 保存・削除の応答だけで更新後表示へ切り替えられる
- 本人の画像をAccount ID、セッショントークン、IDトークンをURLへ含めずバイナリ取得できる
- 不正形式、形式偽装、過大画像、非正方形画像を拒否できる
- 別AccountのプロフィールやR2 objectを取得・更新できない
- OpenAPIとWeb UI用の生成型へ契約が反映される
- 本人がプロフィール画面でPlan、契約状態、更新日、AI上限と残量を確認できる
