import { D1 } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import { createLiffSession } from "./liff-session";

export type AdminAccountsOutcome =
  | { type: "not-configured" | "unauthenticated" | "account-not-found" }
  | { type: "forbidden" | "invalid-request" }
  | {
      type: "resolved";
      page: Awaited<ReturnType<typeof D1.shared.action.adminAccount.listAdminAccounts>>;
    };

type Params = Readonly<{
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  adminLineUserIds: readonly string[];
  db: D1.shared.Client;
  input: Parameters<typeof D1.shared.action.adminAccount.listAdminAccounts>[1];
  createSession?: typeof createLiffSession;
  listAccounts?: typeof D1.shared.action.adminAccount.listAdminAccounts;
}>;

export async function getAdminAccounts(params: Params): Promise<AdminAccountsOutcome> {
  const session = await (params.createSession ?? createLiffSession)({
    idToken: params.idToken,
    lineLoginChannelId: params.lineLoginChannelId,
    adminLineUserIds: params.adminLineUserIds,
    db: params.db,
  });
  if (session.type !== "resolved") return { type: session.type };
  if (session.session.role !== "admin") return { type: "forbidden" };
  try {
    const input = params.input ?? {};
    const page = await (params.listAccounts ?? D1.shared.action.adminAccount.listAdminAccounts)(
      params.db,
      input,
    );
    logger.info(
      {
        event: "admin.accounts.listed",
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
