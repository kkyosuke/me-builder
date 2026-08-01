# Brain内部情報の分類

## 1. 目的

Brainが保持する情報を、Memoryだけにまとめず、その役割に応じて分類します。この分類はドメイン上の意味を整理するものであり、テーブルや保存形式を決定するものではありません。

## 2. 推奨する分類

Brainの内部情報を、次の12種類に分けます。

| 分類 | 答える問い | 代表例 |
| --- | --- | --- |
| Identity | 自分は誰か | 役割、所属、自己認識、人生のテーマ |
| Memory | 何があった・何を覚えているか | 出来事、経験、過去の選択、習得した事実 |
| Knowledge / Belief | 何を知り、何が正しいと思うか | 知識、信念、仮説、世界観、因果関係の理解 |
| Value / Motivation | 何を大切にし、なぜ行動するか | 誠実さ、自由、安定、成長、承認、好奇心 |
| Preference | 何を好む・避けるか | 好き嫌い、快適な働き方、苦手な表現 |
| Goal | 何を実現したいか | 目標、意図、計画、約束、期限 |
| Decision System | どのように選ぶか | 判断基準、制約、優先度、トレードオフ、意思決定ルール |
| Capability | 何ができるか | スキル、知識、経験レベル、利用可能な手段 |
| Behavior Pattern | どのように行動する傾向があるか | 習慣、着手方法、継続方法、ストレス時の反応 |
| Relationship Style | 人とどのように関係を築くか | 距離感、信頼、対立、支援の求め方、境界線 |
| Expression Style | どのように話し、書き、伝えるか | 口調、語彙、文章構成、句読点、ユーモア |
| Current State | 今どういう状態か | 気分、体力、関心、現在地、直近の状況 |

人間関係については現時点で独立した型を増やしません。たとえば、パートナーとの出来事はMemory、関係で大切にすることはValue、相手への約束はGoal、越えてほしくない線はDecision System内のConstraintとして分類できます。

## 3. 各分類の詳細

### Identity

比較的長期にわたる自己像です。

- 名前やプロフィール
- 職業、家族内の役割、所属
- 自認している性格
- 「自分はこういう人でありたい」という自己物語

外部プロフィールとして公開できるIdentityと、本人だけが持つ自己認識は、同じ公開範囲にしません。

### Memory

過去に起きたことや、本人が覚えている内容です。

- Episodic Memory: いつ、どこで、誰と、何が起きたか
- Semantic Memory: 自分や周囲に関する事実
- Decision Record: 何を選び、なぜ選び、結果がどうだったか

過去のDecision RecordはMemoryです。今後の選び方を定めるDecision Policyとは分離します。

### Knowledge / Belief

本人が知っていることと、真実・妥当・可能性が高いと考えている内容です。

- 「少人数のチームの方が意思決定が速い」
- 「率直な対話は長期的な信頼につながる」
- 「この施策は顧客の離脱を減らすはずだ」

確認可能なKnowledgeと、本人の解釈を含むBeliefは区別できるようにします。Beliefは事実とは限らないため、確信度、根拠、反証、最終確認時点が重要です。

### Value / Motivation

本人が大切にする抽象的な原則と、行動する理由です。

- 誠実さ
- 自由
- 安定
- 成長
- 家族
- 社会への貢献
- 好奇心を満たしたい
- 誰かの役に立ちたい

Value / Motivationは複数用途で共有されやすい一方、仕事や恋愛などの利用場面によって優先順位が異なる場合があります。

### Preference

Valueより具体的な好みや回避傾向です。

- テキストで考えを整理したい
- 大人数より少人数を好む
- 辛い食べ物が苦手
- 突然の予定変更を避けたい

Preferenceには強さ、適用条件、例外を持たせます。一度の選択だけで恒久的なPreferenceにしません。

### Goal

未来に向けた意図です。

- 長期目標
- 短期目標
- 現在の計画
- 他者との約束
- やらないと決めたこと

Goalには状態、期限、優先度、対象領域を持たせます。達成・中止したGoalは、必要に応じてMemoryへ結果を残します。

### Decision System

状況と選択肢から、本人らしい選択を組み立てる仕組みです。

| 要素 | 役割 | 例 |
| --- | --- | --- |
| Criterion | 選択肢を評価する軸 | 収入、成長、安心、家族との時間 |
| Constraint | 選択肢を除外する絶対条件 | 違法なことはしない、転居はしない |
| Priority | 基準やGoalの優先順位 | 今は収入より学習機会を優先する |
| Trade-off | 何と何をどこまで交換できるか | 給与が少し下がってもリモート勤務を選ぶ |
| Risk Attitude | 不確実性への姿勢 | 生活に影響する判断は慎重にする |
| Time Horizon | どの時間軸を重視するか | 短期利益より3年後の成長を重視する |
| Heuristic | 素早く選ぶための経験則 | 迷ったら小さく試せる方を選ぶ |
| Decision Policy | 上記を組み合わせた選択ルール | 転職先を評価する手順と優先順位 |

### 判断基準と意思決定の違い

判断基準は「何を評価するか」です。意思決定は、複数の判断基準に制約、優先度、利用場面、Current Stateを加えて、最終的な選択へ変換するプロセスです。

例:

```text
判断基準:
- 成長機会
- 収入
- 働く場所の自由

意思決定Policy:
1. フルリモート不可なら候補から外す
2. 必要最低収入を満たすか確認する
3. 残った候補は成長機会を最優先する
4. 差が小さければ、小さく試せる方を選ぶ
```

この構造により、「収入を重視する」という1つの基準だけで、本人の意思決定全体を説明してしまうことを防げます。

### Capability

本人が現在できること、知っていること、利用できる手段です。

- 技術や資格
- 実務経験
- 得意・不得意
- 利用できる時間、道具、支援者

Capabilityは自己評価と確認済み実績を区別します。「できること」と「好んで行うこと」も分離します。

### Behavior Pattern

繰り返し現れる行動パターンです。

- 期限が近づくと集中して取り組む
- 最初に小さな試作品を作る
- 緊張すると情報を集めすぎる
- 朝に集中しやすい

本人の明示的な方針と、観察から推定したパターンを区別します。感情の引き金や回復方法など、比較的安定した感情パターンもここで扱います。

### Relationship Style

人との距離の取り方や、関係を築くときの傾向です。

- 信頼を築くまでに必要な時間
- 親密さと一人の時間のバランス
- 意見が対立したときの向き合い方
- 支援を求める・提供する方法
- 相手に越えてほしくない境界線
- 感謝や好意の示し方

特定の相手との出来事そのものはMemory、関係で大切にする原則はValue、対人場面で繰り返す傾向はRelationship Styleとして分けます。

### Expression Style

本人らしい話し方、書き方、伝え方です。分身が自然に応答するために重要ですが、発言内容や判断基準とは分離します。

- 話し言葉の丁寧さ、テンポ、相づち
- よく使う語彙、言い回し、口癖、方言
- 一文の長さ、改行、句読点、絵文字
- 結論から話すか、背景から話すか
- 箇条書き、具体例、比喩の使い方
- ユーモア、感情表現、断定の強さ
- 質問の返し方や会話を続ける方法
- 仕事相手、友人、家族など相手に応じた表現の違い

単語の出現回数だけで本人らしさを決めず、本人が確認した例文と避けたい表現も扱えるようにします。

### Current State

現在または短期間だけ有効な状態です。

- 今日の気分や体調
- 今週の忙しさ
- 現在検討しているテーマ
- 一時的な場所や同行者

Current Stateには有効期限を設け、期限切れの状態を恒久的なPreferenceやIdentityとして扱いません。

## 4. 分類とは別に持つ共通属性

すべてのBrain Itemは、種類とは別に次の情報を持つ必要があります。

| 共通属性 | 目的 |
| --- | --- |
| Access Policy | Access Label、機微度、外部提供可否などを使って利用範囲を制御する |
| Sensitivity | 機微度を表す |
| Evidence | 導出の根拠になったSource Recordを示す。1件以上を必ず持つ |
| Derivation | その導出がAIによる推定か、決定的な変換かを示す |
| Confidence | 確信度や推定の強さを示す |
| Confirmation | 本人が確認・却下したかを示す |
| Valid Time | いつの時点で有効だったかを示す |
| Stability | 一時的、変化しやすい、安定的を区別する |
| Revision | 修正や撤回の履歴を追えるようにする |
| Topic Label | 検索・整理に使う。アクセス制御には使わない |

AIが推定したValue / Motivationと本人が明言したValue / Motivationでは、同じ分類でも信頼性が異なります。分類だけでなく、Evidence、Derivation、Confidence、本人の確認状態を評価します。具体的な推定・確認モデルは後続で設計します。

### EvidenceとDerivationに分けた理由

以前は由来を`Source`という1つの共通属性で表し、「本人入力」「インポート」「AI推定」を同じ値の候補としていました。これは2つの軸を混ぜています。「本人入力」「インポート」はデータがどこから来たかであり、「AI推定」はそのデータから何をどう導いたかです。取り込み元を限定しない[Source domain](domain-design.md#5-source-domain)を置いたため、次のように分けます。

| 以前の値 | 実際に表していたこと | 新しい置き場所 |
| --- | --- | --- |
| 本人入力 | 入力の由来 | Source Recordのkind |
| インポート | 入力の由来 | Source Recordのkind |
| AI推定 | 導出のやり方 | Brain ItemのDerivation |

### Evidence

すべてのBrain Itemは、1件以上のSource Recordを根拠として持ちます。Source RecordとBrain Itemの多重度、由来の必須性、本人の操作がSource Recordを生むかどうかは[ドメイン設計 §6](domain-design.md#6-ドメイン間の関係)をSSoTとします。根拠を表現するエッジの種類と属性は[根拠・反証・改訂のエッジ設計](evidence-edge-design.md)をSSoTとします。

### Derivation

Derivationは1つのBrain Itemにつき1つの値を持ちます。

| 値 | 意味 | 例 |
| --- | --- | --- |
| `ai` | 事前に何が導かれるか決まっていない解釈 | 日記の本文からValue / Motivationを推定する |
| `deterministic` | 何を導出したいか逆算して設計された、決定的な変換 | アンケートの選択肢からPreferenceを作る、乗車履歴を集計する |

`deterministic`は、設計時に「ロジック」と呼んでいたものと同じ意味です。アンケートは何を導出したいかを逆算して質問と選択肢を設計するため決定的な変換になり、日記などの自由記述は事前に何が出るか分からないため`ai`になります。

- Derivationは入力の種類ではなく、導出ごとに付きます。同じ乗車履歴から「平日朝7時台の乗車が多い」（集計なので`deterministic`）と「朝型である」（解釈なので`ai`）の両方が導出されえます
- 根拠が混在し、`ai`の導出が1件でも混ざる場合、そのBrain ItemのDerivationは`ai`とします。[Brainのラベル・アクセス制御設計 §9](brain-access-label-design.md#9-不変条件)の「拒否ルールは許可ルールより優先する」と同じく、安全側へ固定します
- 導出方法の値そのものは根拠のエッジが持ち、Brain ItemのDerivationはそこからの集計値です。集計の規則と、事後の裏付けを集計に含めない理由は[根拠・反証・改訂のエッジ設計 §4](evidence-edge-design.md#4-エッジの属性)をSSoTとします

### Revision

Revisionは改訂のエッジで表します。改訂で置き換えられた旧版を保持するか、検索の対象に含めるか、どのAccess Policyで開示するかは[根拠・反証・改訂のエッジ設計 §7](evidence-edge-design.md#7-改訂された旧版の扱い)をSSoTとします。Source Recordの削除・撤回がBrain Itemへ及ぼす影響は[Source Recordのライフサイクル設計](source-record-lifecycle-design.md)で扱います。

## 5. Access Labelとの関係

Brain Itemの分類とAccess Labelは別の軸です。入力時の入口を分けず、外部利用時にAccess Profileで絞り込みます。

- Value / Motivationだから全用途へ公開する、とは限らない
- `Memory`だからPrivateに限定する、とは限らない
- 同じDecision Criterionでも、WorkとRelationshipで優先度が異なる場合がある
- Current Stateは特定用途だけに影響させる場合がある

各Brain ItemにAccess LabelとAccess Policyを適用し、MCP接続先のAccess Profileと組み合わせて利用可否を判断します。Topic Labelはこの判定に使用しません。

例:

| Brain Item | 分類 | Access Label |
| --- | --- | --- |
| 誠実さを大切にする | Value / Motivation | Work、Relationship、Private |
| 給与より成長機会を優先する | Decision Criterion | Work |
| パートナーとの約束 | Goal | Relationship |
| 家族との出来事 | Memory | Private |
| 今週は疲れている | Current State | Private、必要な場合だけWork |

## 6. 意思決定の組み立て方

Brainが判断を求められたときは、次の順序で情報を使います。

1. MCP接続とAccess Profileから利用可能なBrain Itemだけを選ぶ
2. Situationと選択肢を明確にする
3. Constraintに違反する選択肢を除外する
4. 有効なGoalとCommitmentを確認する
5. Criterion、Priority、Trade-offで選択肢を比較する
6. Knowledge / BeliefとMemoryを根拠として結果を補強する
7. Current Stateによる一時的な影響を分けて示す
8. 選択、理由、根拠、不確実性を返す

生成した結論を自動的に恒久的なDecision Policyへ追加しません。本人が選択した結果はDecision RecordとしてMemoryへ残し、既存Policyの見直し材料にできます。

## 7. 矛盾と優先順位

人は矛盾したValue / MotivationやPreferenceを持ちます。上書きして1つに統合せず、利用場面、時点、確信度、根拠とともに保持します。

意思決定時の基本的な優先順は次のとおりです。

1. 安全・法令・本人が設定した禁止事項
2. 利用場面固有のConstraint
3. 明示的なCommitment
4. 現在有効なGoal
5. Criterionの優先度とTrade-off
6. Preference
7. Heuristic

この優先順自体も将来は本人ごとのDecision Policyとして表現できます。

## 8. MVPで扱う分類

最初から12種類すべてを高度に実装せず、MVPでは次に絞ります。

- Memory
- Value / Motivation
- Preference
- Goal
- Decision Criterion
- Constraint
- Expression Style
- Current State

Identityは基本プロフィール、Capabilityはプロフィール上のスキル、Behavior PatternとRelationship Styleは本人が確認したAI推定として簡易的に扱います。複雑なTrade-offやDecision Policyの自動生成は、十分な根拠情報が集まった後に追加します。

## 9. 今後決めること

1. Brain Itemの分類をユーザーへどこまで見せるか
2. 1つのBrain Itemに複数分類を許すか、主分類を1つにするか
3. Value / MotivationやDecision Criterionの利用場面別優先度をどう表現するか
4. Current Stateの有効期限を誰が決めるか
5. 矛盾したBrain Itemを統合せず提示するUI
6. Decision Policyを本人が直接編集できるようにするか
7. AI推定をどの時点でBrain Itemとして有効化するか
