import type { Context } from "hono";
import * as v from "valibot";
import type { AppEnv, ResettableDurableObjectNamespace } from "../types";

export const PREVIEW_RESET_PATH = "/api/internal/preview-reset/durable-objects";

const ResetRequestSchema = v.object({
  className: v.picklist(["AccountData", "CompatibilityData", "ConversationCoordinator"]),
  objectIds: v.pipe(v.array(v.pipe(v.string(), v.minLength(1))), v.maxLength(100)),
});

function resetNamespace(
  env: Context<AppEnv>["env"],
  className: v.InferOutput<typeof ResetRequestSchema>["className"],
): ResettableDurableObjectNamespace | undefined {
  if (className === "AccountData") return env.ACCOUNT_DATA;
  if (className === "CompatibilityData") return env.COMPATIBILITY_DATA;
  return env.CONVERSATION_COORDINATOR;
}

/** workflowの一時tokenが配布されたPreviewでだけ、列挙済みDO storageを削除する。 */
export async function resetPreviewDurableObjects(c: Context<AppEnv>): Promise<Response> {
  const token = c.env.PREVIEW_RESET_TOKEN;
  if (
    c.env.ENVIRONMENT !== "preview" ||
    !token ||
    c.req.header("Authorization") !== `Bearer ${token}`
  ) {
    return c.notFound();
  }

  const body = await c.req.json().catch(() => undefined);
  const parsed = v.safeParse(ResetRequestSchema, body);
  if (!parsed.success) return c.json({ error: "Bad Request" }, 400);

  const namespace = resetNamespace(c.env, parsed.output.className);
  if (!namespace) return c.json({ error: "Durable Object binding is not configured" }, 503);

  const stubs = parsed.output.objectIds.map((objectId) =>
    namespace.get(namespace.idFromString(objectId)),
  );
  await Promise.all(stubs.map((stub) => stub.resetStorage(token)));

  // abortによるRPC rejectionは期待動作。deleteAll完了後なので全instanceを必ず再起動する。
  await Promise.allSettled(stubs.map((stub) => stub.restartAfterReset(token)));
  return c.json({ reset: parsed.output.objectIds.length });
}
