export type ReceiptReservation = {
  accountId: string;
  eventId: string;
  receivedAt: string;
};

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
  }): Promise<{ accepted: boolean }>;
  reserveReceipt(input: ReceiptReservation): Promise<{ accepted: boolean }>;
  acquireGeneration(turnId: string, generationEpoch: number): Promise<GenerationLease>;
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
