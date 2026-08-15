# 成長・報酬実装設計

## 1. 目的と責務

この文書は、[成長・報酬体験の提案](../product/progression-reward-experience.md)を実装するための保存先、計算版、本人向けAPI、成長カード、ふたりレベルのシステム境界を所有します。利用者向けの意味、加点値、表示順、安全原則はプロダクト文書を正とし、この文書では変更しません。

## 2. うつし進行度の正本

うつし進行度の正本はAccountData SQLiteに置きます。Brain更新と同じtransactionで本文を含まないpending eventを作り、進行度読込時に確定eventへ一度だけ変換します。

- `progression_events`: origin、出来事種別、計算版、成長差分、かけら差分を保持する追記型の事実
- `progression_states`: Account単位の累積値、計算版、最高到達レベルを保持するcache
- `progression_item_states`: Item単位で加点済みのEvidence fingerprintを保持するcache
- `progression_pending_events`: Brain更新と進行度確定の間をつなぐoutbox

Evidence fingerprintは、本文payloadがある場合はそのcontent hash、ない場合はSource Record IDを使用します。同じcontent hashの再送は別edgeでも加点しません。意味的重複はBrain Item生成時の既存Item照合を先に通し、その判定と同じtransactionで`duplicate_evidence`の`+0` eventを確定して、初回集計を後から行っても加点対象へ戻しません。進行度処理が本文をモデルへ再送して追加判定することはしません。

pending eventの`created_at`を利用者向けの出来事発生時刻とし、進行度を後から読んだ時刻へ置き換えません。pending後にItemが削除・置換されていても、発生時点でactiveだった確定済みの歩みは維持します。発生時点ですでに無効、削除済み、期間外だったItemは加点しません。

Revisionは作成時に`correction`か`temporal`を確定します。診断の再回答による置換は`correction`、日記から時点の異なる状態を保存する置換は`temporal`とし、進行度読込時に由来を推測し直しません。

## 3. 計算版と再計算

確定eventとAccount集計は`calculation_version`を持ちます。現在版と集計版が異なる場合は、本文ではなく保存済みの出来事種別から成長差分を再計算します。

`highest_level`は過去の最高到達レベルを保持し、再計算後のレベルが下がる場合の表示下限にします。削除や式変更で最高到達レベルを下げません。共有D1の管理者一覧projectionにもAccountDataが返した計算版をそのまま写します。

## 4. 本人向けフィードバック

本人向け進行度APIは累積値に加え、本文やBrain Item IDを含まない最近の成長差分を返します。差分は`new_item`、`evidence_added`、`temporal_revision`だけを利用者向けの3種類へ写し、`+0`の再処理や訂正は成功として処理しても報酬表示しません。

診断結果は先に表示し、Brain反映が完了するまでは「反映中」とします。確定後は診断結果を隠さず、その下へ成長差分を静的に表示します。日記返信には差分を混ぜず、「わたしのまとめ」で後から確認します。

## 5. 成長カード

10レベルごとの到達をAccountDataで一度だけmaterializeします。カードへ保存するのは到達レベル、到達日時、前の節目から増えたかけら数、分類名だけです。statement、Evidence、Source Record IDは保存しません。

カードは本人向け進行度APIから取得し、「わたしのまとめ」で表示します。到達日時は閾値を越えた成長eventの発生時刻を使います。Brain Item削除後は、その分類を持つ非削除Itemが残っていない場合、保存済みカードの分類snapshotからも削除します。画像生成を必須にせず、Web上の静的カードとして保存可能にします。

## 6. ふたりレベル

ふたりレベルの正本はCompatibilityData SQLiteに置きます。利用者から見た管理単位は2つのAccountとRelationship Categoryの組み合わせです。物理的には成立中のrelationship IDのCompatibilityDataへ保存し、同じAccountペア・同じRelationship Categoryで再同意したときは、終了済みCompatibilityDataから内容を持たない累積値と最高到達レベルだけを新しいCompatibilityDataへ一度だけ移します。比較可能な診断テーマが初めて増えたとき、または比較結果のfingerprintが変わったときだけ、本文を含まないpair eventを一度だけ追加します。

共有終了中はAPIから進行度としるしを返しません。終了時に比較テーマのfingerprintと現在の比較テーマ数を削除し、累積値と最高到達レベルだけを内容を持たない集計として残します。再同意後の最初の相性シート読込では、現在の関係に進行度がまだなければAccountDataの同じ相手・同じRelationship Categoryの終了参照を1件だけ引き、集計を移してから現在の比較テーマを`+0`の基準として保存します。カテゴリ列追加前の終了参照だけは最新3件を上限にCompatibilityDataで照合します。この互換処理も初回だけで、通常読込では履歴を走査しません。招待発行・送信・承諾だけではeventを作りません。

## 7. 障害時と費用

- 進行度更新に失敗しても診断結果、日記返信、共有結果は成功させる
- AccountDataの未確定eventはalarmで再試行し、ふたり進行度は相性シートの次回読込で再試行する
- 一覧取得でAccount数分のDurable Objectを呼ばず、管理者一覧だけ共有D1 projectionを使う
- 本文を追加の報酬判定専用モデルへ送らず、既存のBrain・相性生成結果を利用する
- API失敗時も診断、記録、共有終了などの中核操作をレベルで制限しない
