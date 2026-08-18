export type GoalFollowUpStatus = "active" | "completed" | "stopped";

export type GoalFollowUp = Readonly<{
  id: string;
  brainItemId: string;
  goal: string;
  nextStep: string;
  status: GoalFollowUpStatus;
  agreedAt: string;
  updatedAt: string;
}>;

export type GoalFollowUpCandidate = Readonly<{
  brainItemId: string;
  goal: string;
}>;

export type GoalFollowUpReadModel = Readonly<{
  items: readonly GoalFollowUp[];
  candidates: readonly GoalFollowUpCandidate[];
}>;

export type AgreeGoalFollowUpResult =
  | Readonly<{ type: "agreed"; item: GoalFollowUp }>
  | Readonly<{ type: "goal-not-found" | "goal-not-confirmed" | "active-limit-reached" }>;

export type UpdateGoalFollowUpResult =
  | Readonly<{ type: "updated"; item: GoalFollowUp }>
  | Readonly<{ type: "not-found" | "active-limit-reached" }>;
