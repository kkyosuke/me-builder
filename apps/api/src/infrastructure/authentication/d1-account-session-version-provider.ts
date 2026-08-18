import { D1 } from "@me-builder/lib";
import { OperationalError } from "@me-builder/shared";
import type { AccountSessionVersionProvider } from "../../logic/authentication/application-session";

export class D1AccountSessionVersionProvider implements AccountSessionVersionProvider {
  constructor(private readonly db: D1.shared.Client) {}

  async current(accountId: string): Promise<number | undefined> {
    try {
      return await D1.shared.action.accountSession.findActiveAccountSessionVersion(
        this.db,
        accountId,
      );
    } catch (error) {
      throw sessionVersionError(
        "SESSION_VERSION_READ_FAILED",
        "authentication.session.version.read",
        error,
      );
    }
  }

  async invalidate(accountId: string): Promise<number | undefined> {
    try {
      return await D1.shared.action.accountSession.invalidateAccountSessions(this.db, accountId);
    } catch (error) {
      throw sessionVersionError(
        "SESSION_VERSION_INVALIDATION_FAILED",
        "authentication.session.version.invalidate",
        error,
      );
    }
  }

  async invalidateAccountSessions(accountId: string): Promise<void> {
    await this.invalidate(accountId);
  }
}

function sessionVersionError(code: string, stage: string, cause: unknown): OperationalError {
  return new OperationalError(
    { code, category: "dependency", stage, retryable: true, dependency: "cloudflare-d1" },
    cause,
  );
}
