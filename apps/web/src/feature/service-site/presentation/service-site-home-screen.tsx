import {
  type PublicPlanCode,
  publicBillingPlans,
  publicFreePlan,
  publicPlanCodes,
  publicPlanFeatures,
} from "@me-builder/shared";
import {
  BookOpen,
  Brain,
  Check,
  CircleHelp,
  HeartHandshake,
  LockKeyhole,
  MessageCircleHeart,
  NotebookPen,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { DocumentMetadata } from "../../../components/document-metadata";
import { config } from "../../../config";
import { serviceSitePageMetadata } from "../model/service-site-page-metadata";
import { LineFriendAddButton } from "./components/line-friend-add-button";

const bannerUrl = "/images/service/banner.jpg";
const characterGuidesUrl = "/images/service/character-guides.jpg";

const publicPlanNames: Readonly<Record<PublicPlanCode, string>> = {
  free: publicFreePlan.name,
  lite: "Lite",
  full: "Full",
  family: "ファミリーパック",
};

function priceFor(plan: (typeof publicBillingPlans)[number], interval: "month" | "year") {
  const price = plan.prices.find((candidate) => candidate.interval === interval);
  if (!price) throw new Error(`Price is missing: ${plan.code}/${interval}`);
  return price.amount;
}

function formatPrice(amount: number): string {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(amount);
}

const pricingPlans = [
  {
    ...publicFreePlan,
    monthlyAmount: 0,
    yearlyAmount: 0,
    trialDays: null,
  },
  ...publicBillingPlans.map((plan) => ({
    code: plan.code,
    name: plan.name,
    description: plan.description,
    highlights: plan.highlights,
    monthlyAmount: priceFor(plan, "month"),
    yearlyAmount: priceFor(plan, "year"),
    trialDays: plan.trialDays,
  })),
] as const;

const features = [
  {
    icon: Brain,
    title: "気軽な診断で、価値観を見つける",
    description: "1問ずつ答えながら、自分の回答とそこから見える傾向を振り返れます。",
  },
  {
    icon: NotebookPen,
    title: "いつものLINEで、日々を残す",
    description: "書きたいときに送った日記を、その日の記録だけで終わらせず自己理解へつなげます。",
  },
  {
    icon: BookOpen,
    title: "記録から、今の自分を振り返る",
    description:
      "診断と日記から見える傾向を、変化しうる現在の姿として「わたしのまとめ」で確認できます。",
  },
] as const;

const steps = [
  ["01", "LINEを友だち追加", "公式アカウントを友だち追加し、トークやリッチメニューから始めます。"],
  ["02", "少しずつ答える", "Webの診断やLINEの日記で、そのとき考えたことを残します。"],
  ["03", "自分で振り返る", "回答結果や「わたしのまとめ」を読み、今の自分を確かめます。"],
] as const;

const safetyItems = [
  "入力した情報は、初期状態では本人向けに扱います。",
  "本人の入力と、AIが整理・生成した内容を区別します。",
  "他の利用者との共有では、対象と範囲を示して別に同意を求めます。",
  "診断やAIの出力は、医療的・心理学的な診断や専門的助言ではありません。",
] as const;

const availability = [
  ["Webの診断", "1問ずつ答え、回答結果を確認できます。"],
  ["LINEの日記", "LINEのトークから、その日の出来事や考えを記録できます。"],
  ["わたしのまとめ", "診断と記録から見える今の傾向を確認できます。"],
] as const;

const faqs = [
  {
    question: "無料で使えますか？",
    answer:
      "はい。FreeではLINEの日記、公開中の診断、わたしのまとめ、基本の相性シートを利用できます。有料Planは提供準備中で、提供開始後はAI返信の回数や継続的な振り返りが広がります。",
  },
  {
    question: "Free、Lite、Full、ファミリーパックは何が違いますか？",
    answer:
      "わたしのまとめ、診断、日記、基本の相性シートは全Plan共通です。提供開始後のLiteは週次の振り返り、Fullは過去全体との比較や個別化セルフケア、ファミリーパックは最大4人へのFull相当の提供が主な違いです。現在、有料Planは提供準備中です。",
  },
  {
    question: "LINE公式アカウントの友だち追加は必要ですか？",
    answer:
      "この紹介サイトから使い始める場合は、LINE公式アカウントを友だち追加してください。既に利用中の方は、LINEのトークやリッチメニューからWeb機能を開けます。",
  },
  {
    question: "どのような情報を記録しますか？",
    answer:
      "診断への回答、LINEで送った日記、プロフィール、機能の利用に必要な履歴などを扱います。詳しい内容は公開予定のプライバシーポリシーで案内します。",
  },
  {
    question: "入力した内容は誰に見えますか？",
    answer:
      "初期状態では本人向けです。相性機能などで他の利用者へ共有するときは、対象と範囲を示して別に同意を求めます。",
  },
  {
    question: "AIは何に使われますか？",
    answer:
      "入力された記録を整理し、振り返りやすい形にまとめるために使います。AIの出力は本人の入力と区別して表示します。",
  },
  {
    question: "診断は医療的・心理学的な診断ですか？",
    answer:
      "いいえ。医療行為、医学的診断、心理検査、その他の専門的助言ではありません。重要な判断では必要に応じて専門家へ相談してください。",
  },
  {
    question: "利用をやめたい、データを削除したい場合は？",
    answer:
      "一般公開前に、本人確認を含む安全な依頼方法をお問い合わせページで案内します。機微な情報を公開フォームへ書く必要はありません。",
  },
  {
    question: "LINE Accountを失った場合は？",
    answer:
      "有料Planの提供開始後は、利用中のLINE Accountで事前に発行・保存した一回限りの復旧コードがあれば、新しいLINE Accountを同じAccountへ接続できます。コードがない場合は自動復旧できません。解約・問い合わせ方法は、窓口の準備後にお問い合わせページで案内します。",
  },
] as const;

function canonicalUrl(pathname: string): string | undefined {
  if (!config.baseUrl) return undefined;
  return new URL(pathname, config.baseUrl).toString();
}

export function ServiceSiteHomeScreen() {
  const pageCanonicalUrl = canonicalUrl("/");
  const metadata = serviceSitePageMetadata.home;

  return (
    <>
      <DocumentMetadata
        title={metadata.title}
        description={metadata.description}
        robots={metadata.robots}
        {...(pageCanonicalUrl ? { canonicalUrl: pageCanonicalUrl } : {})}
      />
      <main id="main-content">
        <section className="relative overflow-hidden px-4 pb-20 pt-12 sm:px-6 sm:pt-16 lg:px-8 lg:pb-28">
          <div className="absolute inset-x-0 top-0 -z-10 h-[34rem] bg-gradient-to-b from-violet-100/80 via-pink-50/60 to-transparent dark:from-violet-950/50 dark:via-slate-950" />
          <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/80 px-4 py-2 text-sm font-bold text-violet-800 shadow-sm dark:border-violet-700 dark:bg-slate-900/80 dark:text-violet-200">
                <Sparkles className="size-4" aria-hidden="true" />
                日記と診断で、自分を少しずつ知る
              </p>
              <h1 className="mt-6 text-balance text-4xl font-black leading-tight tracking-tight text-slate-950 sm:text-5xl lg:text-6xl dark:text-white">
                答えるたび、
                <span className="block bg-gradient-to-r from-violet-700 via-fuchsia-600 to-sky-600 bg-clip-text text-transparent dark:from-violet-300 dark:via-pink-300 dark:to-sky-300">
                  今のわたしが見えてくる。
                </span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-slate-700 dark:text-slate-200">
                LINEの日記と、気軽に答えられる診断から、あなたの考え方や大切にしていることを少しずつ整理します。
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <LineFriendAddButton />
                <a
                  href="#how-it-works"
                  className="inline-flex min-h-13 items-center justify-center rounded-full border border-slate-300 bg-white/80 px-6 font-bold text-slate-800 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                >
                  使い方を見る
                </a>
              </div>
              <p className="mt-5 flex items-start gap-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                <LockKeyhole
                  className="mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-300"
                  aria-hidden="true"
                />
                入力した内容は、初期状態で他の利用者へ公開されません。
              </p>
            </div>
            <div className="relative">
              <div className="absolute -inset-4 -z-10 rounded-[2.5rem] bg-gradient-to-br from-violet-200/60 via-pink-100/50 to-sky-100/70 blur-2xl dark:opacity-30" />
              <img
                src={bannerUrl}
                alt="自分らしさを映すうつしと、使い方を案内するミラ"
                width="1774"
                height="887"
                fetchPriority="high"
                className="aspect-2/1 w-full rounded-[2rem] border-4 border-white object-cover shadow-xl dark:border-slate-800"
              />
            </div>
          </div>
        </section>

        <section className="px-4 py-16 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-4xl rounded-[2rem] bg-slate-900 px-6 py-10 text-center text-white sm:px-12 dark:bg-slate-800">
            <MessageCircleHeart className="mx-auto size-8 text-pink-300" aria-hidden="true" />
            <h2 className="mt-4 text-2xl font-bold sm:text-3xl">
              自分のことほど、すぐには言葉にしづらいから。
            </h2>
            <p className="mx-auto mt-4 max-w-2xl leading-8 text-slate-200">
              そのときの気分だけで決めつけず、日々の記録や一つひとつの回答を手がかりに、自分のペースで振り返れます。
            </p>
          </div>
        </section>

        <section
          id="features"
          aria-labelledby="features-heading"
          className="scroll-mt-24 px-4 py-20 sm:px-6 lg:px-8"
        >
          <div className="mx-auto max-w-6xl">
            <p className="text-sm font-bold tracking-widest text-violet-700 dark:text-violet-300">
              できること
            </p>
            <h2
              id="features-heading"
              className="mt-3 text-3xl font-black tracking-tight sm:text-4xl"
            >
              記録する。見つける。振り返る。
            </h2>
            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {features.map((feature) => {
                const Icon = feature.icon;
                return (
                  <article
                    key={feature.title}
                    className="rounded-3xl border border-violet-100 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900"
                  >
                    <span className="grid size-12 place-items-center rounded-2xl bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200">
                      <Icon className="size-6" aria-hidden="true" />
                    </span>
                    <h3 className="mt-5 text-xl font-bold leading-8">{feature.title}</h3>
                    <p className="mt-3 leading-7 text-slate-600 dark:text-slate-300">
                      {feature.description}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section
          id="how-it-works"
          aria-labelledby="how-heading"
          className="scroll-mt-24 bg-gradient-to-b from-sky-50 to-white px-4 py-20 sm:px-6 lg:px-8 dark:from-sky-950/20 dark:to-slate-950"
        >
          <div className="mx-auto max-w-6xl">
            <p className="text-center text-sm font-bold tracking-widest text-sky-700 dark:text-sky-300">
              使い方
            </p>
            <h2
              id="how-heading"
              className="mt-3 text-center text-3xl font-black tracking-tight sm:text-4xl"
            >
              3つのステップで、少しずつ。
            </h2>
            <ol className="mt-12 grid gap-6 md:grid-cols-3">
              {steps.map(([number, title, description]) => (
                <li
                  key={number}
                  className="relative rounded-3xl bg-white p-6 shadow-sm ring-1 ring-sky-100 dark:bg-slate-900 dark:ring-slate-700"
                >
                  <span className="text-4xl font-black text-sky-200 dark:text-sky-800">
                    {number}
                  </span>
                  <h3 className="mt-3 text-xl font-bold">{title}</h3>
                  <p className="mt-3 leading-7 text-slate-600 dark:text-slate-300">{description}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="characters-heading" className="px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-5xl">
            <div className="text-center">
              <p className="text-sm font-bold tracking-widest text-pink-700 dark:text-pink-300">
                うつしとミラ
              </p>
              <h2
                id="characters-heading"
                className="mt-3 text-3xl font-black tracking-tight sm:text-4xl"
              >
                あなたの代わりに決めず、振り返りをそっと支えます。
              </h2>
            </div>
            <div className="mt-10 grid items-stretch gap-6 lg:grid-cols-[1.15fr_0.85fr]">
              <figure className="overflow-hidden rounded-[2rem] border-4 border-white bg-violet-50 shadow-lg dark:border-slate-800 dark:bg-slate-900">
                <img
                  src={characterGuidesUrl}
                  alt="胸の鏡に手を添えるうつしと、案内の本を持って隣に浮かぶミラ"
                  width="1200"
                  height="900"
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </figure>
              <div className="grid gap-5">
                <article className="rounded-3xl bg-gradient-to-br from-violet-100 to-sky-50 p-7 dark:from-violet-950/60 dark:to-sky-950/30">
                  <Sparkles
                    className="size-7 text-violet-700 dark:text-violet-300"
                    aria-hidden="true"
                  />
                  <h3 className="mt-4 text-2xl font-bold">うつし</h3>
                  <p className="mt-3 leading-7 text-slate-700 dark:text-slate-200">
                    回答が蓄積されるほど、その人らしさを映す存在。記録されていないことまで知っているわけではありません。
                  </p>
                </article>
                <article className="rounded-3xl bg-gradient-to-br from-amber-50 to-pink-100 p-7 dark:from-amber-950/30 dark:to-pink-950/50">
                  <CircleHelp
                    className="size-7 text-amber-700 dark:text-amber-300"
                    aria-hidden="true"
                  />
                  <h3 className="mt-4 text-2xl font-bold">ミラ</h3>
                  <p className="mt-3 leading-7 text-slate-700 dark:text-slate-200">
                    質問や使い方を案内する存在。あなたが自分の言葉で考える時間を手伝います。
                  </p>
                </article>
              </div>
            </div>
          </div>
        </section>

        <section
          id="safety"
          aria-labelledby="safety-heading"
          className="scroll-mt-24 bg-emerald-950 px-4 py-20 text-white sm:px-6 lg:px-8"
        >
          <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <ShieldCheck className="size-10 text-emerald-300" aria-hidden="true" />
              <p className="mt-5 text-sm font-bold tracking-widest text-emerald-300">
                データと安全性
              </p>
              <h2
                id="safety-heading"
                className="mt-3 text-3xl font-black tracking-tight sm:text-4xl"
              >
                始める前に、知ってほしいこと。
              </h2>
            </div>
            <ul className="grid gap-3">
              {safetyItems.map((item) => (
                <li key={item} className="flex gap-3 rounded-2xl bg-white/10 p-4 leading-7">
                  <Check className="mt-1 size-5 shrink-0 text-emerald-300" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="availability-heading" className="px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-5xl">
            <p className="text-sm font-bold tracking-widest text-violet-700 dark:text-violet-300">
              現在できること
            </p>
            <h2
              id="availability-heading"
              className="mt-3 text-3xl font-black tracking-tight sm:text-4xl"
            >
              いま使える中核体験
            </h2>
            <div className="mt-8 divide-y divide-violet-100 overflow-hidden rounded-3xl border border-violet-100 bg-white shadow-sm dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-900">
              {availability.map(([title, description]) => (
                <div
                  key={title}
                  className="grid gap-3 p-5 sm:grid-cols-[1fr_2fr_auto] sm:items-center sm:p-6"
                >
                  <h3 className="font-bold">{title}</h3>
                  <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                    {description}
                  </p>
                  <span className="w-fit rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200">
                    利用できます
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section
          id="pricing"
          aria-labelledby="pricing-heading"
          className="scroll-mt-24 bg-gradient-to-b from-violet-50/70 to-white px-4 py-20 sm:px-6 lg:px-8 dark:from-violet-950/20 dark:to-slate-950"
        >
          <div className="mx-auto max-w-7xl">
            <p className="text-center text-sm font-bold tracking-widest text-violet-700 dark:text-violet-300">
              料金プラン
            </p>
            <h2
              id="pricing-heading"
              className="mt-3 text-center text-3xl font-black tracking-tight sm:text-4xl"
            >
              自分に合う続け方を選べます。
            </h2>
            <p className="mx-auto mt-4 max-w-3xl text-center leading-7 text-slate-600 dark:text-slate-300">
              日記、診断、わたしのまとめ、基本の相性シートはすべてのPlanで共通の対象機能です。有料Planでは、振り返る時間の長さと継続支援が広がります。
            </p>
            <p className="mx-auto mt-3 max-w-3xl text-center text-sm font-bold text-amber-800 dark:text-amber-200">
              有料Planは提供準備中です。以下は提供開始時の予定価格と機能で、現在は購入できません。
            </p>

            <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {pricingPlans.map((plan) => (
                <article
                  key={plan.code}
                  className={`flex flex-col rounded-3xl border bg-white p-6 shadow-sm dark:bg-slate-900 ${
                    plan.code === "full"
                      ? "border-violet-400 ring-2 ring-violet-200 dark:border-violet-500 dark:ring-violet-900"
                      : "border-violet-100 dark:border-slate-700"
                  }`}
                >
                  {plan.code !== "free" && (
                    <p className="mb-3 w-fit rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900 dark:bg-amber-400/15 dark:text-amber-200">
                      提供準備中
                    </p>
                  )}
                  {plan.code === "full" && (
                    <p className="mb-3 w-fit rounded-full bg-violet-100 px-3 py-1 text-xs font-bold text-violet-800 dark:bg-violet-400/15 dark:text-violet-200">
                      しっかり振り返りたい方へ
                    </p>
                  )}
                  <h3 className="text-2xl font-black">{plan.name}</h3>
                  <p className="mt-3 min-h-20 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    {plan.description}
                  </p>
                  <p className="mt-5 text-3xl font-black">
                    {formatPrice(plan.monthlyAmount)}
                    <span className="ml-1 text-sm font-normal text-slate-500">/月</span>
                  </p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {plan.yearlyAmount === 0
                      ? "年額も0円"
                      : `年額 ${formatPrice(plan.yearlyAmount)}`}
                  </p>
                  {plan.trialDays ? (
                    <p className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
                      提供開始時は初回{plan.trialDays}日間無料
                    </p>
                  ) : (
                    <p className="mt-4 rounded-xl bg-sky-50 px-3 py-2 text-sm font-bold text-sky-800 dark:bg-sky-950/60 dark:text-sky-200">
                      ずっと無料
                    </p>
                  )}
                  <ul className="mt-5 flex-1 space-y-3 text-sm leading-6">
                    {plan.highlights.map((highlight) => (
                      <li key={highlight} className="flex gap-2">
                        <Check
                          className="mt-1 size-4 shrink-0 text-emerald-600 dark:text-emerald-300"
                          aria-hidden="true"
                        />
                        <span>{highlight}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>

            <div className="mt-10 overflow-x-auto rounded-3xl border border-violet-100 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <table className="w-full min-w-[64rem] border-collapse text-left text-sm">
                <caption className="sr-only">Free、Lite、Full、ファミリーパックの機能比較</caption>
                <thead>
                  <tr className="border-b border-violet-100 bg-violet-50/70 dark:border-slate-700 dark:bg-slate-800">
                    <th
                      scope="col"
                      className="sticky left-0 z-10 min-w-52 bg-violet-50 px-5 py-4 font-bold dark:bg-slate-800"
                    >
                      機能
                    </th>
                    {publicPlanCodes.map((code) => (
                      <th key={code} scope="col" className="min-w-44 px-5 py-4 font-bold">
                        <span className="block">{publicPlanNames[code]}</span>
                        <span
                          className={`mt-1 block text-xs ${
                            code === "free"
                              ? "text-emerald-700 dark:text-emerald-300"
                              : "text-amber-800 dark:text-amber-200"
                          }`}
                        >
                          {code === "free" ? "利用できます" : "提供準備中"}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {publicPlanFeatures.map((feature) => (
                    <tr
                      key={feature.label}
                      className="border-b border-violet-100 last:border-0 dark:border-slate-700"
                    >
                      <th
                        scope="row"
                        className="sticky left-0 z-10 bg-white px-5 py-4 font-bold dark:bg-slate-900"
                      >
                        {feature.label}
                      </th>
                      {publicPlanCodes.map((code) => (
                        <td key={code} className="px-5 py-4 text-slate-600 dark:text-slate-300">
                          {feature.plans[code]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-5 text-center text-xs leading-6 text-slate-500 dark:text-slate-400">
              わたしのまとめは全Plan共通で月4回まで生成できます。診断または日記があり、前回から入力が変わった場合、または前回生成から30日以上経過した場合が対象です。いずれの生成条件も満たさない場合は回数を消費せず、新しい版も生成しません。
            </p>
            <p className="mt-2 text-center text-xs leading-6 text-slate-500 dark:text-slate-400">
              AI返信は、メッセージの送信回数ではなく、AIが生成して正常に届けた回答を1回として数えます。Freeの月60回は、1日2回使う場合の約30日分です。
            </p>
            <p className="mt-2 text-center text-xs leading-6 text-slate-500 dark:text-slate-400">
              表示価格は税込です。提供開始後、有料Planは選択した期間で自動更新され、初回トライアルの終了後から料金が発生します。
            </p>
          </div>
        </section>

        <section
          id="faq"
          aria-labelledby="faq-heading"
          className="scroll-mt-24 bg-violet-50/70 px-4 py-20 sm:px-6 lg:px-8 dark:bg-violet-950/20"
        >
          <div className="mx-auto max-w-4xl">
            <p className="text-sm font-bold tracking-widest text-violet-700 dark:text-violet-300">
              よくある質問
            </p>
            <h2 id="faq-heading" className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
              利用前の疑問に答えます。
            </h2>
            <div className="mt-8 grid gap-3">
              {faqs.map((faq) => (
                <details
                  key={faq.question}
                  className="group rounded-2xl border border-violet-100 bg-white p-5 open:shadow-sm dark:border-slate-700 dark:bg-slate-900"
                >
                  <summary className="cursor-pointer list-none pr-8 font-bold marker:hidden focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-500">
                    {faq.question}
                  </summary>
                  <p className="mt-4 border-t border-violet-100 pt-4 leading-7 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                    {faq.answer}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-5xl overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-violet-700 via-fuchsia-700 to-sky-700 px-6 py-14 text-center text-white shadow-xl sm:px-12">
            <HeartHandshake className="mx-auto size-9 text-pink-200" aria-hidden="true" />
            <h2 className="mt-5 text-3xl font-black sm:text-4xl">
              少しずつ、わたしを知っていこう。
            </h2>
            <p className="mx-auto mt-4 max-w-2xl leading-7 text-violet-100">
              日記と診断を手がかりに、今の自分を自分のペースで振り返れます。
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <LineFriendAddButton />
              <a
                href="/terms"
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/60 px-6 font-bold text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                利用規約とデータの扱いを見る
              </a>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
