import { selfCareConfirmationKinds } from "@me-builder/shared";
import * as v from "valibot";
import type { operations } from "../../../generated/api";
import { createAuthenticatedHttpClient } from "../../../infrastructure/http-client";
import type { SelfCareContextItem, SelfCareContextResult } from "../model/self-care-context";

type ApiList = operations["getSelfCareContexts"]["responses"][200]["content"]["application/json"];
type ApiMutation =
  operations["revokeSelfCareContext"]["responses"][200]["content"]["application/json"];

const Text = v.pipe(v.string(), v.trim(), v.nonEmpty());
const ItemSchema = v.object({
  id: Text,
  brainItemId: Text,
  statement: Text,
  kind: v.picklist(selfCareConfirmationKinds),
  status: v.picklist(["active", "revoked"]),
  confirmedAt: v.pipe(v.string(), v.isoTimestamp()),
  updatedAt: v.pipe(v.string(), v.isoTimestamp()),
});
const ListSchema = v.object({
  items: v.array(ItemSchema),
  canManage: v.boolean(),
}) satisfies v.GenericSchema<ApiList>;
const MutationSchema = v.object({ item: ItemSchema }) satisfies v.GenericSchema<ApiMutation>;

async function assertResponse(response: Response): Promise<Response> {
  if (response.ok) return response;
  if (response.status === 409) {
    const body = (await response.json().catch(() => null)) as { reason?: string } | null;
    if (body?.reason === "feature_unavailable") {
      throw new Error("個別化されたセルフケアはLite以上で利用できます。");
    }
    if (body?.reason === "not_confirmed") {
      throw new Error("本人が話した内容だけをセルフケア情報として確認できます。");
    }
  }
  throw new Error(`セルフケア情報を更新できませんでした (HTTP ${response.status})`);
}

export async function fetchSelfCareContexts(
  apiUrl: string | undefined,
  signal?: AbortSignal,
): Promise<SelfCareContextResult> {
  const response = await createAuthenticatedHttpClient(apiUrl).request("/api/self-care/contexts", {
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`セルフケア情報を取得できませんでした (HTTP ${response.status})`);
  }
  return v.parse(ListSchema, await response.json());
}

export async function revokeSelfCareContext(
  apiUrl: string | undefined,
  id: string,
): Promise<SelfCareContextItem> {
  const response = await assertResponse(
    await createAuthenticatedHttpClient(apiUrl).request(
      `/api/self-care/contexts/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
  );
  return v.parse(MutationSchema, await response.json()).item;
}
