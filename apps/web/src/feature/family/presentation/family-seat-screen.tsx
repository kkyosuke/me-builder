import { ArrowLeft, Copy, Link2, ShieldCheck, UserMinus, Users } from "lucide-react";
import type { AsyncState } from "../../../model/async-state";
import type { FamilyInvitation, FamilySeat, FamilySeatManagement } from "../model/family-seat";

const statusLabel = {
  invited: "招待中",
  active: "参加中",
  left: "退出済み",
  cancelled: "取消済み",
  removed: "削除済み",
  ended: "契約終了",
} as const;

function currentSlots(management: FamilySeatManagement): Array<FamilySeat | null> {
  return Array.from({ length: management.maxSeats }, (_, index) => {
    const candidates = management.seats.filter(({ slotNumber }) => slotNumber === index + 1);
    return candidates[candidates.length - 1] ?? null;
  });
}

export function FamilySeatScreen({
  state,
  invitationToken,
  issuedInvitation,
  invitationLink,
  actionState,
  completionMessage,
  isFreeAfterExit,
  onBack,
  onIssue,
  onCopy,
  onAccept,
  onDecline,
  onCancel,
  onRemove,
  onLeave,
  onRetry,
}: {
  state: AsyncState<FamilySeatManagement>;
  invitationToken: string | null;
  issuedInvitation: FamilyInvitation | null;
  invitationLink: string | null;
  actionState: AsyncState<string>;
  completionMessage: string | null;
  isFreeAfterExit: boolean;
  onBack: () => void;
  onIssue: () => void;
  onCopy: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onCancel: (seatId: string) => void;
  onRemove: (seatId: string) => void;
  onLeave: () => void;
  onRetry: () => void;
}) {
  const busy = actionState.status === "loading";
  const management = state.status === "success" ? state.data : null;
  const liveCount = management?.seats.filter(
    ({ status }) => status === "active" || status === "invited",
  ).length;

  return (
    <dialog
      open
      aria-modal="true"
      aria-labelledby="family-seat-title"
      className="fixed inset-0 z-[70] m-0 h-auto max-h-none w-auto max-w-none overflow-y-auto border-0 bg-slate-50 p-0 dark:bg-slate-900"
    >
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <div className="mx-auto flex min-h-16 max-w-2xl items-center px-4 sm:px-8">
          <button
            type="button"
            onClick={onBack}
            aria-label="ファミリーパックを閉じる"
            className="inline-flex size-11 items-center justify-center rounded-full text-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:text-slate-300"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
          </button>
          <h1
            id="family-seat-title"
            className="ml-2 text-lg font-bold text-slate-950 dark:text-white"
          >
            ファミリーパック
          </h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 py-8 pb-16 sm:px-8">
        {invitationToken && !completionMessage ? (
          <section className="rounded-3xl border border-sky-200 bg-white p-6 shadow-sm dark:border-sky-800 dark:bg-slate-800">
            <Users className="size-10 text-sky-600 dark:text-sky-300" aria-hidden="true" />
            <h2 className="mt-4 text-xl font-bold text-slate-950 dark:text-white">
              ファミリーパックへの招待
            </h2>
            <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
              承諾すると、このAccountにファミリーパック由来のFull機能が付与されます。支払者に日記、診断、プロフィールは共有されません。
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                disabled={busy}
                onClick={onAccept}
                className="min-h-12 rounded-xl bg-sky-600 px-5 font-bold text-white disabled:opacity-50"
              >
                招待を承諾する
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onDecline}
                className="min-h-12 rounded-xl border border-slate-300 px-5 font-bold text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
              >
                辞退する
              </button>
            </div>
          </section>
        ) : isFreeAfterExit ? (
          <section className="rounded-3xl bg-white p-6 dark:bg-slate-800">
            <h2 className="text-xl font-bold">現在のプラン: Free</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              ファミリーパックの席は終了しました。保存済みの本人データはそのまま残ります。
            </p>
          </section>
        ) : state.status === "loading" || state.status === "idle" ? (
          <output
            aria-busy="true"
            className="block min-h-64 animate-pulse rounded-3xl bg-slate-200 dark:bg-slate-700"
          />
        ) : state.status === "error" ? (
          <section
            role="alert"
            className="rounded-2xl bg-rose-50 p-5 text-rose-900 dark:bg-rose-400/10 dark:text-rose-100"
          >
            <p>{state.message}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 min-h-11 rounded-xl bg-white px-4 font-bold dark:bg-slate-800"
            >
              再試行
            </button>
          </section>
        ) : management?.role === "payer" ? (
          <>
            <section className="rounded-3xl bg-gradient-to-br from-sky-100 to-violet-100 p-6 dark:from-sky-950 dark:to-violet-950">
              <p className="text-sm font-bold text-sky-800 dark:text-sky-200">
                使用中 {liveCount} / 4 Account
              </p>
              <h2 className="mt-2 text-2xl font-bold text-slate-950 dark:text-white">
                席を管理する
              </h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                支払者自身を含む4 Accountまで利用できます。
              </p>
            </section>
            <section aria-label="席一覧" className="mt-6 grid gap-3">
              {currentSlots(management).map((seat, index) => (
                <article
                  key={seat?.id ?? `empty-${index + 1}`}
                  className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h3 className="font-bold text-slate-950 dark:text-white">
                        席 {index + 1}
                        {index === 0 ? "（支払者）" : ""}
                      </h3>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        {seat ? statusLabel[seat.status] : "空き"}
                      </p>
                      {seat && (
                        <p className="mt-1 text-xs text-slate-400">
                          更新{" "}
                          {new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium" }).format(
                            new Date(seat.updatedAt),
                          )}
                        </p>
                      )}
                    </div>
                    {seat?.status === "invited" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onCancel(seat.id)}
                        className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-bold dark:border-slate-600"
                      >
                        招待を取り消す
                      </button>
                    )}
                    {seat?.role === "member" && seat.status === "active" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onRemove(seat.id)}
                        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-rose-300 px-4 text-sm font-bold text-rose-700 dark:text-rose-200"
                      >
                        <UserMinus className="size-4" aria-hidden="true" />
                        席から外す
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </section>
            <button
              type="button"
              disabled={busy || liveCount === 4}
              onClick={onIssue}
              className="mt-5 min-h-12 w-full rounded-xl bg-sky-600 px-5 font-bold text-white disabled:opacity-50"
            >
              新しい招待リンクを作る
            </button>
            {issuedInvitation && invitationLink && (
              <section className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-800 dark:bg-sky-400/10">
                <p className="font-bold text-slate-950 dark:text-white">48時間有効な招待リンク</p>
                <output className="mt-2 block break-all rounded-lg bg-white p-3 text-sm dark:bg-slate-800">
                  {invitationLink}
                </output>
                <button
                  type="button"
                  onClick={onCopy}
                  className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 font-bold dark:bg-slate-800"
                >
                  <Copy className="size-4" aria-hidden="true" />
                  リンクをコピー
                </button>
                <p className="mt-2 text-xs text-slate-500">
                  期限:{" "}
                  {new Intl.DateTimeFormat("ja-JP", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(issuedInvitation.expiresAt))}
                </p>
              </section>
            )}
            <p className="mt-5 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-950 dark:bg-amber-400/10 dark:text-amber-100">
              契約を終了すると、参加者の席と招待は失効し、各AccountはFreeへ戻ります。本人データは削除されません。
            </p>
          </>
        ) : management?.role === "member" ? (
          <section className="rounded-3xl border border-sky-200 bg-white p-6 dark:border-sky-800 dark:bg-slate-800">
            <p className="text-sm font-bold text-sky-700 dark:text-sky-200">
              付与元: ファミリーパック
            </p>
            <h2 className="mt-2 text-xl font-bold text-slate-950 dark:text-white">参加中です</h2>
            <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
              退出すると有料機能は終了し、すぐにFreeへ戻ります。保存済みの本人データは削除されません。
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={onLeave}
              className="mt-6 min-h-12 w-full rounded-xl border border-rose-300 px-5 font-bold text-rose-700 disabled:opacity-50 dark:text-rose-200"
            >
              ファミリーパックから退出する
            </button>
          </section>
        ) : (
          <section className="rounded-3xl bg-white p-6 dark:bg-slate-800">
            <h2 className="text-xl font-bold">現在のプラン: Free</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              参加中のファミリーパックはありません。
            </p>
          </section>
        )}

        {completionMessage && (
          <output className="mt-5 block rounded-2xl bg-emerald-50 p-4 text-emerald-900 dark:bg-emerald-400/10 dark:text-emerald-100">
            {completionMessage}
          </output>
        )}
        {actionState.status === "error" && (
          <p
            role="alert"
            className="mt-5 rounded-2xl bg-rose-50 p-4 text-rose-900 dark:bg-rose-400/10 dark:text-rose-100"
          >
            {actionState.message}
          </p>
        )}
        <aside className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
          <h2 className="flex items-center gap-2 font-bold text-slate-950 dark:text-white">
            <ShieldCheck className="size-5 text-emerald-600" aria-hidden="true" />
            プライバシーは別々です
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            ファミリーパックは料金プランだけを共有します。支払者は参加者の個人内容を閲覧できません。相性共有には別の招待と同意が必要です。
          </p>
          <p className="mt-2 flex items-center gap-2 text-xs text-slate-500">
            <Link2 className="size-4" aria-hidden="true" />
            ファミリー参加だけでは相性共有は始まりません。
          </p>
        </aside>
      </main>
    </dialog>
  );
}
