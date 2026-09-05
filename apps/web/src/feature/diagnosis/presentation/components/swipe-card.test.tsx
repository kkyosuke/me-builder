// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiagnosisQuestion } from "../../model/types";
import { SwipeCard } from "./swipe-card";

const frontQuestion: Exclude<DiagnosisQuestion, { format: "likert_5" }> = {
  diagnosisQuestionId: "dq-front",
  questionId: "q-front",
  questionVersion: 1,
  text: "休日は家で過ごすことが多い？",
  left: { choiceId: "no", label: "いいえ" },
  right: { choiceId: "yes", label: "はい" },
};

const backsideQuestion: Exclude<DiagnosisQuestion, { format: "likert_5" }> = {
  ...frontQuestion,
  diagnosisQuestionId: "dq-back",
  questionId: "q-back",
  text: "休日は家で過ごしたい？",
  backsideOfDiagnosisQuestionId: "dq-front",
};

afterEach(() => cleanup());

describe("SwipeCard drag preview", () => {
  it("表カードを右へドラッグしても移動せず、右方向への回転を予告する", () => {
    const { container } = render(
      <SwipeCard
        question={frontQuestion}
        backsideQuestion={backsideQuestion}
        face="behavior"
        depth={0}
        drag={{ dx: 50, dy: 10 }}
        flyOut={null}
        turnOver={null}
        cardWidth={320}
        threshold={100}
        reducedMotion={false}
        disabled={false}
        onSelect={vi.fn()}
      />,
    );

    const card = container.firstElementChild as HTMLElement;
    const flipper = card.firstElementChild as HTMLElement;

    expect(card.style.transform).toBe("translate3d(0, 0px, 0) scale(1.00)");
    expect(flipper.style.transform).toBe("rotateY(36.00deg)");
    expect(container.querySelector('[data-card-face="value"]')?.className).toContain(
      "bg-violet-50",
    );
  });

  it("裏面のないカードは従来どおりドラッグ方向へ移動する", () => {
    const { container } = render(
      <SwipeCard
        question={frontQuestion}
        face="single"
        depth={0}
        drag={{ dx: 50, dy: 10 }}
        flyOut={null}
        turnOver={null}
        cardWidth={320}
        threshold={100}
        reducedMotion={false}
        disabled={false}
        onSelect={vi.fn()}
      />,
    );

    const card = container.firstElementChild as HTMLElement;
    const flipper = card.firstElementChild as HTMLElement;

    expect(card.style.transform).toContain("translate3d(50px, 4px, 0)");
    expect(flipper.style.transform).toBe("");
  });
});
