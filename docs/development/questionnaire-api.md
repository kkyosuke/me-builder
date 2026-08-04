# アンケートAPI契約

## 1. この文書の目的

この文書は、Web UIとAPI Serverの間で利用するアンケートAPIのパス、認証、リクエスト、レスポンス、エラー契約を所有します。

Question、Survey、SurveyResponseの状態と不変条件は[Phase 1 アンケートドメイン設計](../questionnaire/questionnaire-domain-design.md)、一覧画面の表示と遷移は[Phase 1 アンケート体験設計](../questionnaire/questionnaire-experience.md)、D1への写像は[`packages/lib`のschema](../../packages/lib/src/d1/schema/questionnaire.ts)を正とします。この文書はドメイン規則、画面デザイン、D1スキーマを所有しません。

## 2. 認証境界

アンケートAPIはクライアント指定のAccount IDを受け付けません。LIFF IDトークンをAuthorizationヘッダーで受け取り、API ServerがLINEへ検証した`sub`からAccountを解決します。

```http
Authorization: Bearer <LIFF ID token>
```

サーバー発行セッションが導入されるまでは、各リクエストでIDトークンを検証します。これは継続リクエスト用セッションを確定するまでの境界であり、URL、レスポンス、ログへIDトークンやAccount IDを出しません。

## 3. アンケート一覧

### `GET /api/surveys`

本人が閲覧できるSurveyと現在の回答進捗を一覧用の要約として返します。質問文とChoiceは含めず、アンケート詳細APIで取得します。

一覧へ含めるのは、削除されていない`published`のSurveyのうち、サーバー時刻が受付開始時点以降のものです。受付終了後のSurveyは回答内容への導線を維持するため一覧へ含め、`availability`を`closed`にします。公開前、公開停止、削除済みのSurveyは含めません。

```json
{
  "surveys": [
    {
      "id": "relationship-priority",
      "title": "自分と相手の優先・境界線",
      "description": "頼まれごとや意思決定で、自分と相手をどう尊重するかを見ます。",
      "opensAt": "2026-08-04T00:00:00.000Z",
      "closesAt": null,
      "availability": "open",
      "responseStatus": "unanswered",
      "answeredCount": 0,
      "questionCount": 10
    }
  ]
}
```

`responseStatus`は現在有効なAnswer数から導出し、「あとで回答」は回答数へ含めません。

| 値 | 条件 |
| --- | --- |
| `unanswered` | `answeredCount`が0 |
| `in-progress` | 1件以上かつ`questionCount`未満 |
| `answered` | `answeredCount`と`questionCount`が一致 |

同じ公開時点の場合にもレスポンス順が変動しないよう、公開時点の降順、Survey IDの昇順で返します。

## 4. アンケート詳細

### `GET /api/surveys/{surveyId}`

新しく回答を開始するため、指定したSurveyの質問とChoiceを公開時のQuestion Versionで返します。認証境界は一覧APIと同じです。

Surveyが`published`かつ削除されておらず、サーバー時刻が受付開始以降・受付終了より前の場合だけ取得できます。存在しない、公開前、公開停止、削除済みは公開状態を外部へ漏らさないため同じ`404 survey_not_found`として扱います。受付終了後は、回答済みであってもこのAPIから新しい回答を開始させず、`409 survey_closed`を返します。受付終了後の本人の回答閲覧は、後続の回答内容APIが所有します。

質問はSurvey内の`position`、ChoiceはQuestion Version内の`position`の昇順で返します。削除済みのSurvey Question、Question Version、Choiceは含めません。Question VersionはSurvey Questionが参照している版を返し、現在の最新版へ暗黙に置き換えません。

```json
{
  "id": "relationship-priority",
  "title": "自分と相手の優先・境界線",
  "description": "頼まれごとや意思決定で、自分と相手をどう尊重するかを見ます。",
  "opensAt": "2026-08-04T00:00:00.000Z",
  "closesAt": null,
  "questions": [
    {
      "surveyQuestionId": "sq-relationship-priority-01",
      "questionId": "q-relationship-priority-01",
      "questionVersion": 1,
      "text": "相手から頼まれても、自分に余裕がなければ断りたい。",
      "hint": null,
      "choices": [
        { "choiceId": "no", "label": "いいえ", "presentation": { "icon": "circle-x" } },
        { "choiceId": "yes", "label": "はい", "presentation": { "icon": "circle-check" } }
      ]
    }
  ]
}
```

詳細API固有のエラーは次のとおりです。

| HTTP | 条件 | レスポンス |
| --- | --- | --- |
| `404` | Surveyが存在しない、公開前、公開停止、または削除済み | `{ "error": "Survey not found", "reason": "survey_not_found" }` |
| `409` | Surveyが受付終了済み | `{ "error": "Survey closed", "reason": "survey_closed" }` |

認証・基盤の共通エラーは次節に従います。

## 5. エラー

| HTTP | 条件 | レスポンス |
| --- | --- | --- |
| `401` | Bearerトークンがない、検証できない、または検証設定がない | `{ "error": "Unauthorized" }` |
| `404` | トークンは有効だが対応するAccountがない | `{ "error": "Account not found", "reason": "friendship_required" }` |
| `503` | D1 bindingがない | `{ "error": "Service Unavailable" }` |
| `500` | 未処理のサーバーエラー | `{ "error": "Internal Server Error" }` |

認証失敗の詳細、トークン、`sub`、Account IDはレスポンスへ含めません。

## 6. ローカルE2Eテスト

アンケートAPIのE2Eテストは`apps/api/src/e2e/`に置きます。Miniflareが提供するローカルD1へ本番と同じmigrationとアンケートseedを適用し、Honoの`app.request`へD1 bindingとして渡します。

各テストの入力と期待出力は、テストと同じ場所にある[`survey-list.case.yaml`](../../apps/api/src/e2e/survey-list.case.yaml)と[`survey-detail.case.yaml`](../../apps/api/src/e2e/survey-detail.case.yaml)へ`id`、`in`、`out`の形で記録します。caseファイルはテストの索引であり、APIの正式な契約はこの文書を正とします。

LINEのIDトークン検証エンドポイントだけは外部通信を行わず、検証成功・失敗のHTTP応答へ差し替えます。Honoのルーティング、Bearerヘッダーの解釈、Account解決、Drizzleのクエリ、D1上の回答進捗集計、JSONレスポンスはモックしません。

テストごとに独立したインメモリD1を作り、終了時にMiniflareを破棄します。開発者の`.wrangler/state`やpreview、productionのD1は使用しません。

単独で実行する場合は`bun --cwd apps/api test:e2e`を使います。通常の`task ci`にも含まれます。

OpenAPIとWeb UI用TypeScript型の共通運用は[API契約とクライアント型の生成](api-contract-generation.md)を参照します。
