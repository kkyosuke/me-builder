import { type SQL, and, count, desc, eq, lt, or, sql } from "drizzle-orm";
import type { UtsushiProgression } from "../../../do/account/action/progression";
import type { SharedD1Client } from "../client";
import { accounts } from "../schema/account";
import { accountProfiles } from "../schema/profile";
import { accountProgressionProjections } from "../schema/progression";

export const UTSUSHI_PROGRESSION_CALCULATION_VERSION = 1;
export const ADMIN_ACCOUNT_PAGE_LIMIT = 50;
export const ADMIN_ACCOUNT_CURSOR_MAX_LENGTH = 512;

export type AdminAccountSort = "created" | "level" | "pieces" | "growth";

export type AdminAccountListInput = Readonly<{
  query?: string;
  role?: "user" | "admin";
  status?: "active";
  sort?: AdminAccountSort;
  cursor?: string;
  limit?: number;
}>;

type CursorPayload = Readonly<{
  sort: AdminAccountSort;
  value: string | number;
  accountId: string;
}>;

export class InvalidAdminAccountCursorError extends Error {
  constructor() {
    super("Admin Account cursor is invalid");
    this.name = "InvalidAdminAccountCursorError";
  }
}

function encodeCursor(payload: CursorPayload): string {
  return btoa(JSON.stringify(payload)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeCursor(cursor: string, sort: AdminAccountSort): CursorPayload {
  try {
    if (cursor.length > ADMIN_ACCOUNT_CURSOR_MAX_LENGTH) throw new Error("cursor is too long");
    const base64 = cursor.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded)) as Partial<CursorPayload>;
    if (
      parsed.sort !== sort ||
      (typeof parsed.value !== "string" && typeof parsed.value !== "number") ||
      typeof parsed.accountId !== "string" ||
      !parsed.accountId
    ) {
      throw new Error("invalid payload");
    }
    return parsed as CursorPayload;
  } catch {
    throw new InvalidAdminAccountCursorError();
  }
}

function escapedLikePattern(value: string): string {
  return `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function listFilters(input: AdminAccountListInput): SQL[] {
  const filters: SQL[] = [eq(accounts.isDeleted, false)];
  const query = input.query?.trim();
  if (query) {
    if (query.length > 100) throw new Error("Admin Account query is too long");
    const pattern = escapedLikePattern(query.toLocaleLowerCase("ja-JP"));
    filters.push(
      or(
        eq(accounts.id, query),
        sql`lower(${accountProfiles.displayName}) like ${pattern} escape '\\'`,
      ) as SQL,
    );
  }
  if (input.role) filters.push(eq(accounts.role, input.role));
  if (input.status) filters.push(eq(accounts.status, input.status));
  return filters;
}

function progressionSortValue(sort: Exclude<AdminAccountSort, "created">): SQL<number> {
  if (sort === "level") return sql<number>`coalesce(${accountProgressionProjections.level}, -1)`;
  if (sort === "pieces") {
    return sql<number>`coalesce(${accountProgressionProjections.collectedPieces}, -1)`;
  }
  return sql<number>`coalesce(${accountProgressionProjections.lastGrowthAt}, -1)`;
}

function cursorFilter(payload: CursorPayload): SQL {
  if (payload.sort === "created") {
    if (typeof payload.value !== "string") throw new InvalidAdminAccountCursorError();
    const createdAt = new Date(payload.value);
    if (Number.isNaN(createdAt.getTime())) throw new InvalidAdminAccountCursorError();
    return or(
      lt(accounts.createdAt, createdAt),
      and(eq(accounts.createdAt, createdAt), lt(accounts.id, payload.accountId)),
    ) as SQL;
  }
  if (typeof payload.value !== "number" || !Number.isSafeInteger(payload.value)) {
    throw new InvalidAdminAccountCursorError();
  }
  const value = progressionSortValue(payload.sort);
  return or(
    lt(value, payload.value),
    and(eq(value, payload.value), lt(accounts.id, payload.accountId)),
  ) as SQL;
}

/** AccountDataで確定した進行度を、管理者一覧用の非機密projectionへ反映する。 */
export async function upsertAccountProgressionProjection(
  db: SharedD1Client,
  accountId: string,
  progression: UtsushiProgression,
  projectedAt = new Date(),
): Promise<void> {
  await db
    .insert(accountProgressionProjections)
    .values({
      accountId,
      calculationVersion: UTSUSHI_PROGRESSION_CALCULATION_VERSION,
      level: progression.level,
      growthValue: progression.growthValue,
      collectedPieces: progression.collectedPieces,
      activePieces: progression.activePieces,
      lastGrowthAt: progression.growthValue > 0 ? projectedAt : null,
      projectedAt,
    })
    .onConflictDoUpdate({
      target: accountProgressionProjections.accountId,
      set: {
        calculationVersion: UTSUSHI_PROGRESSION_CALCULATION_VERSION,
        level: progression.level,
        growthValue: progression.growthValue,
        collectedPieces: progression.collectedPieces,
        activePieces: progression.activePieces,
        lastGrowthAt: sql`case when excluded.growth_value > ${accountProgressionProjections.growthValue} then excluded.projected_at else ${accountProgressionProjections.lastGrowthAt} end`,
        projectedAt,
      },
    });
}

/** 管理者一覧を共有D1だけで検索・整列・cursorページングする。 */
export async function listAdminAccounts(db: SharedD1Client, input: AdminAccountListInput = {}) {
  const sort = input.sort ?? "created";
  const limit = input.limit ?? ADMIN_ACCOUNT_PAGE_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > ADMIN_ACCOUNT_PAGE_LIMIT) {
    throw new Error(`Admin Account page limit must be between 1 and ${ADMIN_ACCOUNT_PAGE_LIMIT}`);
  }
  const filters = listFilters(input);
  const totalRow = await db
    .select({ value: count() })
    .from(accounts)
    .leftJoin(accountProfiles, eq(accountProfiles.accountId, accounts.id))
    .where(and(...filters))
    .get();

  const pageFilters = [...filters];
  if (input.cursor) pageFilters.push(cursorFilter(decodeCursor(input.cursor, sort)));
  const progressionOrder = sort === "created" ? undefined : progressionSortValue(sort);
  const rows = await db
    .select({
      id: accounts.id,
      displayName: accountProfiles.displayName,
      role: accounts.role,
      status: accounts.status,
      createdAt: accounts.createdAt,
      level: accountProgressionProjections.level,
      calculationVersion: accountProgressionProjections.calculationVersion,
      collectedPieces: accountProgressionProjections.collectedPieces,
      activePieces: accountProgressionProjections.activePieces,
      lastGrowthAt: accountProgressionProjections.lastGrowthAt,
      projectedAt: accountProgressionProjections.projectedAt,
    })
    .from(accounts)
    .leftJoin(accountProfiles, eq(accountProfiles.accountId, accounts.id))
    .leftJoin(
      accountProgressionProjections,
      eq(accountProgressionProjections.accountId, accounts.id),
    )
    .where(and(...pageFilters))
    .orderBy(
      sort === "created" ? desc(accounts.createdAt) : desc(progressionOrder as SQL),
      desc(accounts.id),
    )
    .limit(limit + 1)
    .all();

  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  const nextCursor =
    rows.length > limit && last
      ? encodeCursor({
          sort,
          value:
            sort === "created"
              ? last.createdAt.toISOString()
              : sort === "level"
                ? (last.level ?? -1)
                : sort === "pieces"
                  ? (last.collectedPieces ?? -1)
                  : (last.lastGrowthAt?.getTime() ?? -1),
          accountId: last.id,
        })
      : null;

  return {
    total: totalRow?.value ?? 0,
    nextCursor,
    accounts: pageRows.map((row) => ({
      id: row.id,
      displayName: row.displayName,
      role: row.role,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      progression:
        row.level === null ||
        row.calculationVersion === null ||
        row.collectedPieces === null ||
        row.activePieces === null ||
        row.projectedAt === null
          ? ({ status: "pending" } as const)
          : ({
              status: "ready",
              level: row.level,
              calculationVersion: row.calculationVersion,
              collectedPieces: row.collectedPieces,
              activePieces: row.activePieces,
              lastGrowthAt: row.lastGrowthAt?.toISOString() ?? null,
              projectedAt: row.projectedAt.toISOString(),
            } as const),
    })),
  };
}
