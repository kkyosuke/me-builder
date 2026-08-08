import type { ProfileRecord } from "../model/profile-summary";

const records: readonly ProfileRecord[] = [
  {
    id: "diagnosis-time-planning",
    source: "diagnosis",
    title: "時間と予定の診断",
    recordedAt: "2026-08-02T10:00:00.000Z",
    observations: [
      {
        key: "prepare-first",
        label: "見通しを持って動く",
        description: "予定の前に準備を整え、見通しを持って進めることを大切にしています。",
        strength: 0.9,
      },
      {
        key: "own-pace",
        label: "自分のペースを守る",
        description: "無理に周囲へ合わせず、自分に合うペースを選びやすいようです。",
        strength: 0.7,
      },
    ],
  },
  {
    id: "diary-project-release",
    source: "diary",
    title: "リリース前の一日",
    recordedAt: "2026-08-06T12:30:00.000Z",
    observations: [
      {
        key: "prepare-first",
        label: "見通しを持って動く",
        description: "先の段取りが見えると安心して力を発揮できる傾向があります。",
        strength: 0.8,
      },
      {
        key: "talk-to-organize",
        label: "話しながら整理する",
        description: "考えが絡まったときは、誰かに話すことで気持ちを整理しています。",
        strength: 0.8,
      },
    ],
  },
  {
    id: "diagnosis-relationship",
    source: "diagnosis",
    title: "自分と相手の境界線",
    recordedAt: "2026-08-07T09:15:00.000Z",
    observations: [
      {
        key: "own-pace",
        label: "自分のペースを守る",
        description: "相手を尊重しながらも、自分の余裕を確かめて選ぶことを大切にしています。",
        strength: 0.85,
      },
    ],
  },
  {
    id: "diary-team-talk",
    source: "diary",
    title: "チームで相談した日",
    recordedAt: "2026-08-08T11:45:00.000Z",
    observations: [
      {
        key: "talk-to-organize",
        label: "話しながら整理する",
        description: "一人で抱え続けるより、信頼できる人との対話で次の一歩を見つけています。",
        strength: 0.9,
      },
    ],
  },
];

/** 実データ接続までの画面確認用adapter。呼び出し側は取得元を意識しない。 */
export async function loadProfileRecords(signal?: AbortSignal): Promise<readonly ProfileRecord[]> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return records;
}
