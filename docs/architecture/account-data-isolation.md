# Accountデータ分離設計

## 1. 目的

この文書は、Account運営情報を共有D1へ、日記や診断回答などの個人コンテンツをAccountごとのSQLite-backed Durable Objectへ保存し、Account間の読み取りと関連付けの混在を構造的に防ぐ共通規則を定義します。

この文書が所有するもの:

- Account運営情報と個人コンテンツを識別する規則
- ユーザー起点query、background処理、管理者集計のAccount境界
- Account Data Durable Objectと共有D1の責務境界
- Account Data schemaでAccount境界を強制する方法
- 新しいデータの保存先を決める判定規則

この文書が所有しないもの:

- Accountの本人確認とIdentity統合は[ドメイン設計](../domain/domain-design.md)を正とします
- Brain Itemの用途別開示は[Brainのラベル・アクセス制御設計](../domain/brain/brain-access-label-design.md)を正とします
- 管理者の認可方式、Account一覧の項目、統計項目は[管理者向けダッシュボード設計](admin-statistics-dashboard.md)を正とします

## 2. 前提

共有D1の1つのbindingをすべてのAccount所有データへ使う方式では、接続自体が現在のAccountを識別しません。SQLite / D1にはPostgreSQLのRLSに相当するrequest-scopedな行filterがないため、`WHERE account_id`の記述だけを認可の最終境界にしません。

日記、診断回答、Source、Brain、プロフィール要約など個人コンテンツのSSoTは、`account_id`から決定的に選ぶ`AccountData` Durable Objectのprivate SQLiteです。1つのObjectには1 Accountのデータだけを保存し、API Server、Worker、MCP Serverへraw SQLite clientを公開しません。共有D1にはAccount、Identity、role、status、アバターメタデータなどの運営情報、全Account共通の公開定義、原文を含まない運用projectionを保存します。

```mermaid
flowchart LR
    C[Client] --> A[Server authentication]
    A -->|resolved account_id| R[AccountData namespace routing]
    R -->|one object per Account| O[(AccountData private SQLite)]
    O --> B[Brain / Source]
    O --> G[Diagnosis responses]
    O --> Y[Diary conversation]
    A --> D[(Shared D1<br/>Account operation)]
    D -->|public catalog snapshot| O
    C -. client supplied account_id .-> X[Rejected as authority]
```

## 3. データの区分

| 区分 | 例 | 保存先 | 参照規則 |
| --- | --- | --- | --- |
| Account運営 | Account、Identity、role、status、アバターメタデータ | 共有D1 | 認証済み`account_id`と運営権限で参照 |
| 全Account共通 | Question、Diagnosis、Scoring Config | 共有D1 | 公開状態など各ドメインの条件で参照 |
| 個人コンテンツroot | Source Record、Conversation Session、Diagnosis Response、Brain Item、プロフィール要約 | AccountData SQLite | Objectに固定したAccountだけを保存 |
| Account所有descendant | payload、message、turn、answer、edge、revision、projection request | AccountData SQLite | 所有rootと同じObject内で参照 |
| 複数Account間の共有関係 | 相性招待、双方の同意 | 関係ごとの専用Durable Object | 片方のAccountDataへ正本を寄せない |
| 全体運用 | 管理者統計、Account成長projection、配送先解決 | 共有D1 | 原文・Brain Item本文を保存しない |

新しいデータの保存先は、次の順で判定します。

1. Accountの認証、利用状態、role、運営、表示設定に必要か。必要なら共有D1のAccount運営情報
2. 全Accountが同じ内容を読むか。読むなら共有D1の公開定義
3. 2つのAccountの合意そのものが正本か。そうなら関係ごとの専用Durable Object
4. 全Account横断で集計するか。するなら正本をAccountDataに残し、原文を含まない集計projectionだけを共有D1へ押し出す
5. いずれにも当てはまらない個人コンテンツはAccountData

アバターの現在値は本人向け表示ですが、画像本体ではなくAccountの表示設定を管理するメタデータなので1に該当します。画像bytesはPrivate R2へ置きます。Source Record、Brain Item、Diary、Diagnosis回答、プロフィール要約は個人の内容そのものなので5に該当します。

```mermaid
flowchart TD
    N[新しいデータ] --> Q1{Account運営・表示設定か}
    Q1 -->|Yes| SD[共有D1 / Account運営情報]
    Q1 -->|No| Q2{全Accountが同じ内容を読むか}
    Q2 -->|Yes| SC[共有D1 / 公開定義]
    Q2 -->|No| Q3{2 Accountの合意が正本か}
    Q3 -->|Yes| RD[関係ごとのDurable Object]
    Q3 -->|No| Q4{全Account横断で集計するか}
    Q4 -->|Yes| AP[AccountDataが正本<br/>集計projectionだけ共有D1]
    Q4 -->|No| AD[AccountData / 個人コンテンツ]
```

AccountData SQLiteでは、Object identityとAccount所有rootだけが`account_id`を持ちます。descendantの所有者はrootへの外部キーから一意に決まるため、同じ`account_id`を重複保存しません。Objectの物理分離を第一境界、Object identityとrootの`account_id`一致を誤routing検出の第二境界とします。この原則へ例外を作りません。

## 4. 不変条件

### 4.1 読み取り

1. 個人コンテンツを扱うユーザー起点処理は、認証結果から得た`account_id`でAccountData Objectを選びます。Account運営情報も同じ認証結果をD1 queryの条件に使います。
2. クライアントがbody、query、pathで送ったAccount IDを認可に利用しません。
3. AccountData Objectは初回利用時にObject identityをAccountへ固定し、以後異なる`account_id`を含むRPCを拒否します。
4. API Server、Worker、MCP ServerへAccountDataのraw SQLite clientまたはAccount所有tableを公開しません。
5. 個人コンテンツはAccountData RPC、Account運営情報は共有D1のdomain actionを通してだけ読み取ります。
6. 所有者が一致しない場合はnot-found相当へ寄せ、別AccountにIDが存在することを開示しません。

### 4.2 書き込み

1. 個人コンテンツrootは`account_id NOT NULL`と、Objectへ固定したidentityへの外部キーを持ちます。AccountDataは共有D1のAccount行や運営設定を複製せず、identityだけをFK先にします。
2. Account所有descendantは`account_id`を持たず、所有rootまたは同じaggregateの親へ通常の外部キーを張ります。
3. 2つのAccount所有rootを結ぶ関係も、同じAccountData Object内に片方のAccountしか存在しないため、両方のroot IDへの外部キーで混在を防ぎます。
4. Conversation MessageとChat Turnの循環参照は、両方を同じObject内に作成してから参照を復元します。
5. AccountData repositoryはdescendantへ所有者を重複転記せず、rootの所有者とObject identityだけを検証します。

### 4.3 全Accountを扱う処理

projection retryや期限切れSession終了は各AccountData Objectのalarmで処理します。共有D1からAccount所有行を全走査しません。

管理者統計とAccount一覧は管理者認可後の専用経路に限定します。AccountDataから共有D1へ送る場合も非機密な集計projectionだけとし、原文やBrain Item本文を含めません。

## 5. 現在のAccount所有関係

共有D1はAccount、ログイン手段、Accountの運営・表示設定を持ちます。

```mermaid
erDiagram
    accounts ||--o{ account_identities : owns
    accounts ||--o| account_profiles : configures
```

AccountData内のAccount所有rootは、共有D1のAccount行ではなく、Objectへ固定したidentityを親にします。

```mermaid
erDiagram
    account_data_identity ||--o{ source_records : owns
    source_records ||--o| source_record_text_payloads : owns
    source_records ||--o{ source_record_revisions : revises
    account_data_identity ||--o{ conversation_sessions : owns
    conversation_sessions ||--o{ conversation_messages : contains
    conversation_sessions ||--o{ chat_turns : processes
    conversation_sessions ||--o{ diary_brain_checkpoints : summarizes
    diary_brain_checkpoints ||--o{ diary_brain_checkpoint_items : produces
    account_data_identity ||--o{ diagnosis_responses : owns
    diagnosis_responses ||--o{ diagnosis_answers : contains
    diagnosis_responses ||--o{ diagnosis_deferred_questions : defers
    diagnosis_responses ||--o{ diagnosis_brain_projection_requests : projects
    account_data_identity ||--o{ brain_items : owns
    brain_items ||--o{ brain_item_evidence_edges : supports
    brain_items ||--o{ brain_item_revisions : revises
    brain_items ||--o{ brain_item_access_labels : permits
    brain_items ||--o{ brain_item_topic_labels : classifies
    account_data_identity ||--o{ diagnosis_brain_projection_heads : owns
    account_data_identity ||--o{ compatibility_references : lists
```

関係tableが2つのAccount所有rootを結ぶ場合も、両rootは同じAccountData Object内にしか存在しません。通常の外部キーでSource RecordとBrain Item、Diagnosis ResponseとSource Recordを結び、別ObjectのIDは参照先そのものが存在しないため関連付けられません。

## 6. Storageとmodule境界

AccountDataは1つのprivate SQLiteを使い、物理databaseをBrain、Diagnosis、Diaryごとに分割しません。Sourceを根拠としてBrain Itemを作る処理、Diagnosis回答からSourceとprojection requestを作る処理、Diary MessageからSourceを参照する処理を同じtransaction境界に置くためです。

実装は次のmoduleへ分け、単一のAccountData RPC facadeから公開します。

```text
account-data/
├── brain.ts
├── diagnosis.ts
├── diary.ts
├── profile-summary.ts
├── repository.ts
└── schema
```

共有ライブラリのschemaとactionも、保存先ごとに分けます。1つの名前空間へAccountData所有tableと共有D1所有tableが同居すると、参照した名前が保存先を示さなくなり、[データの区分](#3-データの区分)の判定が読めなくなります。

```text
packages/lib/src/
├── table/base.ts     # 保存先に依存しない共通column
├── d1/               # D1が保存するdatabase
│   └── shared/       # Account運営情報、公開定義、集計projection
└── do/               # Durable Objectが保存するdatabase
    └── account/      # 1 AccountのSource、Brain、Diary、Diagnosis回答
```

呼び出し側は`D1.shared.*`と`DO.account.*`で参照します。保存先とdatabaseが参照式に現れるため、どちらを触っているかがコード上で分かります。

```ts
D1.shared.action.account.resolveAccountByLineLogin(db, sub);
DO.account.action.diary.storeLineTextSource(db, input);
```

AccountDataのactionは、Durable Object SQLite用のdatabase型を引数に取ります。D1 client型へ変換して同じactionを両方の保存先から呼べる状態を作りません。同じ関数が両方から呼べる限り、保存先を間違えてもtypecheckで検出できないためです。

AccountDataは共有D1の公開定義をsnapshotとして保持しますが、同期は版の比較で必要なときだけ行います。RPCごとに公開定義を全件読み直しません。定義が増えるほど1回の操作コストが線形に増えるためです。

Conversation Coordinatorは連投調停、generation lease、配送outboxだけを所有し、本文やBrain ItemのSSoTにしません。Geminiなど外部APIの待機中にAccountData Objectを占有せず、読み取りと永続化を短いRPCへ分けます。

複数Account間の相性共有は、関係ごとの`CompatibilityData`を正本とし、各AccountDataには一覧用参照だけを置きます。具体的な境界と整合性は[相性共有データ実装設計](compatibility-data-design.md)を正とします。

## 7. 共有D1が保存するもの

共有D1は次の4種類だけを保存します。

| 種類 | 共有D1が保存する理由 |
| --- | --- |
| Account Identity | 認証が`account_id`を解決する処理そのものであり、AccountDataを選ぶより前に読む必要がある |
| Account運営・表示設定 | role、status、現在のアバターメタデータなど、サービス運営とAccount表示に必要な状態をAccountと一緒に管理するため |
| 全Account共通の公開定義 | 全Accountが同じ内容を読むため、AccountDataへ置くとAccount数だけ複製される |
| 原文を含まない集計projection | 全Account横断の集計にAccountDataの全走査を使わないため |

次を禁止します。

- 共有D1へ日記、診断回答、Source、Brain、プロフィール要約など個人コンテンツのtableを置く
- AccountDataへAccount Identityや運営設定（利用停止、role、退会、アバターメタデータ）を複製する。これらは共有D1が所有します
- Account所有descendantへ`account_id`を持たせる
- 公開定義のsnapshotを版の比較なしに同期する
- 1つの名前空間へ共有D1所有とAccountData所有のschema・actionを同居させる

Brain Itemのベクトル検索を追加する場合も、`WHERE`相当のmetadata filterだけをAccount境界にしません。認証済み`account_id`から決定的に選ぶ検索名前空間を境界とし、正本はAccountDataに残します。

次のtestで境界を維持します。

- 別Accountの`account_id`を同じObjectへ渡すと拒否される
- 共有D1から個人コンテンツの原文を取得できない
- 共有D1に個人コンテンツtableが存在しない

## 8. 変更時チェックリスト

- [ ] [データの区分](#3-データの区分)の判定順で保存先を決めたか
- [ ] Account運営情報は共有D1、個人コンテンツはAccountData schemaへ追加したか
- [ ] AccountDataへAccount Identityや運営設定を複製していないか
- [ ] 公開定義のsnapshotを版の比較で必要なときだけ同期しているか
- [ ] AccountData Objectが認証済み`account_id`から選ばれているか
- [ ] Object identityと異なる`account_id`をRPCで拒否するか
- [ ] descendantへ`account_id`を重複追加していないか
- [ ] Account所有table間の参照が同じObject内の外部キーで固定されているか
- [ ] API・Worker・MCPがAccountDataのraw SQLite clientを取得できないか
- [ ] 全Account処理がAccountData RPCから分離され、原文を集約していないか
- [ ] 別Accountを使うnegative testがあるか
