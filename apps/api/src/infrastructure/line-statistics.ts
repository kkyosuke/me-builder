import * as v from "valibot";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const QuotaSchema = v.variant("type", [
  v.object({ type: v.literal("none") }),
  v.object({ type: v.literal("limited"), value: v.number() }),
]);
const ConsumptionSchema = v.object({ totalUsage: v.number() });
const DeliverySchema = v.object({
  status: v.picklist(["ready", "unready", "out_of_service"]),
  success: v.optional(v.number()),
});

async function getJson(url: string, token: string, fetcher: Fetcher): Promise<unknown> {
  const response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`LINE statistics request failed: ${response.status}`);
  return await response.json();
}

function jstMonthDates(now: Date): string[] {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const year = value("year");
  const month = value("month");
  const day = Number(value("day"));
  return Array.from(
    { length: day },
    (_, index) => `${year}${month}${String(index + 1).padStart(2, "0")}`,
  );
}

export type LineUsage = {
  billableMessages: number;
  monthlyLimit: number | null;
  replyMessages: number;
};

export async function fetchLineUsage(params: {
  channelAccessToken: string;
  now: Date;
  fetcher?: Fetcher;
}): Promise<LineUsage> {
  const fetcher = params.fetcher ?? fetch;
  const baseUrl = "https://api.line.me/v2/bot/message";
  const [quotaBody, consumptionBody, ...deliveries] = await Promise.all([
    getJson(`${baseUrl}/quota`, params.channelAccessToken, fetcher),
    getJson(`${baseUrl}/quota/consumption`, params.channelAccessToken, fetcher),
    ...jstMonthDates(params.now).map((date) =>
      getJson(`${baseUrl}/delivery/reply?date=${date}`, params.channelAccessToken, fetcher),
    ),
  ]);
  const quota = v.parse(QuotaSchema, quotaBody);
  const consumption = v.parse(ConsumptionSchema, consumptionBody);
  const replyMessages = deliveries.reduce<number>((total, body) => {
    const delivery = v.parse(DeliverySchema, body);
    return total + (delivery.status === "ready" ? (delivery.success ?? 0) : 0);
  }, 0);
  return {
    billableMessages: consumption.totalUsage,
    monthlyLimit: quota.type === "limited" ? quota.value : null,
    replyMessages,
  };
}
