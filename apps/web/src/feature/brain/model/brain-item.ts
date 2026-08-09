export type BrainItemEvidence = {
  sourceRecordId: string;
  relation: "supports" | "contradicts";
  derivationMethod: "ai" | "deterministic";
  generatedAt: string;
};

export type BrainItem = {
  id: string;
  category: string;
  statement: string;
  derivation: "ai" | "deterministic";
  status: "active";
  createdAt: string;
  evidence: BrainItemEvidence[];
};

export type DevelopmentBrainItemsResult = {
  items: BrainItem[];
  truncated: boolean;
};
