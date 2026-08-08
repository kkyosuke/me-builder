export type ProfileRecordSource = "diagnosis" | "diary";

/** 前段の記録処理からサマリー生成へ渡す、入力元に依存しない読み取り用レコード。 */
export type ProfileRecord = Readonly<{
  id: string;
  source: ProfileRecordSource;
  title: string;
  recordedAt: string;
  observations: readonly Readonly<{
    key: string;
    label: string;
    description: string;
    strength: number;
  }>[];
}>;

export type ProfileSummary = Readonly<{
  generatedAt: string;
  headline: string;
  insights: readonly Readonly<{
    key: string;
    label: string;
    description: string;
    evidenceCount: number;
    sources: readonly ProfileRecordSource[];
  }>[];
  recordCount: number;
  diagnosisCount: number;
  diaryCount: number;
  latestRecordedAt: string | null;
}>;
