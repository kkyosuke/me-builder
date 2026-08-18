export type GoalFollowUpStatus = "active" | "completed" | "stopped";

export type GoalFollowUpItem = Readonly<{
  id: string;
  brainItemId: string;
  goal: string;
  nextStep: string;
  status: GoalFollowUpStatus;
  agreedAt: string;
  updatedAt: string;
}>;

export type GoalFollowUpResult = Readonly<{
  items: readonly GoalFollowUpItem[];
  candidates: readonly Readonly<{ brainItemId: string; goal: string }>[];
  canManage: boolean;
  activeLimit: 1 | null;
}>;
