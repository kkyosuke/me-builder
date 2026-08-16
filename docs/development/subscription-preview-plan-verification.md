# Subscription Plan機能のPreview検証

## 1. 目的

決済連携の状態と機能側の判定を分離し、`AccountPlanAssignment`を入力としてLite、Full、Family、Freeの体験を検証します。この検証ではStripe Customer、Subscription、Price、Webhookを作成しません。

## 2. 自動検証

次のコマンドは外部サービスへ接続せず、Previewへ反映する前にも実行できます。

```bash
task subscription:verify:preview
```

検証対象は次のとおりです。

| 利用者の操作 | 判定 |
| --- | --- |
| Lite、Full、Familyへ切り替える | Plan、付与元、AI返信上限、まとめ生成上限が料金プランのSSoTと一致する |
| 適用開始前、利用期限到達後、downgrade後に開く | Freeへ戻り、以前に保存した本人データは閲覧できる |
| 本人データを訂正・削除・エクスポートする | Planや決済情報なしで本人のAccountDataだけを操作する |
| Familyへ参加・退出する | 参加中だけFull相当となり、支払者から参加者の個人内容を取得できない |
| AI返信上限へ到達後に危機を伝える | 利用枠を消費する生成を行わず、安全案内を返す |

## 3. Preview画面での確認

1. 検証用Accountだけを対象に、運営用providerまたは同じ`AccountPlanAssignment`契約のfixtureでLiteを割り当てます。
2. `/profile`のPlanと残量を確認し、本人データ画面で日記を訂正してexportを要求します。
3. Fullへ切り替え、確認済み履歴を使う機能と上限を確認します。
4. Familyの招待を別の検証用Accountで承諾し、Planだけが共有される説明とFamily表示を確認します。支払者側へ参加者の内容が表示されないことも確認します。
5. Freeへ切り替え、既存の日記とexportを引き続き閲覧でき、新しい利用だけがFree上限で判定されることを確認します。
6. 上限到達状態で危機表現を送り、安全案内がPlan判定より優先されることを確認します。

検証記録へAccount ID、招待token、日記本文、Customer IDなどの個人・決済識別子を転記しません。失敗時は対象Plan、付与元、期間、期待した機能名、実際のHTTP statusだけを記録します。
