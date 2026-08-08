import type { ProfileRecord, ProfileRecordSource, ProfileSummary } from "./profile-summary";

type Candidate = {
  key: string;
  label: string;
  description: string;
  evidenceCount: number;
  totalStrength: number;
  latestRecordedAt: string;
  sources: Set<ProfileRecordSource>;
};

const sourceOrder: readonly ProfileRecordSource[] = ["diagnosis", "diary"];

/**
 * 診断・日記の読み取り用レコードを、画面表示用のサマリーへ決定的に変換する。
 * 同じ入力なら候補の並びと文章は常に同じになり、生成結果自体は保存しない。
 */
export function generateProfileSummary(
  records: readonly ProfileRecord[],
  generatedAt = new Date().toISOString(),
): ProfileSummary {
  const candidates = new Map<string, Candidate>();

  for (const record of records) {
    for (const observation of record.observations) {
      const current = candidates.get(observation.key);
      if (current) {
        current.evidenceCount += 1;
        current.totalStrength += observation.strength;
        current.sources.add(record.source);
        if (record.recordedAt > current.latestRecordedAt) {
          current.latestRecordedAt = record.recordedAt;
          current.label = observation.label;
          current.description = observation.description;
        }
      } else {
        candidates.set(observation.key, {
          key: observation.key,
          label: observation.label,
          description: observation.description,
          evidenceCount: 1,
          totalStrength: observation.strength,
          latestRecordedAt: record.recordedAt,
          sources: new Set([record.source]),
        });
      }
    }
  }

  const insights = [...candidates.values()]
    .sort(
      (left, right) =>
        right.evidenceCount - left.evidenceCount ||
        right.totalStrength - left.totalStrength ||
        right.latestRecordedAt.localeCompare(left.latestRecordedAt) ||
        left.key.localeCompare(right.key),
    )
    .slice(0, 3)
    .map(({ sources, totalStrength: _totalStrength, latestRecordedAt: _latest, ...candidate }) => ({
      ...candidate,
      sources: sourceOrder.filter((source) => sources.has(source)),
    }));

  const latestRecordedAt = records.reduce<string | null>(
    (latest, record) => (!latest || record.recordedAt > latest ? record.recordedAt : latest),
    null,
  );

  return {
    generatedAt,
    headline:
      insights.length > 0
        ? "最近の記録から、こんなあなたらしさが見えています"
        : "記録が増えると、あなたらしさをここにまとめます",
    insights,
    recordCount: records.length,
    diagnosisCount: records.filter(({ source }) => source === "diagnosis").length,
    diaryCount: records.filter(({ source }) => source === "diary").length,
    latestRecordedAt,
  };
}
