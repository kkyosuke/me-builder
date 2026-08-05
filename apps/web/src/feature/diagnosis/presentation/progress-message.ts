export type ProgressMilestone = "halfway" | "almost-done" | "complete";

export const PROGRESS_MESSAGES: Record<ProgressMilestone, readonly string[]> = {
  halfway: [
    "折り返し地点です。ここまでおつかれさま！",
    "半分まで進みました。自分のペースで続けましょう。",
    "いい調子です。あと半分、一息つきながらどうぞ。",
  ],
  "almost-done": [
    "あと少しです。最後までゆっくり答えていきましょう。",
    "ゴールが見えてきました。残りわずかです！",
    "ここまでおつかれさま。もうひと息です。",
  ],
  complete: [
    "お疲れさまでした。すべての質問への回答が完了しました！",
    "最後まで回答いただき、ありがとうございました。",
    "回答完了です。ここまで本当にお疲れさまでした！",
  ],
};

/** 回答済みの問数から、到達直後の1問だけ表示する応援メッセージの段階を返します。 */
export function resolveProgressMilestone(
  answeredCount: number,
  total: number,
): ProgressMilestone | null {
  if (total <= 0) {
    return null;
  }
  if (answeredCount >= total) {
    return "complete";
  }

  const halfwayCount = Math.ceil(total * 0.5);
  const almostDoneCount = Math.ceil(total * 0.8);
  if (answeredCount === almostDoneCount) {
    return "almost-done";
  }
  if (answeredCount === halfwayCount) {
    return "halfway";
  }
  return null;
}

/** 指定段階用の文言から1つ選びます。`random`を差し替えて単体テストできます。 */
export function pickProgressMessage(
  milestone: ProgressMilestone,
  random: () => number = Math.random,
): string {
  const messages = PROGRESS_MESSAGES[milestone];
  const index = Math.min(Math.floor(random() * messages.length), messages.length - 1);
  const message = messages[index];
  if (message === undefined) {
    throw new Error(`進捗メッセージが未定義です: ${milestone}`);
  }
  return message;
}
