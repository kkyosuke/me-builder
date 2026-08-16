import { D1 } from "@me-builder/lib";
import type { AccountSessionInvalidator } from "../../logic/account-recovery";
import type { AccountSessionVersionProvider } from "../../logic/authentication/application-session";

export class D1AccountSessionVersionProvider
  implements AccountSessionVersionProvider, AccountSessionInvalidator
{
  constructor(private readonly db: D1.shared.Client) {}

  async current(accountId: string): Promise<number | undefined> {
    return await D1.shared.action.accountSession.findActiveAccountSessionVersion(
      this.db,
      accountId,
    );
  }

  async invalidate(accountId: string): Promise<void> {
    await D1.shared.action.accountSession.invalidateAccountSessions(this.db, accountId);
  }

  async invalidateAccountSessions(accountId: string): Promise<void> {
    await this.invalidate(accountId);
  }
}
