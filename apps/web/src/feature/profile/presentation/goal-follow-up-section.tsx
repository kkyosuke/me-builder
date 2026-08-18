import { Check, CircleStop, Footprints, LoaderCircle, RotateCcw, Save } from "lucide-react";
import { useState } from "react";
import type { AsyncState } from "../../../model/async-state";
import type {
  GoalFollowUpItem,
  GoalFollowUpResult,
  GoalFollowUpStatus,
} from "../model/goal-follow-up";

const statusLabels: Record<GoalFollowUpStatus, string> = {
  active: "継続中",
  completed: "完了",
  stopped: "停止",
};

function FollowUpCard({
  item,
  pending,
  disabled,
  canManage,
  onUpdate,
}: {
  item: GoalFollowUpItem;
  pending: boolean;
  disabled: boolean;
  canManage: boolean;
  onUpdate: (input: Readonly<{ status?: GoalFollowUpStatus; nextStep?: string }>) => void;
}) {
  const [nextStep, setNextStep] = useState(item.nextStep);
  const active = item.status === "active";
  return (
    <article className="rounded-2xl border border-emerald-100 bg-white/80 p-4 dark:border-emerald-900 dark:bg-slate-900/70">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">{item.goal}</p>
        <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
          {statusLabels[item.status]}
        </span>
      </div>
      {active && canManage ? (
        <label className="mt-3 block text-sm font-medium text-slate-600 dark:text-slate-300">
          次の小さな一歩
          <input
            value={nextStep}
            maxLength={500}
            disabled={disabled}
            onChange={(event) => setNextStep(event.currentTarget.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </label>
      ) : (
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">次の一歩: {item.nextStep}</p>
      )}
      {active && canManage ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={disabled || !nextStep.trim() || nextStep.trim() === item.nextStep}
            onClick={() => onUpdate({ nextStep: nextStep.trim() })}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium disabled:opacity-50 dark:border-slate-700"
          >
            {pending ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : (
              <Save className="size-3" />
            )}
            保存
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onUpdate({ status: "completed" })}
            className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            <Check className="size-3" /> 完了
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onUpdate({ status: "stopped" })}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium disabled:opacity-50 dark:border-slate-700"
          >
            <CircleStop className="size-3" /> 停止
          </button>
        </div>
      ) : null}
    </article>
  );
}

function CandidateCard({
  candidate,
  pending,
  disabled,
  onAgree,
}: {
  candidate: GoalFollowUpResult["candidates"][number];
  pending: boolean;
  disabled: boolean;
  onAgree: (nextStep: string) => void;
}) {
  const [nextStep, setNextStep] = useState("");
  return (
    <article className="rounded-2xl border border-dashed border-emerald-200 p-4 dark:border-emerald-800">
      <p className="font-medium">{candidate.goal}</p>
      <label className="mt-3 block text-sm font-medium text-slate-600 dark:text-slate-300">
        最初の小さな一歩
        <input
          value={nextStep}
          maxLength={500}
          disabled={disabled}
          placeholder="例: 明日の朝、5分だけ始める"
          onChange={(event) => setNextStep(event.currentTarget.value)}
          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        />
      </label>
      <button
        type="button"
        disabled={disabled || !nextStep.trim()}
        onClick={() => onAgree(nextStep.trim())}
        className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <RotateCcw className="size-4" />
        )}
        この行動を続ける
      </button>
    </article>
  );
}

export function GoalFollowUpSection({
  state,
  pendingId,
  operationError,
  onRetry,
  onAgree,
  onUpdate,
}: {
  state: AsyncState<GoalFollowUpResult>;
  pendingId: string | null;
  operationError: string | null;
  onRetry: () => void;
  onAgree: (brainItemId: string, nextStep: string) => void;
  onUpdate: (
    id: string,
    input: Readonly<{ status?: GoalFollowUpStatus; nextStep?: string }>,
  ) => void;
}) {
  if (state.status === "loading" || state.status === "idle") {
    return (
      <output
        className="mt-8 block"
        aria-busy="true"
        aria-label="行動のフォローアップを読み込んでいます"
      >
        <div className="h-6 w-48 animate-pulse rounded bg-slate-200 motion-reduce:animate-none dark:bg-slate-700" />
        <div className="mt-3 h-28 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" />
      </output>
    );
  }
  if (state.status === "error") {
    return (
      <section className="mt-8 rounded-2xl bg-rose-50 p-4 text-sm text-rose-700">
        <p>{state.message}</p>
        <button type="button" onClick={onRetry} className="mt-2 font-semibold underline">
          もう一度読み込む
        </button>
      </section>
    );
  }
  const activeItems = state.data.items.filter(({ status }) => status === "active");
  const pastItems = state.data.items.filter(({ status }) => status !== "active").slice(0, 20);
  const busy = pendingId !== null;
  const limitReached =
    state.data.activeLimit !== null && activeItems.length >= state.data.activeLimit;
  return (
    <section className="mt-8" aria-labelledby="goal-follow-up-title">
      <div className="flex items-center gap-2">
        <Footprints className="size-5 text-emerald-600" aria-hidden="true" />
        <h2 id="goal-follow-up-title" className="font-semibold">
          行動のフォローアップ
        </h2>
      </div>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        自分で選んだ小さな一歩を、次の会話で自然に振り返れます。
      </p>
      {operationError ? (
        <p role="alert" className="mt-3 text-sm text-rose-600">
          {operationError}
        </p>
      ) : null}
      {activeItems.length > 0 ? (
        <div className="mt-3 space-y-3">
          {activeItems.map((item) => (
            <FollowUpCard
              key={item.id}
              item={item}
              pending={pendingId === item.id}
              disabled={busy}
              canManage={state.data.canManage}
              onUpdate={(input) => onUpdate(item.id, input)}
            />
          ))}
        </div>
      ) : (
        <p className="mt-3 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
          継続中の行動はありません。
        </p>
      )}
      {state.data.canManage && !limitReached && state.data.candidates.length > 0 ? (
        <div className="mt-5 space-y-3">
          <h3 className="text-sm font-semibold">話した目標から選ぶ</h3>
          {state.data.candidates.map((candidate) => (
            <CandidateCard
              key={candidate.brainItemId}
              candidate={candidate}
              pending={pendingId === candidate.brainItemId}
              disabled={busy}
              onAgree={(nextStep) => onAgree(candidate.brainItemId, nextStep)}
            />
          ))}
        </div>
      ) : null}
      {!state.data.canManage ? (
        <p className="mt-3 text-xs text-slate-500">
          過去の状態は確認できます。新しいフォローアップと変更はLite以上で利用できます。
        </p>
      ) : limitReached ? (
        <p className="mt-3 text-xs text-slate-500">
          Liteでは1件を継続できます。別の行動を選ぶには、現在の行動を完了または停止してください。
        </p>
      ) : state.data.candidates.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">
          日記チャットで「次にやりたいこと」を話すと、ここから選べるようになります。
        </p>
      ) : null}
      {pastItems.length > 0 ? (
        <details className="mt-5">
          <summary className="cursor-pointer text-sm font-medium">完了・停止した行動</summary>
          <div className="mt-3 space-y-3">
            {pastItems.map((item) => (
              <FollowUpCard
                key={item.id}
                item={item}
                pending={false}
                disabled={false}
                canManage={state.data.canManage}
                onUpdate={() => undefined}
              />
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}
