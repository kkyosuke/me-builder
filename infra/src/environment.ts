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
    queues: {
      webhook: `me-builder-webhook-queue-${environment}`,
      webhookDeadLetter: `me-builder-webhook-dlq-${environment}`,
      chatTurn: `me-builder-chat-turn-queue-${environment}`,
      chatTurnDeadLetter: `me-builder-chat-turn-dlq-${environment}`,
      brainCheckpoint: `me-builder-brain-checkpoint-queue-${environment}`,
      brainCheckpointDeadLetter: `me-builder-brain-checkpoint-dlq-${environment}`,
    },
  } as const;
}
