const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** UTC timestampをDSTのないAsia/Tokyoの日付へ変換する。 */
export function toTokyoLocalDate(timestamp: number): string {
  if (!Number.isFinite(timestamp)) throw new Error("Timestamp is invalid");
  return new Date(timestamp + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** UTC timestampをDSTのないAsia/Tokyoの0〜23時へ変換する。 */
export function toTokyoLocalHour(timestamp: number): number {
  if (!Number.isFinite(timestamp)) throw new Error("Timestamp is invalid");
  return new Date(timestamp + JST_OFFSET_MS).getUTCHours();
}
