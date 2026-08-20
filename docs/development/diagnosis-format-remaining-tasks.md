# 診断回答形式の実装境界

## 1. 目的

この文書は、標準の2択診断を維持しながら、例外的に5段階尺度を使える実装境界を定義します。診断の集約は[Phase 1 診断ドメイン設計](../diagnosis/diagnosis-domain-design.md)、画面は[Phase 1 診断体験設計](../diagnosis/diagnosis-experience.md)、採点は[パラメータ採点設計](../diagnosis/scoring/parameter-scoring-design.md)を正とします。

## 2. 確定した回答形式

- 診断の標準は、単純なスワイプ体験を優先した2択`single_choice`とする
- 追加形式は5段階尺度`likert_5`だけとする。自由記述、複数選択、rankingは追加しない
- 1つのDiagnosis内では全Question Versionを同じ形式に固定し、2択と5段階を混在させない
- 既存Diagnosisの形式とQuestion Versionは変更しない
- 初期catalogには5段階診断を公開せず、必要な診断を別途作成・審査して公開する

5段階の表示順、意味、決定論的scoreは次で固定します。

| 表示 | score |
| --- | ---: |
| まったく当てはまらない | -1 |
| あまり当てはまらない | -0.5 |
| どちらともいえない | 0 |
| やや当てはまる | 0.5 |
| とても当てはまる | 1 |

AIは回答のChoice、表示文言、Question Versionとこのscoreを入力として受け取れますが、scoreを別の値へ読み替えません。AIが作る説明は回答原本ではなく推定です。

## 3. 回答と原本

- 1問で1つのChoiceを選んだ時だけ回答済みとする
- 「あとで回答」は未回答の進捗であり、恒久skipにはしない
- 1回答を1 Source Recordとし、Choice IDから回答時点のQuestion Version、表示文言、尺度値を再現できるようにする
- サーバーが初回回答を受理した後は、診断回答を個別に訂正・削除できない
- 同じChoiceの再送は冪等な`unchanged`、別Choiceの再送は`409 answer_is_immutable`とする
- Account削除では、他のAccountDataと同じ削除境界で診断回答も削除する
- 入力データ確認とJSON exportは開発環境だけの検証機能とし、診断回答はそこでもread-onlyとする

## 4. UIと失敗復帰

- 2択はタップ、左右スワイプ、左右キーで選択する
- 5段階は5つの選択肢を常時表示し、タップまたはkeyboard focusとEnterで選択する。スワイプへ割り当てない
- 選択はタップまたはスワイプ解放時に即時確定し、確認画面、undo、前問へ戻る操作を設けない
- 回答中、完了後とも保存済み回答へ戻って変更できない。「もう一度」も設けない
- 通信結果が未確定の間は同じChoiceだけを保持して再送する。未保存と確定した場合だけ未回答へ戻し、新しく選び直せる
- 端末に別Choiceを一時保存して切り替えたり、再送時にAIやclientがChoiceを置換したりしない

## 5. 採点と比較

- 採点は版付きscoring configを使い、5段階scoreは`-1..1`へ正規化済みの値として扱う
- 相性比較へ含められるのは、同じDiagnosis、同じQuestion Version、同じscoring configの回答だけとする
- 2択と5段階は同じDiagnosisに混在しないため、形式をまたいで同一設問として比較しない
- 未回答を0点として補完しない

## 6. 公開前の完了条件

- catalog読込時に形式、Choice件数、5段階の固定文言・順序、Diagnosis内の形式統一を検証する
- APIとWebが形式を明示的に受け渡し、未対応形式を拒否する
- 5段階のtap、keyboard、二重送信防止、同一Choice再送をtestする
- 公開するDiagnosisごとにQuestionとscoring configを審査する

この文書で回答形式に関する検討は完了しています。新しい5段階Diagnosisの質問内容と公開判断は、そのDiagnosisを追加するPRが所有します。
