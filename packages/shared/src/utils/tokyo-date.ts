const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** UTC timestampをDSTのないAsia/Tokyoの日付へ変換する。 */
export function toTokyoLocalDate(timestamp: number): string {
  if (!Number.isFinite(timestamp)) throw new Error("Timestamp is invalid");
  return new Date(timestamp + JST_OFFSET_MS).toISOString().slice(0, 10);
}
