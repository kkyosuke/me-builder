export type TurnDeliveryKind = "final" | "failure";

export type TurnDeliveryRequest = {
  turnId: string;
  generationEpoch: number;
  leaseToken: string;
  kind: TurnDeliveryKind;
  text: string;
};

export type TurnDeliveryResult =
  | { status: "delivered" }
  | { status: "lease_expired" }
  | { status: "superseded" }
  | { status: "permanent_failure" };

export type GenerationLease =
  | { acquired: true; leaseToken: string; hardDeadlineAt: number }
  | { acquired: false; reason: "busy" | "stale" | "completed" };

/** APIとgenerate Workerが利用するConversationCoordinatorの公開RPC契約。 */
export interface ConversationCoordinatorRpc {
  acceptMessage(input: {
    accountId: string;
    sourceRecordId: string;
    eventId: string;
    receivedAt: string;
    /** フローを後続Queueまで追跡する相関ID。省略形は旧callerとの互換用。 */
    traceId?: string;
  }): Promise<{ accepted: boolean }>;
  acquireGeneration(turnId: string, generationEpoch: number): Promise<GenerationLease>;
  requeueTurn(turnId: string, generationEpoch: number): Promise<void>;
  isGenerationLeaseActive(
    turnId: string,
    generationEpoch: number,
    leaseToken: string,
  ): Promise<boolean>;
  deliverTurn(input: TurnDeliveryRequest): Promise<TurnDeliveryResult>;
  completeGeneration(turnId: string, generationEpoch: number, leaseToken: string): Promise<boolean>;
  failGeneration(turnId: string, generationEpoch: number, leaseToken: string): Promise<void>;
  releaseGeneration(turnId: string, generationEpoch: number, leaseToken: string): Promise<void>;
}

/** 外部scriptのDurable Object bindingでも利用できる最小namespace契約。 */
export interface ConversationCoordinatorNamespace {
  getByName(name: string): ConversationCoordinatorRpc;
}
