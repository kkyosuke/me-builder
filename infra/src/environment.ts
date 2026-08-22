const environments = ["preview", "production"] as const;

export type Environment = (typeof environments)[number];

export function parseEnvironment(value: string): Environment {
  if (!environments.includes(value as Environment)) {
    throw new Error(`Unsupported environment: ${value}`);
  }
  return value as Environment;
}

export function resourceNames(environment: Environment) {
  return {
    database: `me-builder-db-${environment}`,
    avatarBucket: `me-builder-avatar-${environment}`,
    photoDiaryBucket: `me-builder-photo-diary-${environment}`,
    sessionStore: `me-builder-session-${environment}`,
    queues: {
      webhook: `me-builder-webhook-queue-${environment}`,
      webhookDeadLetter: `me-builder-webhook-dlq-${environment}`,
      photoDiaryDeletion: `me-builder-photo-diary-deletion-queue-${environment}`,
      photoDiaryDeletionDeadLetter: `me-builder-photo-diary-deletion-dlq-${environment}`,
      billing: `me-builder-billing-queue-${environment}`,
      billingDeadLetter: `me-builder-billing-dlq-${environment}`,
      chatTurn: `me-builder-chat-turn-queue-${environment}`,
      chatTurnDeadLetter: `me-builder-chat-turn-dlq-${environment}`,
      brainCheckpoint: `me-builder-brain-checkpoint-queue-${environment}`,
      brainCheckpointDeadLetter: `me-builder-brain-checkpoint-dlq-${environment}`,
      profileSummary: `me-builder-profile-summary-queue-${environment}`,
      profileSummaryDeadLetter: `me-builder-profile-summary-dlq-${environment}`,
      brainVector: `me-builder-brain-vector-queue-${environment}`,
      brainVectorDeadLetter: `me-builder-brain-vector-dlq-${environment}`,
      dailyPrompt: `me-builder-daily-prompt-queue-${environment}`,
      dailyPromptDeadLetter: `me-builder-daily-prompt-dlq-${environment}`,
    },
  } as const;
}
