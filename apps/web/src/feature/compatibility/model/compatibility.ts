export type CompatibilityTheme = {
  id: string;
  title: string;
  axis: string;
  leftLabel: string;
  rightLabel: string;
  position: number;
  statement: string;
  request: string;
};

export type CompatibilityPerson = {
  name: string;
  initial: string;
  color: "sky" | "violet";
  themes: CompatibilityTheme[];
};

export type CompatibilityListData = {
  owner: CompatibilityPerson;
  available: {
    partner: CompatibilityPerson;
    comparableThemeCount: number;
    href: string;
  };
  diagnosisWaiting: {
    name: string;
    href: string;
  };
};
