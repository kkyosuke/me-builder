import { type SQL, and, count, desc, eq, lt, sql } from "drizzle-orm";
import type { UtsushiProgression } from "../../../do/account/action/progression";
import type { SharedD1Client } from "../client";
import { accounts } from "../schema/account";
import { adminAccountListAudits } from "../schema/admin-audit";
import { accountProgressionProjections } from "../schema/progression";

export const UTSUSHI_PROGRESSION_CALCULATION_VERSION = 1;
export const ADMIN_ACCOUNT_PAGE_LIMIT = 50;
export const ADMIN_ACCOUNT_CURSOR_MAX_LENGTH = 512;

export type AdminAccountSort = "created" | "level" | "pieces" | "growth";

export type AdminAccountListInput = Readonly<{
  query?: string;
  role?: "user" | "admin";
  status?: "active" | "stopped";
  sort?: AdminAccountSort;
  cursor?: string;
  limit?: number;
}>;

type CursorPayload = Readonly<{
  sort: AdminAccountSort;
  offset: number;
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
      typeof parsed.offset !== "number" ||
      !Number.isSafeInteger(parsed.offset) ||
      parsed.offset < 0
    ) {
      throw new Error("invalid payload");
    }
    return parsed as CursorPayload;
  } catch {
    throw new InvalidAdminAccountCursorError();
  }
}

function listFilters(input: AdminAccountListInput): SQL[] {
  const filters: SQL[] = [eq(accounts.isDeleted, false)];
  const query = input.query?.trim();
  if (query) {
    if (query.length > 100) throw new Error("Admin Account query is too long");
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

export async function createAdminAccountReference(accountId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`kagami-admin-reference:v1:${accountId}`),
  );
  return `account_${Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

export async function recordAdminAccountListAudit(
  db: SharedD1Client,
  input: Readonly<{
    adminReference: string;
    queryPresent: boolean;
    role: "all" | "user" | "admin";
    status: "all" | "active" | "stopped";
    sort: AdminAccountSort;
    resultCount: number;
    total: number;
  }>,
  createdAt = new Date(),
): Promise<void> {
  const expiresBefore = new Date(createdAt.getTime() - 365 * 24 * 60 * 60 * 1_000);
  await db.batch([
    db.insert(adminAccountListAudits).values({
      id: crypto.randomUUID(),
      adminReference: input.adminReference,
      queryPresent: input.queryPresent,
      roleFilter: input.role,
      statusFilter: input.status,
      sort: input.sort,
      resultCount: input.resultCount,
      total: input.total,
      createdAt,
    }),
    db.delete(adminAccountListAudits).where(lt(adminAccountListAudits.createdAt, expiresBefore)),
  ]);
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
      calculationVersion: progression.calculationVersion,
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
        calculationVersion: progression.calculationVersion,
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
  const offset = input.cursor ? decodeCursor(input.cursor, sort).offset : 0;
  const requestedReference = input.query?.trim();
  const progressionOrder = sort === "created" ? undefined : progressionSortValue(sort);
  const plan = sql<"free" | "lite" | "full" | "family">`case
    when exists (
      select 1 from family_seats
      inner join family_packs on family_packs.id = family_seats.pack_id
      where family_seats.member_account_id = ${accounts.id}
        and family_seats.status = 'active'
        and family_seats.is_deleted = 0
        and family_packs.status = 'active'
        and family_packs.is_deleted = 0
    ) then 'family'
    else coalesce((
      select case
        when status = 'past_due' then coalesce(payment_failure_plan_code, plan_code)
        else plan_code
      end from billing_subscription_projections
      where account_id = ${accounts.id}
        and plan_code is not null
        and current_period_end > unixepoch()
        and (
          status in ('active', 'trialing')
          or (
            status = 'past_due'
            and payment_failure_started_at is not null
            and unixepoch() < payment_failure_started_at + 604800
          )
        )
      order by last_synced_at desc
      limit 1
    ), 'free')
  end`;
  const query = db
    .select({
      id: accounts.id,
      role: accounts.role,
      status: accounts.status,
      createdAt: accounts.createdAt,
      lastActivityAt: accounts.lastActivityAt,
      plan,
      level: accountProgressionProjections.level,
      calculationVersion: accountProgressionProjections.calculationVersion,
      collectedPieces: accountProgressionProjections.collectedPieces,
      activePieces: accountProgressionProjections.activePieces,
      lastGrowthAt: accountProgressionProjections.lastGrowthAt,
      projectedAt: accountProgressionProjections.projectedAt,
    })
    .from(accounts)
    .leftJoin(
      accountProgressionProjections,
      eq(accountProgressionProjections.accountId, accounts.id),
    )
    .where(and(...filters))
    .orderBy(
      sort === "created" ? desc(accounts.createdAt) : desc(progressionOrder as SQL),
      desc(accounts.id),
    );
  const rawRows = requestedReference
    ? await query.all()
    : await query
        .limit(limit + 1)
        .offset(offset)
        .all();
  const projectedRows = await Promise.all(
    rawRows.map(async (row) => ({
      ...row,
      adminReference: await createAdminAccountReference(row.id),
    })),
  );
  const matchingRows = requestedReference
    ? projectedRows.filter((row) => row.adminReference === requestedReference)
    : projectedRows;
  const pageRows = requestedReference
    ? matchingRows.slice(offset, offset + limit)
    : matchingRows.slice(0, limit);
  const total = requestedReference
    ? matchingRows.length
    : ((
        await db
          .select({ value: count() })
          .from(accounts)
          .where(and(...filters))
          .get()
      )?.value ?? 0);
  const hasNext = requestedReference
    ? matchingRows.length > offset + limit
    : matchingRows.length > limit;
  const nextCursor = hasNext ? encodeCursor({ sort, offset: offset + limit }) : null;

  return {
    total,
    nextCursor,
    accounts: pageRows.map((row) => ({
      adminReference: row.adminReference,
      role: row.role,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      lastActivityAt: (row.lastActivityAt ?? row.createdAt).toISOString(),
      plan: row.plan,
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
