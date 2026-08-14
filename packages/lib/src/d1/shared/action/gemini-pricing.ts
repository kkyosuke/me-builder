export const GEMINI_PRICING_AS_OF = "2026-08-15";

const NANO_USD_PER_USD = 1_000_000_000;

type TokenUsage = {
  promptTokenCount: number;
  candidatesTokenCount: number;
  thoughtsTokenCount: number;
  cachedContentTokenCount: number;
  toolUsePromptTokenCount: number;
};

type TokenPrice = {
  model: RegExp;
  effectiveFrom: number;
  effectiveUntil?: number;
  inputNanoUsd: number;
  cachedInputNanoUsd: number;
  outputNanoUsd: number;
};

export type GeminiCostEstimation =
  | { status: "available"; amountUsd: number }
  | {
      status: "unavailable";
      reason: "unsupported-model" | "invalid-usage" | "overflow";
    };

const TOKEN_PRICES: readonly TokenPrice[] = [
  {
    model: /^gemini-3\.5-flash-lite(?:-\d{3})?$/,
    // Google公式のGA日。単価改定時もこのperiodを残し、新しいperiodを追加する。
    effectiveFrom: Date.parse("2026-07-21T00:00:00.000Z"),
    // $0.30 / 1M input tokens
    inputNanoUsd: 300,
    // $0.03 / 1M cached input tokens
    cachedInputNanoUsd: 30,
    // $2.50 / 1M response and reasoning tokens
    outputNanoUsd: 2_500,
  },
];

/**
 * Vertex AIのStandard・Global endpointにおける1 tokenあたりの単価。
 * 単価の更新時はGEMINI_PRICING_AS_OFも更新する。
 */
function findTokenPrice(model: string, generatedAt: Date): TokenPrice | undefined {
  const timestamp = generatedAt.getTime();
  let selected: TokenPrice | undefined;
  for (const price of TOKEN_PRICES) {
    const applicable =
      price.model.test(model) &&
      timestamp >= price.effectiveFrom &&
      (price.effectiveUntil === undefined || timestamp < price.effectiveUntil);
    if (applicable && (!selected || price.effectiveFrom > selected.effectiveFrom)) {
      selected = price;
    }
  }
  return selected;
}

/** Standard・Global endpointの公開単価から概算料金をUSDで返す。 */
export function estimateGeminiCostUsd(
  model: string,
  usage: TokenUsage,
  generatedAt: Date,
): GeminiCostEstimation {
  const price = findTokenPrice(model, generatedAt);
  if (!price) return { status: "unavailable", reason: "unsupported-model" };
  if (usage.cachedContentTokenCount > usage.promptTokenCount) {
    return { status: "unavailable", reason: "invalid-usage" };
  }

  const uncachedInputTokens = usage.promptTokenCount - usage.cachedContentTokenCount;
  const nanoUsd =
    (uncachedInputTokens + usage.toolUsePromptTokenCount) * price.inputNanoUsd +
    usage.cachedContentTokenCount * price.cachedInputNanoUsd +
    (usage.candidatesTokenCount + usage.thoughtsTokenCount) * price.outputNanoUsd;

  return Number.isSafeInteger(nanoUsd)
    ? { status: "available", amountUsd: nanoUsd / NANO_USD_PER_USD }
    : { status: "unavailable", reason: "overflow" };
}

/** 集計期間を、単価が変わり得る境界で分割する。 */
export function splitByGeminiPricingPeriods(
  start: Date,
  end: Date,
): Array<{ start: Date; end: Date }> {
  const startTime = start.getTime();
  const endTime = end.getTime();
  const boundaries = new Set([startTime, endTime]);
  for (const price of TOKEN_PRICES) {
    if (price.effectiveFrom > startTime && price.effectiveFrom < endTime) {
      boundaries.add(price.effectiveFrom);
    }
    if (
      price.effectiveUntil !== undefined &&
      price.effectiveUntil > startTime &&
      price.effectiveUntil < endTime
    ) {
      boundaries.add(price.effectiveUntil);
    }
  }
  const sorted = [...boundaries].sort((first, second) => first - second);
  return sorted.slice(0, -1).map((periodStart, index) => ({
    start: new Date(periodStart),
    end: new Date(sorted[index + 1] as number),
  }));
}
