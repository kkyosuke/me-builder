import * as v from "valibot";
import type { operations } from "../../../generated/api";
import { createAuthenticatedHttpClient } from "../../../infrastructure/http-client";
import type {
  GoalFollowUpItem,
  GoalFollowUpResult,
  GoalFollowUpStatus,
} from "../model/goal-follow-up";

type ApiList = operations["getGoalFollowUps"]["responses"][200]["content"]["application/json"];
type ApiMutation = operations["agreeGoalFollowUp"]["responses"][200]["content"]["application/json"];

const Text = v.pipe(v.string(), v.trim(), v.nonEmpty());
const ItemSchema = v.object({
  id: Text,
  brainItemId: Text,
  goal: Text,
  nextStep: Text,
  status: v.picklist(["active", "completed", "stopped"]),
  agreedAt: v.pipe(v.string(), v.isoTimestamp()),
  updatedAt: v.pipe(v.string(), v.isoTimestamp()),
});
const ListSchema = v.object({
  items: v.array(ItemSchema),
  candidates: v.array(v.object({ brainItemId: Text, goal: Text })),
  canManage: v.boolean(),
  activeLimit: v.nullable(v.literal(1)),
}) satisfies v.GenericSchema<ApiList>;
const MutationSchema = v.object({ item: ItemSchema }) satisfies v.GenericSchema<ApiMutation>;

async function assertResponse(response: Response): Promise<Response> {
  if (response.ok) return response;
  if (response.status === 409) {
    const body = (await response.json().catch(() => null)) as { reason?: string } | null;
    if (body?.reason === "feature_unavailable") {
      throw new Error("行動のフォローアップはLite以上で利用できます。");
    }
    if (body?.reason === "active_limit") {
      throw new Error("Liteで継続できる行動は1件です。現在の行動を完了または停止してください。");
    }
    if (body?.reason === "goal_not_confirmed") {
      throw new Error("本人が確認した目標だけをフォローできます。");
    }
  }
  throw new Error(`行動のフォローアップを更新できませんでした (HTTP ${response.status})`);
}

export async function fetchGoalFollowUps(
  apiUrl: string | undefined,
  signal?: AbortSignal,
): Promise<GoalFollowUpResult> {
  const response = await createAuthenticatedHttpClient(apiUrl).request("/api/goal-follow-ups", {
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`行動のフォローアップを取得できませんでした (HTTP ${response.status})`);
  }
  return v.parse(ListSchema, await response.json());
}

export async function agreeGoalFollowUp(
  apiUrl: string | undefined,
  input: Readonly<{ brainItemId: string; nextStep: string }>,
): Promise<GoalFollowUpItem> {
  const response = await assertResponse(
    await createAuthenticatedHttpClient(apiUrl).request("/api/goal-follow-ups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
  return v.parse(MutationSchema, await response.json()).item;
}

export async function updateGoalFollowUp(
  apiUrl: string | undefined,
  id: string,
  input: Readonly<{ status?: GoalFollowUpStatus; nextStep?: string }>,
): Promise<GoalFollowUpItem> {
  const response = await assertResponse(
    await createAuthenticatedHttpClient(apiUrl).request(
      `/api/goal-follow-ups/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    ),
  );
  return v.parse(MutationSchema, await response.json()).item;
}
