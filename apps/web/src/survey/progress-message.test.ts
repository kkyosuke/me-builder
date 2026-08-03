import { describe, expect, it } from "vitest";
import {
  PROGRESS_MESSAGES,
  pickProgressMessage,
  resolveProgressMilestone,
} from "./progress-message";

describe("resolveProgressMilestone", () => {
  it("半分に達するまではメッセージを表示しない", () => {
    expect(resolveProgressMilestone(4, 10)).toBeNull();
  });

  it("半分へ到達した直後の1問だけ折り返し文言を使う", () => {
    expect(resolveProgressMilestone(5, 10)).toBe("halfway");
    expect(resolveProgressMilestone(6, 10)).toBeNull();
    expect(resolveProgressMilestone(7, 10)).toBeNull();
  });

  it("残り2割へ到達した直後の1問だけ終盤文言を使う", () => {
    expect(resolveProgressMilestone(8, 10)).toBe("almost-done");
    expect(resolveProgressMilestone(9, 10)).toBeNull();
    expect(resolveProgressMilestone(10, 10)).toBeNull();
  });

  it("問数に端数がある場合は各割合へ到達した最初の問数で表示する", () => {
    expect(resolveProgressMilestone(3, 5)).toBe("halfway");
    expect(resolveProgressMilestone(4, 5)).toBe("almost-done");
  });

  it("全体が0問ならメッセージを表示しない", () => {
    expect(resolveProgressMilestone(0, 0)).toBeNull();
  });
});

describe("pickProgressMessage", () => {
  it("段階に対応した文言からランダム値に応じて選ぶ", () => {
    expect(pickProgressMessage("halfway", () => 0)).toBe(PROGRESS_MESSAGES.halfway[0]);
    expect(pickProgressMessage("almost-done", () => 0.999)).toBe(
      PROGRESS_MESSAGES["almost-done"][PROGRESS_MESSAGES["almost-done"].length - 1],
    );
  });
});
