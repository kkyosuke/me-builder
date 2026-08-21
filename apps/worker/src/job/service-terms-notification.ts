import { D1 } from "@me-builder/lib";
import {
  getServiceTermsNotice,
  serviceTermsAnnouncements,
  serviceTermsDocuments,
} from "@me-builder/shared";
import type { WorkerConfig } from "../config";
import {
  createLineRetryKey,
  getLineDeliveryFailureKind,
  pushLineTextWithRetryKey,
} from "../infrastructure/line-delivery";

const ACCOUNT_PAGE_SIZE = 100;

export function buildServiceTermsAnnouncementText(input: {
  effectiveAt: string;
  summary: string;
  liffId: string;
}): string {
  return [
    "利用規約の重要な改定を予定しています。",
    `適用日: ${input.effectiveAt.slice(0, 10)}`,
    input.summary,
    "適用日までは現在の規約で利用できます。内容はこちらから確認できます。",
    `https://liff.line.me/${input.liffId}/terms`,
  ].join("\n");
}

/** 14日前から適用日前まで、対象Accountへ決定的retry key付きで一度だけLINE告知する。 */
export async function notifyUpcomingServiceTerms(
  input: Readonly<{
    db: D1.shared.Client;
    config: WorkerConfig;
    now: Date;
  }>,
): Promise<number> {
  const notice = getServiceTermsNotice(serviceTermsDocuments, serviceTermsAnnouncements, input.now);
  if (notice?.type !== "important-upcoming") return 0;
  if (
    !input.config.lineChannelAccessToken ||
    !input.config.liffId ||
    !input.config.chatDeliverySecret
  ) {
    throw new Error("Service terms LINE notification is not configured");
  }

  const text = buildServiceTermsAnnouncementText({
    effectiveAt: notice.effectiveAt,
    summary: notice.document.summary,
    liffId: input.config.liffId,
  });
  let afterAccountId: string | undefined;
  let completed = 0;

  while (true) {
    const recipients = await D1.shared.action.termsNotification.listPendingTermsLineRecipients(
      input.db,
      {
        documentVersion: notice.document.version,
        at: input.now,
        ...(afterAccountId ? { afterAccountId } : {}),
        limit: ACCOUNT_PAGE_SIZE,
      },
    );
    if (recipients.length === 0) return completed;
    for (const recipient of recipients) {
      const retryKey = await createLineRetryKey(
        input.config.chatDeliverySecret,
        `service-terms:${notice.document.version}:${recipient.accountId}`,
      );
      let disposition: "delivered" | "rejected" = "delivered";
      try {
        await pushLineTextWithRetryKey({
          channelAccessToken: input.config.lineChannelAccessToken,
          to: recipient.providerAccountId,
          texts: [text],
          retryKey,
        });
      } catch (error) {
        if (getLineDeliveryFailureKind(error) !== "permanent") throw error;
        disposition = "rejected";
      }
      await D1.shared.action.termsNotification.recordTermsLineNotification(input.db, {
        accountId: recipient.accountId,
        documentVersion: notice.document.version,
        disposition,
        deliveredAt: input.now,
      });
      completed += 1;
    }
    afterAccountId = recipients.at(-1)?.accountId;
    if (recipients.length < ACCOUNT_PAGE_SIZE) return completed;
  }
}
