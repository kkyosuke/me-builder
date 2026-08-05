import { describe, expect, it } from "vitest";
import type { SurveyListItem } from "./survey-list-item";
import { applySavedProgress, resolveSurveyDestination } from "./survey-navigation";

const survey: SurveyListItem = {
  id: "survey-1",
  title: "アンケート",
  description: "説明",
  opensAt: "2026-08-05T00:00:00.000Z",
  closesAt: null,
  availability: "open",
  responseStatus: "unanswered",
  answeredCount: 0,
  questionCount: 10,
};

describe("resolveSurveyDestination", () => {
  it("回答済みなら受付終了後も結果へ進む", () => {
    expect(
      resolveSurveyDestination({ ...survey, availability: "closed", responseStatus: "answered" }),
    ).toBe("result");
  });

  it("未完了かつ受付終了なら案内へ進む", () => {
    expect(resolveSurveyDestination({ ...survey, availability: "closed" })).toBe("closed");
  });
});

describe("applySavedProgress", () => {
  it("保存レスポンスの到着順が前後しても回答数を巻き戻さない", () => {
    expect(
      applySavedProgress(
        { ...survey, responseStatus: "in-progress", answeredCount: 4 },
        { responseStatus: "in-progress", answeredCount: 3, questionCount: 10 },
      ),
    ).toMatchObject({ responseStatus: "in-progress", answeredCount: 4, questionCount: 10 });
  });

  it("全問保存済みなら回答済みにする", () => {
    expect(
      applySavedProgress(survey, {
        responseStatus: "answered",
        answeredCount: 10,
        questionCount: 10,
      }),
    ).toMatchObject({ responseStatus: "answered", answeredCount: 10 });
  });
});
