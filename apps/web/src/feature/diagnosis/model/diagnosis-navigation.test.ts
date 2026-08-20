import { describe, expect, it } from "vitest";
import type { DiagnosisListItem } from "./diagnosis-list-item";
import {
  applySavedProgress,
  createDiagnosisDetailHistoryState,
  diagnosisDetailIdFromHistoryState,
  diagnosisEntryIdFromPathname,
  diagnosisResultIdFromPathname,
  isDiagnosisResultPathname,
  resolveDiagnosisDestination,
} from "./diagnosis-navigation";

const diagnosis: DiagnosisListItem = {
  id: "diagnosis-1",
  title: "診断",
  description: "説明",
  relationshipCategory: "general",
  opensAt: "2026-08-05T00:00:00.000Z",
  closesAt: null,
  displayOrder: 10,
  availability: "open",
  responseStatus: "unanswered",
  answeredCount: 0,
  questionCount: 10,
  lastAnsweredAt: null,
};

describe("resolveDiagnosisDestination", () => {
  it("回答済みなら受付終了後も結果へ進む", () => {
    expect(
      resolveDiagnosisDestination({
        ...diagnosis,
        availability: "closed",
        responseStatus: "answered",
      }),
    ).toBe("result");
  });

  it("未回答かつ受付終了なら案内へ進む", () => {
    expect(resolveDiagnosisDestination({ ...diagnosis, availability: "closed" })).toBe("closed");
  });

  it("途中回答がある受付終了後は保存済み回答へ進む", () => {
    expect(
      resolveDiagnosisDestination({
        ...diagnosis,
        availability: "closed",
        responseStatus: "in-progress",
        answeredCount: 3,
      }),
    ).toBe("answers");
  });
});

describe("diagnosisResultIdFromPathname", () => {
  it("回答結果の直接URLからDiagnosis IDを復元する", () => {
    expect(diagnosisResultIdFromPathname("/diagnosis/value%2Fwork/answers")).toBe("value/work");
  });

  it("別画面と不正なpercent encodingは直接URLとして扱わない", () => {
    expect(diagnosisResultIdFromPathname("/diagnosis")).toBeNull();
    expect(diagnosisResultIdFromPathname("/diagnosis/%E0%A4%A/answers")).toBeNull();
    expect(isDiagnosisResultPathname("/diagnosis/%E0%A4%A/answers")).toBe(true);
  });
});

describe("diagnosisEntryIdFromPathname", () => {
  it("対象診断の直接URLからDiagnosis IDを復元する", () => {
    expect(diagnosisEntryIdFromPathname("/diagnosis/value%2Fwork")).toBe("value/work");
  });

  it("一覧・結果・不正なpercent encodingを診断入口として扱わない", () => {
    expect(diagnosisEntryIdFromPathname("/diagnosis")).toBeNull();
    expect(diagnosisEntryIdFromPathname("/diagnosis/diagnosis-1/answers")).toBeNull();
    expect(diagnosisEntryIdFromPathname("/diagnosis/%E0%A4%A")).toBeNull();
  });
});

describe("diagnosis detail history state", () => {
  it("既存の履歴stateを残して診断IDを保存し、復元する", () => {
    const state = createDiagnosisDetailHistoryState({ existing: "value" }, "diagnosis-1");

    expect(state).toMatchObject({ existing: "value" });
    expect(diagnosisDetailIdFromHistoryState(state)).toBe("diagnosis-1");
  });

  it("診断詳細ではない履歴stateを無視する", () => {
    expect(diagnosisDetailIdFromHistoryState(null)).toBeNull();
    expect(diagnosisDetailIdFromHistoryState({})).toBeNull();
    expect(diagnosisDetailIdFromHistoryState({ "me-builder-diagnosis-detail-id": "" })).toBeNull();
  });
});

describe("applySavedProgress", () => {
  it("保存レスポンスの到着順が前後しても回答数を巻き戻さない", () => {
    expect(
      applySavedProgress(
        { ...diagnosis, responseStatus: "in-progress", answeredCount: 4 },
        { responseStatus: "in-progress", answeredCount: 3, questionCount: 10 },
      ),
    ).toMatchObject({ responseStatus: "in-progress", answeredCount: 4, questionCount: 10 });
  });

  it("全問保存済みなら回答済みにする", () => {
    expect(
      applySavedProgress(diagnosis, {
        responseStatus: "answered",
        answeredCount: 10,
        questionCount: 10,
        lastAnsweredAt: "2026-08-06T00:00:00.000Z",
      }),
    ).toMatchObject({
      responseStatus: "answered",
      answeredCount: 10,
      lastAnsweredAt: "2026-08-06T00:00:00.000Z",
    });
  });
});
