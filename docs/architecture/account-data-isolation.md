# Accountデータ分離設計

## 1. 目的

この文書は、Accountごとに独立したSQLite-backed Durable ObjectへAccount所有データを保存し、Account間の読み取りと関連付けの混在を構造的に防ぐ共通規則を定義します。

この文書が所有するもの:

- Account所有データを識別する規則
- ユーザー起点query、background処理、管理者集計のAccount境界
- Account Data Durable Objectと共有D1の責務境界
- Account Data schemaでAccount境界を強制する方法
- 既存の共有D1データをAccount Dataへ移すmigration規則

この文書が所有しないもの:

- Accountの本人確認とIdentity統合は[ドメイン設計](../domain/domain-design.md)を正とします
- Brain Itemの用途別開示は[Brainのラベル・アクセス制御設計](../domain/brain/brain-access-label-design.md)を正とします
- 管理者の認可方式と統計項目は[管理者向け統計ダッシュボード設計](admin-statistics-dashboard.md)を正とします

## 2. 前提

共有D1の1つのbindingをすべてのAccount所有データへ使う方式では、接続自体が現在のAccountを識別しません。SQLite / D1にはPostgreSQLのRLSに相当するrequest-scopedな行filterがないため、`WHERE account_id`の記述だけを認可の最終境界にしません。

Account所有データのSSoTは、`account_id`から決定的に選ぶ`AccountData` Durable Objectのprivate SQLiteです。1つのObjectには1 Accountのデータだけを保存し、API Server、Worker、MCP Serverへraw SQLite clientを公開しません。共有D1にはIdentity解決、全Account共通の公開定義、原文を含まない運用projectionだけを保存します。

```mermaid
flowchart LR
    C[Client] --> A[Server authentication]
    A -->|resolved account_id| R[AccountData namespace routing]
    R -->|one object per Account| O[(AccountData private SQLite)]
    O --> B[Brain / Source]
    O --> G[Diagnosis responses]
    O --> Y[Diary conversation]
    D[(Shared D1)] -->|public catalog snapshot| O
    C -. client supplied account_id .-> X[Rejected as authority]
```

## 3. データの区分

| 区分 | 例 | `account_id` | 参照規則 |
| --- | --- | --- | --- |
| 全Account共通 | Account Identity、Question、Diagnosis、Scoring Config | 共有D1 | 公開状態など各ドメインの条件で参照 |
| Account所有root | Source Record、Conversation Session、Diagnosis Response、Brain Item | AccountData SQLite | Objectに固定したAccountだけを保存 |
| Account所有descendant | payload、message、turn、answer、edge、revision、projection request | AccountData SQLite | 所有rootと同じObject内で参照 |
| 全体運用 | 管理者統計、配送先解決 | 共有D1 | 原文・Brain Item本文を保存しない |

AccountData SQLite内でも`account_id`を各所有行へ保存します。Objectの物理分離を第一境界とし、Object identity、各行の`account_id`、複合外部キーの3つを一致させます。これはmigration、backup、誤routingの検出にも使うsecurity invariantです。

## 4. 不変条件

### 4.1 読み取り

1. ユーザー起点処理は、認証結果から得た`account_id`でAccountData Objectを選びます。
2. クライアントがbody、query、pathで送ったAccount IDを認可に利用しません。
3. AccountData Objectは初回利用時にObject identityをAccountへ固定し、以後異なる`account_id`を含むRPCを拒否します。
4. API Server、Worker、MCP ServerへAccountDataのraw SQLite clientまたはAccount所有tableを公開しません。
5. Account所有データは、AccountData RPCのドメイン操作を通してだけ読み取ります。
6. 所有者が一致しない場合はnot-found相当へ寄せ、別AccountにIDが存在することを開示しません。

### 4.2 書き込み

1. Account所有rootは`account_id NOT NULL`とAccountData内のsingleton Accountへの外部キーを持ちます。
2. Account所有descendantは`account_id NOT NULL`を持ち、所有rootへ`(parent_id, account_id)`の複合外部キーを張ります。
3. 同じ行を複合外部キーから参照するrootには`UNIQUE(id, account_id)`を置きます。
4. 循環参照のため複合外部キーを表現できないConversation MessageとChat Turnの相互参照は、insert/update triggerで`account_id`一致を強制します。
5. AccountData repositoryはObjectへ固定した同じ`account_id`を、同一transactionで作るすべてのdescendantへ明示的に書き込みます。

### 4.3 全Accountを扱う処理

projection retryや期限切れSession終了は各AccountData Objectのalarmで処理します。共有D1からAccount所有行を全走査しません。

管理者統計は管理者認可後の集計専用経路に限定します。AccountDataから共有D1へ送る場合も非機密な集計projectionだけとし、原文やBrain Item本文を含めません。

## 5. 現在のAccount所有関係

```mermaid
erDiagram
    accounts ||--o{ account_identities : owns
    accounts ||--o{ source_records : owns
    source_records ||--o| source_record_text_payloads : owns
    source_records ||--o{ source_record_revisions : revises
    accounts ||--o{ conversation_sessions : owns
    conversation_sessions ||--o{ conversation_messages : contains
    conversation_sessions ||--o{ chat_turns : processes
    accounts ||--o{ diagnosis_responses : owns
    diagnosis_responses ||--o{ diagnosis_answers : contains
    diagnosis_responses ||--o{ diagnosis_deferred_questions : defers
    diagnosis_responses ||--o{ diagnosis_brain_projection_requests : projects
    accounts ||--o{ brain_items : owns
    brain_items ||--o{ brain_item_evidence_edges : supports
    brain_items ||--o{ brain_item_revisions : revises
    brain_items ||--o{ brain_item_access_labels : permits
    brain_items ||--o{ brain_item_topic_labels : classifies
    accounts ||--o{ diagnosis_brain_projection_heads : owns
```

関係tableが2つのAccount所有rootを結ぶ場合、両方の複合外部キーが同じ`account_id`列を使います。これにより、Source RecordとBrain Item、Diagnosis ResponseとSource Recordなどを別Account間で結べません。

## 6. Storageとmodule境界

AccountDataは1つのprivate SQLiteを使い、物理databaseをBrain、Diagnosis、Diaryごとに分割しません。Sourceを根拠としてBrain Itemを作る処理、Diagnosis回答からSourceとprojection requestを作る処理、Diary MessageからSourceを参照する処理を同じtransaction境界に置くためです。

実装は次のmoduleへ分け、単一のAccountData RPC facadeから公開します。

```text
account-data/
├── brain.ts
├── diagnosis.ts
├── diary.ts
├── repository.ts
└── schema
```

Conversation Coordinatorは連投調停、generation lease、配送outboxだけを所有し、本文やBrain ItemのSSoTにしません。Geminiなど外部APIの待機中にAccountData Objectを占有せず、読み取りと永続化を短いRPCへ分けます。

## 7. Migration規則

共有D1の既存Account所有tableをAccountDataへ移すときは、次の順序を守ります。

1. 既存の親子関係から`account_id`を比較し、既に混在していればmigrationを失敗させる
2. Accountごとに同じAccountData Objectを決定し、rootとdescendantを同じObjectへcopyする
3. copy後に行数、ID集合、`account_id`、`PRAGMA foreign_key_check`を照合する
4. 読み取りをAccountDataへ切り替えてから、共有D1へのAccount所有データ書き込みを停止する
5. rollback期間後に共有D1のAccount所有tableを削除する
6. 異なるAccountを同じObjectへ渡すnegative testと、共有D1から原文を取得できないtestを追加する

不一致行を削除したり、片方の所有者へ自動的に寄せたりしてmigrationを成功させてはいけません。混在が見つかった場合は、データごとの正しい所有者を調査してからrepairします。

Conversation MessageまたはChat Turnを将来のmigrationでtable再作成する場合は、相互参照のAccount一致を検証するtriggerも同じmigration内で再作成します。Drizzle schemaだけではこの循環参照triggerを表現していないため、AccountData用の生成SQLから脱落していないことをnegative testで確認します。

新規環境では共有D1にAccount所有tableを作らず、AccountDataだけを利用します。既存環境の移行完了までは共有D1側の複合外部キーとtriggerを安全網として維持します。

## 8. 変更時チェックリスト

- [ ] 新しいtableが全Account共通かAccount所有かを決めたか
- [ ] Account所有tableを共有D1ではなくAccountData schemaへ追加したか
- [ ] AccountData Objectが認証済み`account_id`から選ばれているか
- [ ] Object identityと異なる`account_id`をRPCで拒否するか
- [ ] Account所有descendant自身にも`account_id`があるか
- [ ] Account所有table間の参照が`(id, account_id)`で固定されているか
- [ ] API・Worker・MCPがAccountDataのraw SQLite clientを取得できないか
- [ ] 全Account処理がAccountData RPCから分離され、原文を集約していないか
- [ ] migrationが既存の混在を検出し、copy後のID集合と外部キーを検証するか
- [ ] Conversation MessageまたはChat Turnを再作成した場合、Account境界triggerも再作成したか
- [ ] 別Accountを使うnegative testがあるか
