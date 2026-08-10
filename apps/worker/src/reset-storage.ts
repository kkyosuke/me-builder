import type { Env } from "./types";

function assertPreviewResetAuthorized(env: Env, token: string): void {
  if (
    env.ENVIRONMENT !== "preview" ||
    !env.PREVIEW_RESET_TOKEN ||
    token !== env.PREVIEW_RESET_TOKEN
  ) {
    throw new Error("Durable Object storage reset is not authorized");
  }
}

/** Preview reset実行中だけ、namespaceを維持したまま1 DO instanceのstorageを空にする。 */
export async function resetDurableObjectStorage(
  state: DurableObjectState,
  env: Env,
  token: string,
): Promise<void> {
  assertPreviewResetAuthorized(env, token);
  await state.storage.deleteAlarm();
  await state.storage.deleteAll();
}

/** deleteAll前のin-memory stateを残さないため、削除完了後にinstanceを再起動する。 */
export function restartDurableObjectAfterReset(
  state: DurableObjectState,
  env: Env,
  token: string,
): never {
  assertPreviewResetAuthorized(env, token);
  state.abort("Preview storage reset completed");
  throw new Error("Durable Object abort unexpectedly returned");
}
