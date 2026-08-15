export type CompatibilityTheme = {
  id: string;
  title: string;
  axis: string;
  leftLabel: string;
  rightLabel: string;
  position: number;
  statement: string;
  request: string;
  band: "low" | "balanced" | "high";
};

export type CompatibilityPerson = {
  name: string;
  initial: string;
  color: "sky" | "violet";
  profileGeneratedAt: string;
  statements: string[];
  themes: CompatibilityTheme[];
};
