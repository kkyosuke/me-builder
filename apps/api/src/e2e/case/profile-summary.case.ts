import type { E2eCase } from "./e2e-case";

export const profileSummaryCases = {
  readVersions: {
    id: "SUMMARY-001",
    name: "本人の記録がある場合に保存済み版と現在の読み取り状態を返すこと",
    in: {
      method: "GET",
      path: "/api/profile-summary",
      authorization: "Bearer known-token",
      setup: ["migrationを適用", "本人AccountへSource Recordを1件登録"],
    },
    out: {
      status: 200,
      body: {
        versionCount: 3,
        latestVersionCount: 1,
        availableDataCounts: { diagnosis: 3, diary: 6 },
        generation: { status: "idle", canRegenerate: false, reasons: [], message: null },
      },
    },
  },
  noRecords: {
    id: "SUMMARY-002",
    name: "本人の記録がない場合は保存済み版を返さないこと",
    in: {
      method: "GET",
      path: "/api/profile-summary",
      authorization: "Bearer known-token",
      setup: ["migrationを適用", "本人AccountへSource Recordを登録しない"],
    },
    out: {
      status: 200,
      body: {
        versionCount: 0,
        availableDataCounts: { diagnosis: 0, diary: 0 },
      },
    },
  },
} as const satisfies Readonly<Record<string, E2eCase>>;
