# 成長・報酬実装設計

## 1. 目的と責務

この文書は、[成長・報酬体験の提案](../product/progression-reward-experience.md)を実装するための保存先、計算版、本人向けAPI、成長カード、ふたりレベルのシステム境界を所有します。利用者向けの意味、加点値、表示順、安全原則はプロダクト文書を正とし、この文書では変更しません。

## 2. うつし進行度の正本

うつし進行度の正本はAccountData SQLiteに置きます。Brain更新と同じtransactionで本文を含まないpending eventを作り、進行度読込時に確定eventへ一度だけ変換します。

- `progression_events`: origin、出来事種別、計算版、成長差分、かけら差分を保持する追記型の事実
- `progression_states`: Account単位の累積値、計算版、最高到達レベルを保持するcache
- `progression_item_states`: Item単位で加点済みのEvidence fingerprintを保持するcache
- `progression_pending_events`: Brain更新と進行度確定の間をつなぐoutbox

Evidence fingerprintは、本文payloadがある場合はそのcontent hash、ない場合はSource Record IDを使用します。同じcontent hashの再送は別edgeでも加点しません。意味的重複はBrain Item生成時の既存Item照合を先に通し、進行度処理が本文をモデルへ再送して追加判定することはしません。

Revisionは作成時に`correction`か`temporal`を確定します。診断の再回答による置換は`correction`、日記から時点の異なる状態を保存する置換は`temporal`とし、進行度読込時に由来を推測し直しません。

## 3. 計算版と再計算

確定eventとAccount集計は`calculation_version`を持ちます。現在版と集計版が異なる場合は、本文ではなく保存済みの出来事種別から成長差分を再計算します。

`highest_level`は過去の最高到達レベルを保持し、再計算後のレベルが下がる場合の表示下限にします。削除や式変更で最高到達レベルを下げません。共有D1の管理者一覧projectionにもAccountDataが返した計算版をそのまま写します。

## 4. 本人向けフィードバック

本人向け進行度APIは累積値に加え、本文やBrain Item IDを含まない最近の成長差分を返します。差分は`new_item`、`evidence_added`、`temporal_revision`だけを利用者向けの3種類へ写し、`+0`の再処理や訂正は成功として処理しても報酬表示しません。

診断結果は先に表示し、Brain反映が完了するまでは「反映中」とします。確定後は診断結果を隠さず、その下へ成長差分を静的に表示します。日記返信には差分を混ぜず、「わたしのまとめ」で後から確認します。

## 5. 成長カード

10レベルごとの到達をAccountDataで一度だけmaterializeします。カードへ保存するのは到達レベル、到達日時、前の節目から増えたかけら数、分類名だけです。statement、Evidence、Source Record IDは保存しません。

初回導入や未確定eventの一括反映で複数の節目を同時に越えた場合は、未保存の10レベルごとのカードをすべて同じ到達日時でmaterializeします。観測できない過去の内訳を推測せず、現在のかけら累計と分類は最初の未保存カードへだけ記録し、同時に補完する後続カードの増分は0とします。

カードは本人向け進行度APIから取得し、「わたしのまとめ」で表示します。画像生成を必須にせず、Web上の静的カードとして保存可能にします。

## 6. ふたりレベル

ふたりレベルの正本はCompatibilityData SQLiteに置きます。利用者向けの管理単位は、成立済みの2つのAccountの組み合わせとRelationship Categoryです。共有中は現在のrelationship IDのCompatibilityDataが、比較済みテーマのfingerprintと内容を持たない累積値を管理します。比較可能な診断テーマが初めて増えたとき、または比較結果のfingerprintが変わったときだけ、累積値へ一度だけ反映します。

共有終了中はAPIから進行度としるしを返しません。終了時に比較テーマのfingerprintと現在の比較テーマ数を削除し、累積値と最高到達レベルだけを内容を持たない集計として終了済みCompatibilityDataへ残します。AccountDataの終了済み参照は画面へ返さず、同じ2つのAccountとRelationship Categoryで新しい関係が成立した後の内部検索だけに使います。

新しい関係の最初の進行度同期では、同じペア・同じRelationship Categoryの終了済みCompatibilityDataから累積値と最高到達レベルの最大値を復元します。削除済みfingerprintを保持し直して過去内容を推測可能にしないため、過去の累積値が1以上なら復元直後の現在テーマを一度だけ加点なしの比較済み基準として保存し、以後の新規テーマとfingerprint変化だけを加点します。過去の累積値が0なら比較済みテーマも存在しなかったことが確定するため、現在テーマは通常どおり新規加点します。復元処理が完了するまでは進行度だけを一時的に非表示とし、相性シート本体を失敗させません。招待発行・送信・承諾だけでは累積値を増やしません。

## 7. 障害時と費用

- 進行度更新に失敗しても診断結果、日記返信、共有結果は成功させる
- AccountDataとCompatibilityDataのalarmで未確定eventを再試行する
- 一覧取得でAccount数分のDurable Objectを呼ばず、管理者一覧だけ共有D1 projectionを使う
- 本文を追加の報酬判定専用モデルへ送らず、既存のBrain・相性生成結果を利用する
- API失敗時も診断、記録、共有終了などの中核操作をレベルで制限しない
