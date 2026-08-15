import { describe, expect, it } from "vitest";
import { growthUntilNextLevel, progressionPercentage } from "./progression";

describe("progression presentation values", () => {
  it("現在レベル内の進捗率と次のレベルまでの値を返す", () => {
    const progression = {
      level: 12,
      growthValue: 613,
      currentLevelThreshold: 605,
      nextLevelThreshold: 720,
      collectedPieces: 58,
      activePieces: 48,
      categoryCount: 6,
      calculationVersion: 1,
      highestLevel: 12,
      recentChanges: [],
    };

    expect(growthUntilNextLevel(progression)).toBe(107);
    expect(progressionPercentage(progression)).toBeCloseTo((8 / 115) * 100);
  });

  it("範囲外の進捗率を表示可能な範囲へ丸める", () => {
    const base = {
      level: 1,
      currentLevelThreshold: 0,
      nextLevelThreshold: 5,
      collectedPieces: 0,
      activePieces: 0,
      categoryCount: 0,
      calculationVersion: 1,
      highestLevel: 1,
      recentChanges: [],
    };

    expect(progressionPercentage({ ...base, growthValue: -1 })).toBe(0);
    expect(progressionPercentage({ ...base, growthValue: 6 })).toBe(100);
  });
});
