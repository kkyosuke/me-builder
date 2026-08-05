import { useCallback, useState } from "react";
import { config } from "../../../../config";
import { type AsyncState, errorMessage } from "../../../../model/async-state";
import { resetDevelopmentDiagnosisData } from "../../infrastructure/diagnosis-api";

export function useResetDiagnosisData({
  idToken,
  onReset,
}: {
  idToken: string | null;
  onReset: () => Promise<void>;
}) {
  const [state, setState] = useState<AsyncState<string>>({ status: "idle" });

  const reset = useCallback(async (): Promise<void> => {
    if (
      !window.confirm(
        "ログイン中ユーザーの診断回答データをすべて削除します。この操作は取り消せません。続けますか？",
      )
    ) {
      return;
    }
    if (!idToken) {
      setState({
        status: "error",
        message: "本人確認情報を取得できませんでした。LINEから開き直してください。",
      });
      return;
    }

    setState({ status: "loading" });
    try {
      const deleted = await resetDevelopmentDiagnosisData(config.apiUrl, idToken);
      await onReset();
      const deletedCount = deleted.deletedAnswerCount + deleted.deletedDeferredQuestionCount;
      setState({
        status: "success",
        data:
          deletedCount === 0
            ? "削除対象の回答データはありませんでした。"
            : `回答データを削除しました（回答・保留 ${deletedCount}件）。`,
      });
    } catch (error) {
      setState({
        status: "error",
        message: errorMessage(error, "回答データを削除できませんでした。"),
      });
    }
  }, [idToken, onReset]);

  return { state, reset };
}
