export type UtsushiProgression = Readonly<{
  level: number;
  growthValue: number;
  currentLevelThreshold: number;
  nextLevelThreshold: number;
  collectedPieces: number;
  activePieces: number;
  categoryCount: number;
  calculationVersion: number;
  highestLevel: number;
  recentChanges: readonly UtsushiProgressionChange[];
}>;

export type UtsushiProgressionChange = Readonly<{
  kind: "new_piece" | "evidence_deepened" | "temporal_change";
  growthDelta: number;
  occurredAt: string;
}>;

export function progressionPercentage(progression: UtsushiProgression): number {
  const levelRange = progression.nextLevelThreshold - progression.currentLevelThreshold;
  if (levelRange <= 0) return 0;
  const levelGrowth = progression.growthValue - progression.currentLevelThreshold;
  return Math.min(100, Math.max(0, (levelGrowth / levelRange) * 100));
}

export function growthUntilNextLevel(progression: UtsushiProgression): number {
  return Math.max(0, progression.nextLevelThreshold - progression.growthValue);
}
