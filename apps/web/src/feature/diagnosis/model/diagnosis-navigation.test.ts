import { describe, expect, it } from "vitest";
import type { DiagnosisListItem } from "./diagnosis-list-item";
import {
  applySavedProgress,
  diagnosisResultIdFromPathname,
  isDiagnosisResultPathname,
  resolveDiagnosisDestination,
} from "./diagnosis-navigation";

const diagnosis: DiagnosisListItem = {
  id: "diagnosis-1",
  title: "診断",
  description: "説明",
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

  it("未完了かつ受付終了なら案内へ進む", () => {
    expect(resolveDiagnosisDestination({ ...diagnosis, availability: "closed" })).toBe("closed");
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
