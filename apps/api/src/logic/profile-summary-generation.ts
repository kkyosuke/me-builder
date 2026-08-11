import { type AccountDataNamespace, type D1, accountDataFor } from "@me-builder/lib";
import type { ProfileSummaryGenerationQueueMessage, Queue } from "@me-builder/shared";
import { createLiffSession } from "./liff-session";

export type RequestProfileSummaryGenerationOutcome =
  | Readonly<{
      type: "accepted";
      generationId: string;
      status: "queued" | "generating";
      created: boolean;
    }>
  | Readonly<{
      type: "unavailable";
      reason: "source_record_required" | "regeneration_not_required";
    }>
  | Readonly<{ type: "not-configured" }>
  | Readonly<{ type: "unauthenticated"; reason: string }>
  | Readonly<{ type: "account-not-found" }>;

type Params = Readonly<{
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: D1.shared.Client;
  accountData?: AccountDataNamespace;
  queue?: Queue<ProfileSummaryGenerationQueueMessage>;
  at?: Date;
  allowUnchangedRegeneration?: boolean;
}>;

export async function requestProfileSummaryGeneration({
  idToken,
  lineLoginChannelId,
  db,
  accountData,
  queue,
  at = new Date(),
  allowUnchangedRegeneration = false,
}: Params): Promise<RequestProfileSummaryGenerationOutcome> {
  const session = await createLiffSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") return session;
  if (!accountData || !queue) throw new Error("Profile Summary generation binding is missing");
  const account = accountDataFor(accountData, session.session.accountId);
  const request = await account.execute(
    "profileSummary.requestGeneration",
    at,
    allowUnchangedRegeneration,
  );
  if (request.outcome === "unavailable") return { type: "unavailable", reason: request.reason };
  if (request.outcome === "created") {
    try {
      await queue.send({
        type: "profile-summary-generation",
        accountId: session.session.accountId,
        generationId: request.generationId,
      });
    } catch (error) {
      await account.execute(
        "profileSummary.failGeneration",
        request.generationId,
        "生成処理を開始できませんでした。時間をおいて再試行してください。",
      );
      throw error;
    }
  }
  return {
    type: "accepted",
    generationId: request.generationId,
    status: request.status,
    created: request.outcome === "created",
  };
}
