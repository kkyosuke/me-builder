# 診断API契約

## 1. この文書の目的

この文書は、Web UIとAPI Serverの間で利用する診断APIのパス、認証、リクエスト、レスポンス、エラー契約を所有します。

Question、Diagnosis、DiagnosisResponseの状態と不変条件は[Phase 1 診断ドメイン設計](../diagnosis/diagnosis-domain-design.md)、一覧画面の表示と遷移は[Phase 1 診断体験設計](../diagnosis/diagnosis-experience.md)、公開定義の共有D1 schemaは[`packages/lib`のcatalog schema](../../packages/lib/src/d1/shared/schema/catalog.ts)、回答のAccountData schemaは[`packages/lib`のdiagnosis schema](../../packages/lib/src/do/account/schema/diagnosis.ts)を正とします。この文書はドメイン規則、画面デザイン、物理スキーマを所有しません。

## 2. 認証境界

診断APIはクライアント指定のAccount IDを受け付けません。`POST /api/auth/liff/exchange`で発行したHttpOnlyのアプリセッションCookieから、API ServerがAccountを解決します。

```http
Cookie: __Host-me_builder_session=<opaque session token>
```

LIFF IDトークンは交換時にだけ検証し、機能APIへは送信しません。変更系リクエストは同一Originと`X-CSRF-Token`も検証します。URL、レスポンス、ログへセッショントークン、CSRFトークン、IDトークン、Account IDを出しません。

## 3. 診断一覧

### `GET /api/diagnoses`

本人が閲覧できるDiagnosisと現在の回答進捗を一覧用の要約として返します。質問文とChoiceは含めず、診断詳細APIで取得します。

一覧へ含めるのは、削除されていない`published`のDiagnosisのうち、サーバー時刻が受付開始時点以降のものです。受付終了後のDiagnosisは回答内容への導線を維持するため一覧へ含め、`availability`を`closed`にします。`withdrawn`のDiagnosisは本人の`DiagnosisResponse`が存在する場合だけ同じ導線を維持して一覧へ含め、`availability`を`closed`にします。公開前、本人の`DiagnosisResponse`がない公開停止、削除済みのDiagnosisは含めません。

```json
{
  "diagnoses": [
    {
      "id": "relationship-priority",
      "title": "自分と相手の優先・境界線",
      "description": "頼まれごとや意思決定で、自分と相手をどう尊重するかを見ます。",
      "relationshipCategory": "general",
      "opensAt": "2026-08-04T00:00:00.000Z",
      "closesAt": null,
      "displayOrder": 10,
      "availability": "open",
      "responseStatus": "unanswered",
      "answeredCount": 0,
      "questionCount": 10,
      "lastAnsweredAt": null
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

`relationshipCategory`は[診断ドメイン設計](../diagnosis/diagnosis-domain-design.md#構成)でDiagnosisへ固定した分類です。`displayOrder`は運営が設定した一覧表示順で、小さい値を先に扱います。`lastAnsweredAt`は本人の現在有効なAnswerのうち最新の回答日時で、回答がなければ`null`です。一覧画面は[Phase 1 診断体験設計](../diagnosis/diagnosis-experience.md#3-画面と責務)に従って分類・並び替えるため、このAPIの配列順には依存しません。APIは表示順、Diagnosis IDの昇順で安定して返します。

## 4. 診断詳細

### `GET /api/diagnoses/{diagnosisId}`

指定したDiagnosisの質問とChoiceを公開時のQuestion Versionで返します。受付中は新しい回答の開始に使い、公開停止後は本人の保存済み回答の表示に必要な範囲で使います。認証境界は一覧APIと同じです。

Diagnosisが`published`かつ削除されておらず、サーバー時刻が受付開始以降・受付終了より前の場合に取得できます。加えて、`withdrawn`でも本人の`DiagnosisResponse`が存在する場合は、保存済み回答の表示に必要な固定済みQuestion Versionを取得できます。この取得可否は新規回答・延期の受付可否を変更しません。受理済み回答の修正はどの状態でも提供しません。

存在しない、公開前、本人の`DiagnosisResponse`がない公開停止、削除済みは公開状態を外部へ漏らさないため同じ`404 diagnosis_not_found`として扱います。受付終了後は、回答済みであってもこのAPIから新しい回答を開始させず、`409 diagnosis_closed`を返します。受付終了後の本人の回答閲覧は、後続の回答内容APIが所有します。

質問はDiagnosis内の`position`、ChoiceはQuestion Version内の`position`の昇順で返します。削除済みのDiagnosis Question、Question Version、Choiceは含めません。Question VersionはDiagnosis Questionが参照している版を返し、現在の最新版へ暗黙に置き換えません。`backsideOfDiagnosisQuestionId`は、表裏カードの裏面なら直前の表面のDiagnosis Question ID、それ以外は`null`です。表裏の不変条件は[診断回答形式の実装境界](diagnosis-format-remaining-tasks.md)を正とします。

```json
{
  "id": "relationship-priority",
  "title": "自分と相手の優先・境界線",
  "description": "頼まれごとや意思決定で、自分と相手をどう尊重するかを見ます。",
  "relationshipCategory": "general",
  "opensAt": "2026-08-04T00:00:00.000Z",
  "closesAt": null,
  "questions": [
    {
      "diagnosisQuestionId": "dq-relationship-priority-01",
      "questionId": "q-relationship-priority-01",
      "questionVersion": 1,
      "text": "相手から頼まれても、自分に余裕がなければ断りたい。",
      "hint": null,
      "backsideOfDiagnosisQuestionId": null,
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
| `404` | Diagnosisが存在しない、公開前、本人の`DiagnosisResponse`がない公開停止、または削除済み | `{ "error": "Diagnosis not found", "reason": "diagnosis_not_found" }` |
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

異なるChoice IDが既に保存されている場合、このAPIでは上書きせず`409 answer_is_immutable`を返します。受理済みの診断回答は訂正・個別削除できません。

回答保存固有のエラーは次のとおりです。

| HTTP | 条件 | レスポンス |
| --- | --- | --- |
| `400` | JSONでない、または`choiceId`がない・空 | `{ "error": "Invalid request" }` |
| `404` | Diagnosisが存在しない、公開前、公開停止、または削除済み | `{ "error": "Diagnosis not found", "reason": "diagnosis_not_found" }` |
| `409` | Diagnosisが受付終了済み | `{ "error": "Diagnosis closed", "reason": "diagnosis_closed" }` |
| `409` | 同じ質問へ異なるChoice IDを保存済み | `{ "error": "Answer already exists", "reason": "answer_is_immutable" }` |
| `422` | Diagnosis QuestionがDiagnosisにない | `{ "error": "Invalid answer", "reason": "diagnosis_question_not_found" }` |
| `422` | Choice IDがDiagnosis固定のQuestion Versionにない | `{ "error": "Invalid answer", "reason": "choice_not_found" }` |

認証・基盤の共通エラーは次節に従います。

## 6. 「あとで回答」の保存

### `PUT /api/diagnoses/{diagnosisId}/deferred-questions/{diagnosisQuestionId}`

本人が受付中のDiagnosisに含まれる未回答の1問を「あとで回答」として保存します。リクエストボディは受け取りません。初回操作時にDiagnosisResponseがなければ作成し、延期記録と同じD1トランザクション境界で保存します。延期はAnswerではないため、回答数と回答状態は変えません。

同じ質問への再送は新しい延期記録を作らず、初回の`deferredAt`を保ったまま`outcome: "unchanged"`を返します。保存後にその質問へ回答した場合は回答保存と同じ境界で延期記録を無効化します。

```json
{
  "outcome": "created",
  "deferredQuestion": {
    "diagnosisQuestionId": "dq-relationship-priority-01",
    "deferredAt": "2026-08-06T00:00:00.000Z"
  }
}
```

延期保存固有のエラーは次のとおりです。

| HTTP | 条件 | レスポンス |
| --- | --- | --- |
| `404` | Diagnosisが存在しない、公開前、公開停止、または削除済み | `{ "error": "Diagnosis not found", "reason": "diagnosis_not_found" }` |
| `409` | Diagnosisが受付終了済み | `{ "error": "Diagnosis closed", "reason": "diagnosis_closed" }` |
| `409` | 対象の質問へ回答済み | `{ "error": "Question already answered", "reason": "question_already_answered" }` |
| `422` | Diagnosis QuestionがDiagnosisにない | `{ "error": "Invalid deferred question", "reason": "diagnosis_question_not_found" }` |

認証・基盤の共通エラーは回答保存APIと同じです。

## 7. 回答内容取得

### `GET /api/diagnoses/{diagnosisId}/answers`

本人が保存した現在有効な回答を、回答時点のQuestion VersionとChoiceとともに返します。回答が完了している場合だけ、APIが計算した傾向も返します。本人の`DiagnosisResponse`と1件以上の保存済み回答があれば、受付終了後および`withdrawn`への公開停止後も取得できます。

回答はDiagnosis Questionの`position`順で返します。質問文と選択肢ラベルはAnswerが保持するQuestion ID / Question Version / Choice IDから解決し、現在の最新版へ暗黙に置き換えません。完了済み回答の採点はDiagnosisResponse開始時に固定したD1の版付き設定をAPIが検証して行い、Web UIは計算し直しません。回答途中では採点を実行せず`scoring: null`を返します。Account ID、DiagnosisResponse ID、Source Record ID、採点設定本体は返しません。

```json
{
  "id": "relationship-priority",
  "title": "自分と相手の優先・境界線",
  "description": "頼まれごとや意思決定で、自分と相手をどう尊重するかを見ます。",
  "relationshipCategory": "general",
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
| `404` | Diagnosisが存在しない、公開前、削除済み、または本人の`DiagnosisResponse`がない | `{ "error": "Diagnosis answers not found", "reason": "diagnosis_answers_not_found" }` |

回答途中でも保存済みの回答は返し、`responseStatus`と件数で未完了であることを表します。受付中のWeb UIは再開時の復元に利用し、受付終了後は閲覧専用画面に利用します。受付終了後の追加入力、回答再開、途中回答の結果生成は許可しません。

開発環境で本人の診断を含む個人コンテンツを初期化する操作は[開発用AccountデータリセットAPI契約](development-account-data-reset-api.md)を正とします。

## 8. エラー

| HTTP | 条件 | レスポンス |
| --- | --- | --- |
| `401` | アプリセッションCookieがない、無効、または期限切れ | `{ "error": "Unauthorized" }` |
| `403` | 変更系リクエストのOriginまたはCSRFトークンが不正 | `{ "error": "Forbidden" }` |
| `503` | D1またはセッションストアbindingがない | `{ "error": "Service Unavailable" }` |
| `500` | 未処理のサーバーエラー | `{ "error": "Internal Server Error" }` |

認証失敗の詳細、トークン、`sub`、Account IDはレスポンスへ含めません。

## 9. ローカルE2Eテスト

診断APIのE2Eテストは`apps/api/src/e2e/`に置きます。Miniflareが提供するローカルD1へ本番と同じmigrationと診断seedを適用し、Honoの`app.request`へD1 bindingとして渡します。

各テストの入力と期待出力は、`apps/api/src/e2e/case/`の`*.case.ts`へ`id`、`name`、`in`、`out`を持つオブジェクトとして記録します。caseファイルはテストの索引であり、APIの正式な契約はこの文書を正とします。

機能APIのE2Eではインメモリのセッションストアからアプリセッションを発行します。Honoのルーティング、Cookie・CSRFの解釈、Account解決、Drizzleのクエリ、D1上の回答進捗集計、JSONレスポンスはモックしません。

テストごとに独立したインメモリD1を作り、終了時にMiniflareを破棄します。開発者の`.wrangler/state`やpreview、productionのD1は使用しません。

単独で実行する場合は`bun --cwd apps/api test:e2e`を使います。通常の`task ci`にも含まれます。

OpenAPIとWeb UI用TypeScript型の共通運用は[API契約とクライアント型の生成](api-contract-generation.md)を参照します。
