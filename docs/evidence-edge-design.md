# 根拠・反証・改訂のエッジ設計

## 1. この文書の目的

Source RecordとBrain Itemを結ぶエッジと、Source Record同士・Brain Item同士を結ぶエッジの種類、属性、外部への開示範囲を定義します。

[ドメイン設計 §6](domain-design.md#6-ドメイン間の関係)がSource RecordとBrain Itemの多重度と由来の必須性を確定したのに対し、この文書はその関係を実際に表現するエッジそのものを扱います。

所有する概念:

- 根拠、反証、改訂の3関係と、その両端・多重度・MVPでの扱い
- エッジが持つ属性と、Brain Itemの`Derivation`との役割分担
- エッジとConfidenceを外部へどこまで開示するか
- 改訂で置き換えられた旧版の保持と開示条件

所有しない概念:

| 概念 | SSoT |
| --- | --- |
| Source RecordとBrain Itemの多重度、由来の必須性、本人の操作とSource Recordの発生 | [ドメイン設計 §6](domain-design.md#6-ドメイン間の関係) |
| Source Recordの粒度とkind、Source domainの責務 | [ドメイン設計 §5](domain-design.md#5-source-domain) |
| Brain Itemの分類と共通属性（`Evidence`、`Derivation`、`Confidence`、`Revision`） | [Brain内部情報の分類](brain-content-taxonomy.md) |
| Access Label、Access Policy、Access Profile、不変条件 | [Brainのラベル・アクセス制御設計](brain-access-label-design.md) |

この文書では、Confidenceの具体的な算出方法、原本の不変性、永続化方式を決めません（[§8](#8-この文書で決めていないこと)）。

## 2. 全体像

```mermaid
flowchart LR
    subgraph S["Source domain"]
        SR1["Source Record v1"]
        SR2["Source Record v2"]
        SR3["別のSource Record"]
    end
    subgraph B["Brain domain"]
        BI1["Brain Item v1"]
        BI2["Brain Item v2"]
    end
    SR1 -->|改訂| SR2
    BI1 -->|改訂| BI2
    SR1 -->|根拠| BI1
    SR2 -->|根拠| BI2
    SR3 -->|反証| BI2
```

矢印は意味の向き（何が何を支え、何が何を置き換えるか）です。実装上どちら側がもう一方を指すかは[ドメイン設計 §6](domain-design.md#sourceの所有者と依存方向)の依存方向に従い、Brain Item → Source Recordの単方向です。

## 3. エッジの種類

**確定**: 根拠、反証、改訂の3関係を定義します。改訂はSource Record間とBrain Item間の2つの別関係に分かれるため、エッジ型としては4つになります。

| 関係 | 両端（意味の向き） | 多重度 | MVPでの扱い |
| --- | --- | --- | --- |
| 根拠 | Source Record → Brain Item | Brain Itemごとに1..N（必須） | 必須 |
| 反証 | Source Record → Brain Item | Brain Itemごとに0..N | 型は定義する。反証を検出するAIの実装は必須要件にしない |
| 改訂（Source Record間） | Source Record → Source Record | 0..N | 必須。MVPで先に必要なのはこちら |
| 改訂（Brain Item間） | Brain Item → Brain Item | 0..N | Brain Itemの導出を始めるPhase 2以降 |

根拠の多重度「1..N（必須）」は[ドメイン設計 §6](domain-design.md#source-recordとbrain-itemの対応)で確定済みのものです。

### 根拠を1つの関係へ統合する

**確定**: 「導出契機か否か」をエッジの属性として持たせ、導出元と事後の裏付けを1つの根拠関係へ統合します。導出元と事後の裏付けを別々の型には分けません。

根拠は包含関係です。導出元のSource Recordは必ず裏付けでもあります。別々の型に分けると、Confidenceを算出するたびに「導出元 ∪ 事後の裏付け」という集合演算を式の中へ常駐させることになります。統合しておけば、根拠エッジの集合をそのまま入力にできます。

導出契機かどうかは属性として残るため、統合しても「どのSource Recordから導出したか」は失われません。

### 反証を根拠と統合しない

**確定**: 反証は根拠とは別の関係にします。

根拠:

- 反証は再導出の入力になりません。根拠エッジの集合はBrain Itemを作り直せる入力ですが、反証はそうではありません
- 反証はBrain Itemを否定する側です。同じ関係へ入れると、符号を表す属性を追加しない限りConfidenceを算出できません
- [Brain内部情報の分類 §3](brain-content-taxonomy.md#3-各分類の詳細)のKnowledge / Beliefは「確信度、根拠、反証、最終確認時点が重要です」として、根拠と反証を並んだ別のものとして扱っています

### 改訂が2つの関係に分かれる

**確定**: 改訂はSource Record間とBrain Item間の2つの別関係とし、MVPで先に必要なのはSource Record間とします。

根拠:

- [プロジェクト概要 §9](project-overview.md#9-mvpの範囲)がMVPへ含める「回答履歴、修正、削除」は、Source Record側の話です
- [プロジェクト概要 §11](project-overview.md#11-段階的な進め方)より、Phase 1にはBrain Itemが存在しません。Brain Item間の改訂が必要になるのは、Brain Itemを導出するPhase 2以降です
- [ドメイン設計 §6](domain-design.md#sourceの所有者と依存方向)の依存方向はBrain → Sourceの単方向です。Source Record間の改訂をBrain Item側の関係として表すことはできません

Source Recordを訂正したときに旧版の原本をどう扱うかは、原本の不変性の問題として別に扱います（[§8](#8-この文書で決めていないこと)）。

### `conflicts_with`をMVPへ含めない

**確定**: Brain Item同士の矛盾を表す関係（`conflicts_with`）はMVPに含めません。

根拠:

- [Brain内部情報の分類 §9](brain-content-taxonomy.md#9-今後決めること)の5項目め「矛盾したBrain Itemを統合せず提示するUI」が、既に未決として先送りされています。提示方法が決まっていない関係を、先に型として置く必要がありません
- エッジは、両端のSource RecordとBrain Itemが揃っていれば後から張れます。後付けの費用が小さいため、MVPで急ぐ理由がありません

## 4. エッジの属性

**確定**: すべてのエッジが次の2つの属性を持ちます。

| 属性 | 内容 |
| --- | --- |
| 導出方法 | `ai` / `deterministic`。値域は[Brain内部情報の分類 §4](brain-content-taxonomy.md#4-分類とは別に持つ共通属性)の`Derivation`と同じ |
| 生成時点 | そのエッジが張られた時点 |

根拠のエッジは、これに加えて「導出契機か否か」を持ちます（[§3](#3-エッジの種類)）。

### 導出方法はエッジが持ち、Brain Itemの値は集計値とする

**確定**: 導出方法はエッジが持ちます。Brain Itemの`Derivation`は、そのBrain Itemに張られた根拠エッジからの集計値です。

[Brain内部情報の分類 §4](brain-content-taxonomy.md#4-分類とは別に持つ共通属性)で既に確定している「`ai`が1件でも混ざればBrain Itemの`Derivation`は`ai`」が、そのまま集計規則になります。集計の対象は、根拠エッジのうち導出契機であるものです。

同§4の「`Derivation`は1つのBrain Itemにつき1つの値を持つ」とは矛盾しません。Brain Itemのレベルで値が1つであることは変わらず、その値がエッジから導かれるだけです。

エッジごとに導出方法が必要なのは、事後の裏付けではBrain Itemの`Derivation`とエッジの導出方法が食い違うからです。

例: アンケートの回答から`deterministic`で作ったBrain Itemに対し、後からAIが日記を読んで根拠エッジを張る場合、Brain Itemの`Derivation`は`deterministic`のままですが、そのエッジの導出方法は`ai`です。事後の裏付けはBrain Itemを導いた処理ではないため、何によって導かれたかという事実を書き換えません。エッジ側に導出方法を持たせなければ、この裏付けがAIによるものだと示せなくなります。

### 採らなかった属性

| 候補 | 採らない理由 |
| --- | --- |
| 強度（寄与の強さ） | 文書上の根拠がありません。[Brain内部情報の分類 §3](brain-content-taxonomy.md#3-各分類の詳細)のPreferenceが持つ「強さ」はBrain Itemの属性であって、エッジの属性ではありません。加えて、AI由来のスカラーをエッジへ焼き込むと、「エッジがSSoTでConfidenceは派生値」という[§5](#5-confidenceとエッジの関係)の設計の論拠そのものを弱めます |
| 作成者（本人 / AI） | 本人はエッジを直接作りません。[ドメイン設計 §6](domain-design.md#本人の操作とsource-recordの発生)より、本人の操作が生むのはSource Recordか、Confirmationの更新だけです。値域は結局`ai` / `deterministic`になり、導出方法と重複します |

## 5. Confidenceとエッジの関係

**確定**: SSoTはエッジの集合です。Confidenceはそこから導かれる派生値であり、事前に計算してBrain Itemが保持します。外部へ開示した値は、監査のために記録します。

根拠:

- MCPのリクエスト時に全エッジを走査して算出すると、許可されていないラベルの反証を要求経路で読むことになります。[Brainのラベル・アクセス制御設計 §9](brain-access-label-design.md#9-不変条件)の「Access Profileで許可されていないラベルの情報を検索しない」と、同[§7](brain-access-label-design.md#7-mcp接続)末尾の「検索候補を作る時点で許可されていない情報を除外する」に抵触します
- 同[§9](brain-access-label-design.md#9-不変条件)の「ラベル変更後の外部アクセスを監査できる」と、同[§7](brain-access-label-design.md#7-mcp接続)の手順7「使用したBrain Itemと結果を監査ログへ記録する」を満たすには、開示した時点のConfidenceが後から再現できる必要があります。エッジは後から増えるため、値を記録しなければ再現できません

Confidenceの具体的な算出方法、閾値、提示のタイミングとUIはこの文書では決めません（[§8](#8-この文書で決めていないこと)）。

## 6. 外部への開示

**確定**: エッジそのものは外部のAccess Profileへ返しません。Confidenceだけを粗い3段階（高 / 中 / 低）で開示します。

| 対象 | 本人（Owner Profile） | 外部のAccess Profile |
| --- | --- | --- |
| エッジの中身（どのSource Recordか） | 開示する | 開示しない |
| 根拠N件 / 反証M件の内訳 | 開示する | 開示しない |
| Confidenceの履歴 | 開示する | 開示しない |
| Confidence | 詳細を開示する | 粗い3段階（高 / 中 / 低）で開示する |

**確定**: 開示の粒度はAccess Profileの設定項目にせず、「外部は常に粗く、Owner Profileは詳細」という固定の規則とします。

根拠: [Brainのラベル・アクセス制御設計 §5](brain-access-label-design.md#5-access-profile)のAccess Profileの設定項目に、開示の粒度はありません。「利用可能な機能」で表現できるのは機能の可否だけで、粒度は表現できません。固定の規則にすれば、新しい設定語彙を増やさずに済みます。

**確定**: `get_evidence`は反証を返しません。

根拠: [プロジェクト概要 §3.2](project-overview.md#32-mcpでエージェントへ提供する)の`get_evidence`の定義は「生成内容の根拠となった回答を確認する」であり、反証はその範囲外です。加えて[Brainのラベル・アクセス制御設計 §9](brain-access-label-design.md#9-不変条件)の「非公開情報の存在自体を許可されていない接続先へ示さない」により、反証の件数も、反証が欠落していることも示せません。

`get_evidence`は[プロジェクト概要 §9](project-overview.md#9-mvpの範囲)のMVPの範囲には入っておらず、[§3.2](project-overview.md#32-mcpでエージェントへ提供する)の初期のMCP機能候補です。根拠表示を活用するのは[§11](project-overview.md#11-段階的な進め方)のPhase 3です。

### 原則4と不変条件の衝突をどう解いたか

Confidenceを外部へ開示するかどうかは、2つの要求が衝突します。

| 要求 | 内容 | Confidenceの開示への向き |
| --- | --- | --- |
| [プロジェクト概要 §13](project-overview.md#13-現時点のプロダクト原則)の原則4 | 分身であることと、回答の根拠・不確かさを明示する | 開示を要求する |
| [Brainのラベル・アクセス制御設計 §9](brain-access-label-design.md#9-不変条件)の6項目め | 非公開情報の存在自体を、許可されていない接続先へ示さない | 開示に反対する |

- 開示しない場合の損失: 外部エージェントが分身の自己申告を確定した事実として扱います。[プロジェクト概要 §13](project-overview.md#13-現時点のプロダクト原則)の原則2「本人の回答とAIの推定を混同しない」も同時に破れます
- 開示する場合の損失: 同じ問い合わせを繰り返したときのConfidenceの低下から「見えない反証が増えた」と推測でき、非公開のSource Recordの存在が間接的に漏れます

**確定**: 原則4を優先します。開示を粗い3段階に丸めることで、段階の境界をまたがない変動は観測できなくなり、漏洩を減らせます。

代償: これは不変条件の6項目めを満たすものではありません。段階の境界をまたぐ変化は依然として観測できるため、**漏洩を許容できる水準まで下げるにとどまります**。どこに境界を置くかで漏れやすさが変わるため、3段階の閾値を決めるときにこの代償を再評価します。

## 7. 改訂された旧版の扱い

**確定**: 改訂で置き換えられた旧版は削除せずに保持し、検索の対象から外します。検索の対象は最新版だけとし、旧版は改訂エッジを辿って参照します。

根拠: 旧版を消すと「本人が主張を変えた」という履歴が失われます。[Brain内部情報の分類 §7](brain-content-taxonomy.md#7-矛盾と優先順位)は、矛盾する内容を「上書きして1つに統合せず、利用場面、時点、確信度、根拠とともに保持します」としています。

**確定**: 改訂の履歴を残すために、追加の仕組みは設けません。

- 「いつ改訂したか」は、改訂エッジの生成時点（[§4](#4-エッジの属性)）が表します
- 「本人が何と言って書き直したか」は、訂正が生むSource Record（[ドメイン設計 §6](domain-design.md#本人の操作とsource-recordの発生)）が表します

**確定**: 旧版の開示条件は、その版が属する改訂鎖上の全版のうち、最も厳しいAccess Policyとします。

根拠: [Brainのラベル・アクセス制御設計 §8](brain-access-label-design.md#8-派生情報の扱い)の「派生したBrain Itemは、元情報の最も厳しいAccess Policyを引き継ぐ」を、改訂鎖へ適用したものです。

「旧版自身のAccess Policyと最新版のAccess Policyの論理積」では不十分です。v1（公開）→ v2（非公開）→ v3（公開）と改訂した鎖でv1を判定すると、v1もv3も公開なのでv1が開示されます。v2で本人が非公開にしたという判断が、開示可否へ一切反映されません。v1とv2は同じ主題の版であるため、v1を出せばv2で隠したかった内容が推測できます。鎖の途中の版を飛ばさず、鎖全体で最も厳しいPolicyを見る必要があります。

外部へ提供済みの旧版をラベル変更後にどう扱うかは、[Brainのラベル・アクセス制御設計 §11](brain-access-label-design.md#11-今後決めること)の6項目め「ラベル変更後のキャッシュと外部提供済みデータの扱い」で扱います。

## 8. この文書で決めていないこと

- Confidenceの具体的な算出方法、閾値、提示のタイミングとUI
- 反証を検出する処理の入出力と、反証エッジを張る主体
- 原本の不変性と、原本の訂正・削除が派生したBrain Itemへ及ぼす影響。[§3](#3-エッジの種類)のSource Record間の改訂関係が直結しますが、波及の規則はこの文書では扱いません
- 外部連携時のAccess Label既定値の詳細と、Source Connectorの具体的なモデル
- エッジの永続化方式（テーブル定義、インデックス）
