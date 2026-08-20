import type { Context } from "hono";
import { isDevelopmentEnvironment } from "../config";
import { authenticatedSession } from "../middleware/authentication";
import type { AppEnv } from "../types";

const DEVELOPMENT_RECENT_AUTHENTICATION_MS = 10 * 60 * 1000;

/** 開発用routeはPreview系環境の管理者にだけ存在を公開する。 */
export function developmentAdminRouteIsAvailable(c: Context<AppEnv>): boolean {
  const explicitEnvironment = c.env?.ENVIRONMENT?.trim();
  return Boolean(
    explicitEnvironment &&
      isDevelopmentEnvironment(explicitEnvironment) &&
      authenticatedSession(c).accountRole === "admin",
  );
}

/** 破壊的な開発操作に、直近10分以内の本人確認を要求する。 */
export function hasRecentDevelopmentAuthentication(c: Context<AppEnv>, now = new Date()): boolean {
  const authenticatedAt = authenticatedSession(c).actor.authenticatedAt.getTime();
  const age = now.getTime() - authenticatedAt;
  return age >= 0 && age <= DEVELOPMENT_RECENT_AUTHENTICATION_MS;
}
