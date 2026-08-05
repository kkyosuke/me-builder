# 診断API契約

## 1. この文書の目的

この文書は、Web UIとAPI Serverの間で利用する診断APIのパス、認証、リクエスト、レスポンス、エラー契約を所有します。

Question、Diagnosis、DiagnosisResponseの状態と不変条件は[Phase 1 診断ドメイン設計](../diagnosis/diagnosis-domain-design.md)、一覧画面の表示と遷移は[Phase 1 診断体験設計](../diagnosis/diagnosis-experience.md)、D1への写像は[`packages/lib`のschema](../../packages/lib/src/d1/schema/diagnosis.ts)を正とします。この文書はドメイン規則、画面デザイン、D1スキーマを所有しません。

## 2. 認証境界

診断APIはクライアント指定のAccount IDを受け付けません。LIFF IDトークンをAuthorizationヘッダーで受け取り、API ServerがLINEへ検証した`sub`からAccountを解決します。

```http
Authorization: Bearer <LIFF ID token>
```

サーバー発行セッションが導入されるまでは、各リクエストでIDトークンを検証します。これは継続リクエスト用セッションを確定するまでの境界であり、URL、レスポンス、ログへIDトークンやAccount IDを出しません。

## 3. 診断一覧

### `GET /api/diagnoses`

本人が閲覧できるDiagnosisと現在の回答進捗を一覧用の要約として返します。質問文とChoiceは含めず、診断詳細APIで取得します。

一覧へ含めるのは、削除されていない`published`のDiagnosisのうち、サーバー時刻が受付開始時点以降のものです。受付終了後のDiagnosisは回答内容への導線を維持するため一覧へ含め、`availability`を`closed`にします。公開前、公開停止、削除済みのDiagnosisは含めません。

```json
{
  "diagnoses": [
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

同じ公開時点の場合にもレスポンス順が変動しないよう、公開時点の降順、Diagnosis IDの昇順で返します。

## 4. 診断詳細

### `GET /api/diagnoses/{diagnosisId}`

新しく回答を開始するため、指定したDiagnosisの質問とChoiceを公開時のQuestion Versionで返します。認証境界は一覧APIと同じです。

Diagnosisが`published`かつ削除されておらず、サーバー時刻が受付開始以降・受付終了より前の場合だけ取得できます。存在しない、公開前、公開停止、削除済みは公開状態を外部へ漏らさないため同じ`404 diagnosis_not_found`として扱います。受付終了後は、回答済みであってもこのAPIから新しい回答を開始させず、`409 diagnosis_closed`を返します。受付終了後の本人の回答閲覧は、後続の回答内容APIが所有します。

質問はDiagnosis内の`position`、ChoiceはQuestion Version内の`position`の昇順で返します。削除済みのDiagnosis Question、Question Version、Choiceは含めません。Question VersionはDiagnosis Questionが参照している版を返し、現在の最新版へ暗黙に置き換えません。

```json
{
  "id": "relationship-priority",
  "title": "自分と相手の優先・境界線",
  "description": "頼まれごとや意思決定で、自分と相手をどう尊重するかを見ます。",
  "opensAt": "2026-08-04T00:00:00.000Z",
  "closesAt": null,
  "questions": [
    {
      "diagnosisQuestionId": "dq-relationship-priority-01",
      "questionId": "q-relationship-priority-01",
      "questionVersion": 1,
      "text": "相手から頼まれても、自分に余裕がなければ断りたい。",
      "hint": null,
      "choices": [
        { "choiceId": "no", "label": "いいえ" },
        { "choiceId": "yes", "label": "はい" }
      ]
    }
  ]
}
```

詳細API固有のエラーは次のとおりです。

| HTTP | 条件 | レスポンス |
| --- | --- | --- |
| `404` | Diagnosisが存在しない、公開前、公開停止、または削除済み | `{ "error": "Diagnosis not found", "reason": "diagnosis_not_found" }` |
| `409` | Diagnosisが受付終了済み | `{ "error": "Diagnosis closed", "reason": "diagnosis_closed" }` |

認証・基盤の共通エラーは次節に従います。

## 5. 診断回答保存

### `PUT /api/diagnoses/{diagnosisId}/answers/{diagnosisQuestionId}`

本人が受付中のDiagnosisに含まれる1問へ初めて回答し、Answerと対応するSource Recordを保存します。リクエストではChoice IDだけを受け取り、Account、Question ID、Question Version、回答時点はサーバーが確定します。

```json
{ "choiceId": "yes" }
```

初回回答時にAccountとDiagnosisの組み合わせに対応するDiagnosisResponseを作成します。DiagnosisResponse、本人入力のSource Record、Answerは1つのD1トランザクション境界で保存し、部分的に残しません。成功時はSource Record ID、DiagnosisResponse ID、Account IDを公開せず、保存した回答と最新進捗を返します。

```json
{
  "outcome": "created",
  "answer": {
    "diagnosisQuestionId": "dq-relationship-priority-01",
    "questionId": "q-relationship-priority-01",
    "questionVersion": 1,
    "choiceId": "yes",
    "acceptedAt": "2026-08-05T00:00:00.000Z"
  },
  "progress": {
    "responseStatus": "in-progress",
    "answeredCount": 1,
    "questionCount": 10
  }
}
```

このパスはDiagnosis Questionをリソースとする冪等な`PUT`です。同じ本人が同じDiagnosis QuestionとChoice IDを通信再送・二重タップ・並行リクエストで繰り返した場合、2件目以降は新しいAnswer、Source Record、DiagnosisResponseを作らず、`outcome`を`unchanged`として既存Answerと現在の進捗を`200`で返します。`acceptedAt`も初回受付時点から変えません。Idempotency Keyは要求しません。

異なるChoice IDが既に保存されている場合、このAPIでは上書きせず`409 answer_change_requires_revision`を返します。回答修正はSource Recordの改訂を伴う別機能として扱い、このAPIの範囲には含めません。

回答保存固有のエラーは次のとおりです。

| HTTP | 条件 | レスポンス |
| --- | --- | --- |
| `400` | JSONでない、または`choiceId`がない・空 | `{ "error": "Invalid request" }` |
| `404` | Diagnosisが存在しない、公開前、公開停止、または削除済み | `{ "error": "Diagnosis not found", "reason": "diagnosis_not_found" }` |
| `409` | Diagnosisが受付終了済み | `{ "error": "Diagnosis closed", "reason": "diagnosis_closed" }` |
| `409` | 同じ質問へ異なるChoice IDを保存済み | `{ "error": "Answer already exists", "reason": "answer_change_requires_revision" }` |
| `422` | Diagnosis QuestionがDiagnosisにない | `{ "error": "Invalid answer", "reason": "diagnosis_question_not_found" }` |
| `422` | Choice IDがDiagnosis固定のQuestion Versionにない | `{ "error": "Invalid answer", "reason": "choice_not_found" }` |

認証・基盤の共通エラーは次節に従います。

## 6. 回答内容取得

### `GET /api/diagnoses/{diagnosisId}/answers`

本人が保存した現在有効な回答を、回答時点のQuestion VersionとChoice、およびAPIが計算した傾向とともに返します。受付終了後も回答内容を確認できるよう、Diagnosisが公開済みで受付開始後なら`closesAt`を過ぎていても取得できます。

回答はDiagnosis Questionの`position`順で返します。質問文と選択肢ラベルはAnswerが保持するQuestion ID / Question Version / Choice IDから解決し、現在の最新版へ暗黙に置き換えません。採点はDiagnosisが参照するD1の版付き設定をAPIが検証して行い、Web UIは計算し直しません。Account ID、DiagnosisResponse ID、Source Record ID、採点設定本体は返しません。

```json
{
  "id": "relationship-priority",
  "title": "自分と相手の優先・境界線",
  "description": "頼まれごとや意思決定で、自分と相手をどう尊重するかを見ます。",
  "responseStatus": "answered",
  "answeredCount": 10,
  "questionCount": 10,
  "answers": [
    {
      "diagnosisQuestionId": "dq-relationship-priority-01",
      "questionId": "q-relationship-priority-01",
      "questionVersion": 1,
      "questionText": "相手から頼まれても、自分に余裕がなければ断りたい。",
      "choiceId": "yes",
      "choiceLabel": "はい",
      "acceptedAt": "2026-08-05T00:00:00.000Z"
    }
  ],
  "scoring": {
    "scoringVersion": 1,
    "balancedLabel": "状況に応じて調整",
    "parameters": [
      {
        "id": "priority-balance",
        "label": "自分／相手の優先",
        "lowLabel": "相手を優先しやすい",
        "highLabel": "自分の余裕を優先しやすい",
        "score": 75,
        "coverage": 100,
        "band": "high"
      }
    ]
  }
}
```

`scoring`は、採点設定版、中央帯の表示名、計算済みパラメータを一体で返します。採点設定をまだ持たない、または保存済み設定の検証に失敗したDiagnosisでは`null`とし、回答内容の閲覧は妨げません。設定の検証失敗はAPI Serverが採点設定IDとともにエラーログへ記録し、設定本体や回答内容はログへ出力しません。これによりDiagnosisの一覧・質問追加はWeb UIのリリースや診断ID対応表の更新を前提にしません。

回答内容取得固有のエラーは次のとおりです。

| HTTP | 条件 | レスポンス |
| --- | --- | --- |
| `404` | Diagnosisが存在しない、公開前、公開停止、削除済み、または本人の回答がない | `{ "error": "Diagnosis answers not found", "reason": "diagnosis_answers_not_found" }` |

回答途中でも保存済みの回答は返し、`responseStatus`と件数で未完了であることを表します。Web UIは回答済みから回答内容画面へ遷移しますが、再開機能でも同じ取得結果を利用できます。

## 7. 開発環境の回答データリセット

### `DELETE /api/dev/diagnosis-data`

開発時に同じAccountで回答フローを繰り返し確認できるよう、本人の診断回答データを物理削除します。`ENVIRONMENT` bindingに`development`、`local`、`preview`、`test`のいずれかが明示されている環境だけで利用できます。bindingの未設定・空文字・未知値・`production`では`404`を返して削除処理を実行しません。

削除対象は本人のDiagnosisResponse、Answer、「あとで回答」、Answerが作成したSource Recordとその改訂関係です。Diagnosis、Question、Choiceなどの診断定義、Account、他のAccountのデータ、診断回答以外のSource Recordは削除しません。クライアントからAccount IDは受け取らず、他の診断APIと同じ認証境界で本人を解決します。

対象の抽出と削除は1つのD1 atomic batchで実行します。回答保存もatomic batchであるため、同じAccountのバックグラウンド保存とリセットが競合しても両処理の途中状態は混在しません。保存が先ならその回答由来データまで削除し、リセットが先なら保存結果一式を残すことで、Answerだけ、またはSource Recordだけが孤立する状態を作りません。

```json
{
  "deletedResponseCount": 2,
  "deletedAnswerCount": 12,
  "deletedDeferredQuestionCount": 1,
  "deletedSourceRecordCount": 12
}
```

削除対象がない場合も各件数を`0`として`200`を返します。Web UIは環境変数に同じ開発環境が明示されている場合だけ確認付きの操作を表示し、未設定時は表示しません。成功後は診断一覧を再取得します。API側の環境制限を認可境界とし、UIの非表示だけには依存しません。

## 8. エラー

| HTTP | 条件 | レスポンス |
| --- | --- | --- |
| `401` | Bearerトークンがない、検証できない、または検証設定がない | `{ "error": "Unauthorized" }` |
| `404` | トークンは有効だが対応するAccountがない | `{ "error": "Account not found", "reason": "friendship_required" }` |
| `503` | D1 bindingがない | `{ "error": "Service Unavailable" }` |
| `500` | 未処理のサーバーエラー | `{ "error": "Internal Server Error" }` |

認証失敗の詳細、トークン、`sub`、Account IDはレスポンスへ含めません。

## 9. ローカルE2Eテスト

診断APIのE2Eテストは`apps/api/src/e2e/`に置きます。Miniflareが提供するローカルD1へ本番と同じmigrationと診断seedを適用し、Honoの`app.request`へD1 bindingとして渡します。

各テストの入力と期待出力は、`apps/api/src/e2e/case/`の`*.case.ts`へ`id`、`name`、`in`、`out`を持つオブジェクトとして記録します。caseファイルはテストの索引であり、APIの正式な契約はこの文書を正とします。

LINEのIDトークン検証エンドポイントだけは外部通信を行わず、検証成功・失敗のHTTP応答へ差し替えます。Honoのルーティング、Bearerヘッダーの解釈、Account解決、Drizzleのクエリ、D1上の回答進捗集計、JSONレスポンスはモックしません。

テストごとに独立したインメモリD1を作り、終了時にMiniflareを破棄します。開発者の`.wrangler/state`やpreview、productionのD1は使用しません。

単独で実行する場合は`bun --cwd apps/api test:e2e`を使います。通常の`task ci`にも含まれます。

OpenAPIとWeb UI用TypeScript型の共通運用は[API契約とクライアント型の生成](api-contract-generation.md)を参照します。
