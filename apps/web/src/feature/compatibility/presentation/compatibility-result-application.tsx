import { AlertCircle, RefreshCw } from "lucide-react";
import { useLiffSession } from "../../liff";
import { toCompatibilityPerson } from "../model/compatibility-relationship-view";
import { CompatibilityResultScreen } from "./compatibility-result-screen";
import { CompatibilityBackHeader } from "./components/compatibility-ui";
import { useCompatibilityRelationship } from "./hooks/use-compatibility-relationship";

const waitingGuides = {
  "profile-summary": {
    title: "相性シートを表示する準備が必要です",
    message:
      "共有できる「私について」がまだありません。わたしのまとめを作ると、追加の確認なしで共有されます。",
    href: "/me",
    label: "わたしの傾向を作る",
  },
  diagnosis: {
    title: "相性シートを表示する準備が必要です",
    message:
      "2人で比べられる共通の診断テーマがまだありません。診断に答えると、追加の確認なしで共有されます。",
    href: "/diagnosis",
    label: "診断を見る",
  },
  partner: {
    title: "相手の準備を待っています",
    message:
      "あなたの共有内容はそろっています。相手の準備が終わると、追加の確認なしでこの相性シートを表示できます。",
    href: "/compatibility",
    label: "相性一覧へ戻る",
  },
} as const;

export default function CompatibilityResultApplication({
  relationshipId,
}: {
  relationshipId: string | null;
}) {
  const { acquireIdToken } = useLiffSession();
  const relationship = useCompatibilityRelationship({ acquireIdToken, relationshipId });

  if (relationship.state.status === "loading") {
    return (
      <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-6 sm:px-8" aria-busy="true">
        <CompatibilityBackHeader />
        <output aria-live="polite" className="mt-8 block text-sm text-slate-500">
          相性シートを読み込んでいます...
        </output>
      </main>
    );
  }
  if (relationship.state.status === "error") {
    return (
      <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-6 sm:px-8">
        <CompatibilityBackHeader />
        <section className="mt-8 rounded-3xl border border-red-300 bg-red-50 p-6 text-center dark:bg-red-950/30">
          <AlertCircle className="mx-auto size-8 text-red-600" aria-hidden="true" />
          <h1 className="mt-3 text-xl font-bold">相性シートを表示できませんでした</h1>
          <p className="mt-2 text-sm">{relationship.state.message}</p>
          <button
            type="button"
            onClick={() => void relationship.reload()}
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-red-200 px-4 font-bold"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            再試行
          </button>
        </section>
      </main>
    );
  }
  if (relationship.state.status !== "success") return null;
  if (relationship.state.data.status === "waiting") {
    // nextActionがnullのときは相手側の準備待ちで、閲覧者の操作では解消できない。
    const waiting = waitingGuides[relationship.state.data.nextAction ?? "partner"];
    return (
      <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-6 sm:px-8">
        <CompatibilityBackHeader />
        <section className="mt-8 rounded-3xl border border-amber-300 bg-amber-50 p-6 dark:bg-amber-950/30">
          <h1 className="text-xl font-bold">{waiting.title}</h1>
          <p className="mt-2 text-sm">{waiting.message}</p>
          <a
            href={waiting.href}
            className="mt-5 flex min-h-11 items-center justify-center rounded-xl bg-amber-300 font-bold text-amber-950"
          >
            {waiting.label}
          </a>
        </section>
      </main>
    );
  }

  return (
    <CompatibilityResultScreen
      me={toCompatibilityPerson(relationship.state.data.viewer, "sky")}
      partner={toCompatibilityPerson(relationship.state.data.partner, "violet")}
      endingState={relationship.ending}
      onEnd={() => void relationship.end()}
    />
  );
}
