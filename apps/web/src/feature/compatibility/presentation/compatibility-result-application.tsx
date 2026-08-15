import { AlertCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { InternalLink } from "../../../components/internal-link";
import {
  diagnosisCategoryHref,
  getRelationshipCategoryBadgeClassName,
  getRelationshipCategoryLabel,
} from "../../diagnosis/model/relationship-category";
import { useLiffSession } from "../../liff";
import { compatibilityShareContentHref } from "../model/compatibility-category-navigation";
import { toCompatibilityPerson } from "../model/compatibility-relationship-view";
import { CompatibilityResultScreen } from "./compatibility-result-screen";
import { preloadCompatibilityRoute } from "./compatibility-route-loaders";
import {
  CompatibilityEndSharing,
  CompatibilitySharingEndedScreen,
} from "./components/compatibility-end-sharing";
import { CompatibilityBackHeader } from "./components/compatibility-ui";
import { useCompatibilityRelationship } from "./hooks/use-compatibility-relationship";

const waitingGuides = {
  "profile-summary": {
    title: "相性シートを表示する準備が必要です",
    message:
      "共有できる「私について」がまだありません。わたしのまとめを作ると、追加の確認なしで共有されます。",
    label: "わたしの傾向を作る",
  },
  diagnosis: {
    title: "相性シートを表示する準備が必要です",
    message:
      "2人で比べられる共通の診断テーマがまだありません。診断に答えると、追加の確認なしで共有されます。",
    label: "診断を見る",
  },
  partner: {
    title: "相手の準備を待っています",
    message:
      "あなたの共有内容はそろっています。相手の準備が終わると、追加の確認なしでこの相性シートを表示できます。",
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
  const [confirmingEnd, setConfirmingEnd] = useState(false);

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
          <h1
            tabIndex={-1}
            data-compatibility-route-heading="result"
            className="mt-3 text-xl font-bold focus:outline-none"
          >
            相性シートを表示できませんでした
          </h1>
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
  if (relationship.ending.status === "success") return <CompatibilitySharingEndedScreen />;
  if (relationship.state.data.status === "waiting") {
    // nextActionがnullのときは相手側の準備待ちで、閲覧者の操作では解消できない。
    const waiting = waitingGuides[relationship.state.data.nextAction ?? "partner"];
    const shouldPreloadList = relationship.state.data.nextAction === null;
    const waitingHref =
      relationship.state.data.nextAction === "diagnosis"
        ? diagnosisCategoryHref(relationship.state.data.relationshipCategory)
        : relationship.state.data.nextAction === "profile-summary"
          ? compatibilityShareContentHref(relationship.state.data.relationshipCategory)
          : "/compatibility";
    return (
      <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-6 sm:px-8">
        <CompatibilityBackHeader />
        <section className="mt-8 rounded-3xl border border-amber-300 bg-amber-50 p-6 dark:bg-amber-950/30">
          <p
            className={`mb-3 w-fit rounded-full px-3 py-1.5 text-sm font-bold ${getRelationshipCategoryBadgeClassName(relationship.state.data.relationshipCategory)}`}
          >
            {getRelationshipCategoryLabel(relationship.state.data.relationshipCategory)}
          </p>
          <h1
            tabIndex={-1}
            data-compatibility-route-heading="result"
            className="text-xl font-bold focus:outline-none"
          >
            {waiting.title}
          </h1>
          <p className="mt-2 text-sm">{waiting.message}</p>
          <InternalLink
            href={waitingHref}
            onPreload={() => {
              if (shouldPreloadList) preloadCompatibilityRoute("list");
            }}
            preloadRoute={
              relationship.state.data.nextAction === "diagnosis"
                ? "diagnosis"
                : relationship.state.data.nextAction === "profile-summary"
                  ? "me"
                  : "compatibility"
            }
            className="mt-5 flex min-h-11 items-center justify-center rounded-xl bg-amber-300 font-bold text-amber-950"
          >
            {waiting.label}
          </InternalLink>
        </section>
        <CompatibilityEndSharing
          confirming={confirmingEnd}
          endingState={relationship.ending}
          onRequest={() => setConfirmingEnd(true)}
          onCancel={() => setConfirmingEnd(false)}
          onEnd={() => void relationship.end()}
        />
      </main>
    );
  }

  return (
    <CompatibilityResultScreen
      me={toCompatibilityPerson(relationship.state.data.viewer, "sky")}
      partner={toCompatibilityPerson(relationship.state.data.partner, "violet")}
      relationshipCategory={relationship.state.data.relationshipCategory}
      endingState={relationship.ending}
      onEnd={() => void relationship.end()}
    />
  );
}
