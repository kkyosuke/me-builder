type BrainItemEvidence = {
  sourceRecordId: string;
  relation: "supports" | "contradicts";
  derivationMethod: "ai" | "deterministic";
  generatedAt: string;
  recordedAt: string;
};

type BrainItem = {
  id: string;
  category: string;
  statement: string;
  derivation: "ai" | "deterministic";
  status: "active";
  createdAt: string;
  firstObservedAt: string;
  lastObservedAt: string;
  vectorSync: {
    status: "pending" | "submitted" | "applied" | "failed" | "not-scheduled";
    operation?: "upsert" | "delete" | undefined;
    attemptCount: number;
    updatedAt?: string | undefined;
    nextAttemptAt?: string | undefined;
    failureCode?: string | undefined;
    hasEntry: boolean;
    entryRevision?: number | undefined;
  };
  evidence: BrainItemEvidence[];
};

export type DevelopmentBrainItemsResult = {
  items: BrainItem[];
  truncated: boolean;
};

export type DevelopmentBrainVectorResult =
  | { state: "not-synced"; checkedAt: string }
  | { state: "missing"; entryRevision: number; checkedAt: string }
  | {
      state: "present";
      entryRevision: number;
      dimensions: number;
      metadata: {
        category?: string | undefined;
        derivation?: "ai" | "deterministic" | undefined;
        embeddingVersion?: number | undefined;
        schemaVersion?: number | undefined;
      };
      checkedAt: string;
    };
