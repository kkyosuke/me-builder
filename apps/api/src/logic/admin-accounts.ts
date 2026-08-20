import { D1 } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { AuthenticatedActor } from "./authentication/types";

export type AdminAccountsOutcome =
  | { type: "invalid-request" }
  | {
      type: "resolved";
      page: Awaited<ReturnType<typeof D1.shared.action.adminAccount.listAdminAccounts>>;
    };

type Params = Readonly<{
  actor: AuthenticatedActor;
  db: D1.shared.Client;
  input: Parameters<typeof D1.shared.action.adminAccount.listAdminAccounts>[1];
  auditEnabled?: boolean;
  listAccounts?: typeof D1.shared.action.adminAccount.listAdminAccounts;
  recordAudit?: typeof D1.shared.action.adminAccount.recordAdminAccountListAudit;
}>;

export async function getAdminAccounts(params: Params): Promise<AdminAccountsOutcome> {
  try {
    const input = params.input ?? {};
    const page = await (params.listAccounts ?? D1.shared.action.adminAccount.listAdminAccounts)(
      params.db,
      input,
    );
    const adminReference = await D1.shared.action.adminAccount.createAdminAccountReference(
      params.actor.accountId,
    );
    if (params.auditEnabled) {
      await (params.recordAudit ?? D1.shared.action.adminAccount.recordAdminAccountListAudit)(
        params.db,
        {
          adminReference,
          queryPresent: Boolean(input.query?.trim()),
          role: input.role ?? "all",
          status: input.status ?? "all",
          sort: input.sort ?? "created",
          resultCount: page.accounts.length,
          total: page.total,
        },
      );
    }
    logger.info(
      {
        event: "admin.accounts.listed",
        adminReference,
        queryPresent: Boolean(input.query?.trim()),
        role: input.role ?? "all",
        status: input.status ?? "all",
        sort: input.sort ?? "created",
        cursorPresent: Boolean(input.cursor),
        resultCount: page.accounts.length,
        total: page.total,
        fetchedAt: new Date().toISOString(),
      },
      "Admin listed accounts",
    );
    return {
      type: "resolved",
      page,
    };
  } catch (error) {
    if (error instanceof D1.shared.action.adminAccount.InvalidAdminAccountCursorError) {
      return { type: "invalid-request" };
    }
    throw error;
  }
}
