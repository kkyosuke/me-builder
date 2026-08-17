import { D1 } from "@me-builder/lib";
import { ApplicationSessionService } from "../../logic/authentication/application-session";
import type { AppEnv } from "../../types";
import { D1AccountSessionVersionProvider } from "./d1-account-session-version-provider";
import { KvApplicationSessionStore } from "./kv-application-session-store";

export const APPLICATION_SESSION_COOKIE = "__Host-me_builder_session";
export const CSRF_HEADER = "X-CSRF-Token";

export function createApplicationSessionService(env: AppEnv["Bindings"] | undefined) {
  if (!env?.DB || !env.SESSION_STORE) return undefined;
  const db = D1.shared.client.create(env.DB);
  return {
    db,
    sessions: new ApplicationSessionService(
      new KvApplicationSessionStore(env.SESSION_STORE),
      new D1AccountSessionVersionProvider(db),
    ),
  };
}
