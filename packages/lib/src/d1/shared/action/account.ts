import {
  currentServiceTerms,
  logger,
  serviceTermsDocumentsSatisfyingCurrentRequirement,
} from "@me-builder/shared";
import { and, asc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { SharedD1Client } from "../client";
import { accountIdentities, accounts } from "../schema/account";
import { accountAgreementAcceptances } from "../schema/agreement";

/**
 * ログイン手段の提供元。
 *
 * - `line`: Messaging API で得られる userId（友だち追加またはメッセージの受信後だけ保持）
 * - `line_login`: LINE Login / LIFF の ID トークンの `sub`
 *
 * LINE の userId は**プロバイダー単位**で一意なので、Messaging API チャネルと
 * LINE Login チャネルが同一プロバイダー配下なら両者は同じ値になります。その場合
 * `line` の identity をそのまま引けます（[resolveAccountByLineLogin](#) の手順 2）。
 */
export type IdentityProvider = "line" | "line_login" | "google" | "auth0";

export class CannotUnlinkLastIdentityError extends Error {
  constructor() {
    super("Cannot unlink the last login identity");
    this.name = "CannotUnlinkLastIdentityError";
  }
}

export class IdentityAlreadyLinkedError extends Error {
  constructor() {
    super("Identity is already linked to another account");
    this.name = "IdentityAlreadyLinkedError";
  }
}

export type UpsertIdentityInput = {
  provider: IdentityProvider;
  providerAccountId: string;
  /** 運用設定で明示されたidentityだけに指定する。クライアント入力を渡さないこと。 */
  role?: "user" | "admin";
};

export type UpsertIdentityResult = {
  account: typeof accounts.$inferSelect;
  identity: typeof accountIdentities.$inferSelect;
};

/** 有効な identity とそれに紐づく有効な Account を 1 件取得します。 */
async function findByIdentity(
  db: SharedD1Client,
  provider: IdentityProvider,
  providerAccountId: string,
): Promise<UpsertIdentityResult | undefined> {
  return await db
    .select({
      account: accounts,
      identity: accountIdentities,
    })
    .from(accountIdentities)
    .innerJoin(accounts, eq(accountIdentities.accountId, accounts.id))
    .where(
      and(
        eq(accountIdentities.provider, provider),
        eq(accountIdentities.providerAccountId, providerAccountId),
        eq(accountIdentities.isDeleted, false),
        eq(accounts.isDeleted, false),
      ),
    )
    .get();
}

/** 検証済み外部Identityから既存の有効なAccountだけを解決します。 */
export async function findAccountByIdentity(
  db: SharedD1Client,
  provider: IdentityProvider,
  providerAccountId: string,
): Promise<UpsertIdentityResult | undefined> {
  return await findByIdentity(db, provider, providerAccountId);
}

/** Accountに残る有効なログイン手段を、外部subjectを返さずに列挙します。 */
export async function listLoginIdentityProviders(
  db: SharedD1Client,
  accountId: string,
): Promise<IdentityProvider[]> {
  const identities = await db
    .select({ provider: accountIdentities.provider })
    .from(accountIdentities)
    .innerJoin(accounts, eq(accountIdentities.accountId, accounts.id))
    .where(
      and(
        eq(accountIdentities.accountId, accountId),
        eq(accountIdentities.isDeleted, false),
        eq(accounts.isDeleted, false),
      ),
    )
    .orderBy(asc(accountIdentities.provider))
    .all();
  return identities.map(({ provider }) => provider as IdentityProvider);
}

/** 別providerのログイン手段を残す条件を同じUPDATE文で評価してIdentityを解除します。 */
export async function unlinkLoginIdentityProvider(
  db: SharedD1Client,
  input: { accountId: string; provider: IdentityProvider },
): Promise<void> {
  const now = new Date();
  const unlinked = await db
    .update(accountIdentities)
    .set({ isDeleted: true, deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(accountIdentities.accountId, input.accountId),
        eq(accountIdentities.provider, input.provider),
        eq(accountIdentities.isDeleted, false),
        sql`(
          SELECT COUNT(*)
          FROM account_identities AS active_identity
          WHERE active_identity.account_id = ${input.accountId}
            AND active_identity.is_deleted = 0
            AND active_identity.provider <> ${input.provider}
        ) > 0`,
      ),
    )
    .returning({ id: accountIdentities.id })
    .get();

  if (unlinked) return;
  const providers = await listLoginIdentityProviders(db, input.accountId);
  if (!providers.includes(input.provider)) return;
  throw new CannotUnlinkLastIdentityError();
}

async function applyRequestedRole(
  db: SharedD1Client,
  found: UpsertIdentityResult,
  role: "user" | "admin" | undefined,
): Promise<UpsertIdentityResult> {
  if (role === undefined || found.account.role === role) return found;
  const updated = await db
    .update(accounts)
    .set({
      role,
      updatedAt: new Date(),
      ...(found.account.role === "admin" && role === "user"
        ? { sessionVersion: sql`${accounts.sessionVersion} + 1` }
        : {}),
    })
    .where(eq(accounts.id, found.account.id))
    .returning()
    .get();
  if (!updated) throw new Error("Account role synchronization failed");
  return { ...found, account: updated };
}

/**
 * 既存の Account へログイン手段を 1 つ追加します。
 *
 * 新しい Account は作りません。`upsertIdentity` は「見つからなければ新規 Account を作る」
 * ため、既存の本人へ別のログイン手段を足す用途には使えません。
 */
export async function linkIdentity(
  db: SharedD1Client,
  input: UpsertIdentityInput & { accountId: string },
): Promise<typeof accountIdentities.$inferSelect> {
  const existing = await findByIdentity(db, input.provider, input.providerAccountId);
  if (existing) {
    return assertSameAccount(existing, input.accountId);
  }

  const now = new Date();
  const identity: typeof accountIdentities.$inferSelect = {
    id: crypto.randomUUID(),
    accountId: input.accountId,
    provider: input.provider,
    providerAccountId: input.providerAccountId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    isDeleted: false,
  };

  try {
    await db.insert(accountIdentities).values(identity);
  } catch (err: unknown) {
    // 存在確認と INSERT の間に排他がないため、同じ identity を同時に作ろうとすると
    // 部分ユニークインデックスに弾かれる。先に入った行を採用する (upsertIdentity と同じ方針)。
    if (!isUniqueViolation(err)) {
      throw err;
    }
    logger.warn(
      { event: "account.identity.link-conflict", provider: input.provider },
      "Unique constraint violation during linkIdentity, fetching the existing identity",
    );

    const inserted = await findByIdentity(db, input.provider, input.providerAccountId);
    if (!inserted) {
      throw err;
    }
    return assertSameAccount(inserted, input.accountId);
  }

  return identity;
}

/**
 * Accountからidentityを解除し、既存application sessionを同じD1 batchで失効させます。
 * 呼び出し側は最後のidentityを解除してよいか等のproduct policyを事前に判定します。
 */
export async function unlinkIdentity(
  db: SharedD1Client,
  input: Readonly<{ accountId: string; identityId: string; now?: Date }>,
): Promise<boolean> {
  const identity = await db.query.accountIdentities.findFirst({
    columns: { id: true },
    where: (table, { and, eq }) =>
      and(
        eq(table.id, input.identityId),
        eq(table.accountId, input.accountId),
        eq(table.isDeleted, false),
      ),
  });
  if (!identity) return false;

  const now = input.now ?? new Date();
  await db.batch([
    db
      .update(accounts)
      .set({ sessionVersion: sql`${accounts.sessionVersion} + 1`, updatedAt: now })
      .where(eq(accounts.id, input.accountId)),
    db
      .update(accountIdentities)
      .set({ isDeleted: true, deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(accountIdentities.id, input.identityId),
          eq(accountIdentities.accountId, input.accountId),
          eq(accountIdentities.isDeleted, false),
        ),
      ),
  ]);
  return true;
}

/** Accountを停止し、その時点までに発行されたsessionを即時失効させます。 */
export async function stopAccount(
  db: SharedD1Client,
  accountId: string,
  now = new Date(),
): Promise<boolean> {
  const [stopped] = await db
    .update(accounts)
    .set({
      status: "stopped",
      sessionVersion: sql`${accounts.sessionVersion} + 1`,
      updatedAt: now,
    })
    .where(and(eq(accounts.id, accountId), eq(accounts.status, "active")))
    .returning({ id: accounts.id });
  return stopped !== undefined;
}

/**
 * 既存の identity が期待した Account に属していることを確認します。
 *
 * 別の Account に属している場合は、[ドメイン設計](../../../../../docs/domain/domain-design.md)の
 * 「同じ外部ログインIDを複数の有効なAccountへ重複して紐づけない」に従って拒否します。
 */
function assertSameAccount(
  existing: UpsertIdentityResult,
  accountId: string,
): typeof accountIdentities.$inferSelect {
  if (existing.identity.accountId !== accountId) {
    throw new IdentityAlreadyLinkedError();
  }
  return existing.identity;
}

/** D1 / SQLite のユニーク制約違反かどうかを判定します。 */
function isUniqueViolation(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("UNIQUE constraint failed") ||
    message.includes("D1_ERROR") ||
    message.includes("SQLITE_CONSTRAINT")
  );
}

/**
 * LINE Login (LIFF) の `sub` から Account を解決します。
 *
 * 1. `line_login` の identity があればそれを使う（2 回目以降は必ずここで終わる）
 * 2. 無ければ `line` の identity を同じ値で探す。見つかれば Messaging API チャネルと
 *    LINE Login チャネルが同一プロバイダー配下で userId が一致しているので、その
 *    Account へ `line_login` を追加して紐づける
 * 3. どちらも無ければ、検証済みの `sub` で `line_login` identity付きのAccountを作る
 *
 * `line` identityはここでは先回りして作りません。友だち追加前のAccountを通知対象へ
 * 含めないため、Messaging APIのWebhookを実際に受け付けた時点でだけ追加します。
 */
export async function resolveAccountByLineLogin(
  db: SharedD1Client,
  sub: string,
  role: "user" | "admin" = "user",
): Promise<UpsertIdentityResult> {
  const byLogin = await findByIdentity(db, "line_login", sub);
  if (byLogin) {
    return await applyRequestedRole(db, byLogin, role);
  }

  const byMessagingApi = await findByIdentity(db, "line", sub);
  if (!byMessagingApi) {
    return await upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: sub,
      role,
    });
  }

  const identity = await linkIdentity(db, {
    accountId: byMessagingApi.account.id,
    provider: "line_login",
    providerAccountId: sub,
  });

  logger.info(
    { event: "account.identity.linked", provider: "line_login" },
    "Linked line_login identity to the account found by the Messaging API userId",
  );

  return await applyRequestedRole(db, { account: byMessagingApi.account, identity }, role);
}

/**
 * Messaging APIのuserIdからAccountを解決し、LINE機能を利用できるidentityを追加します。
 *
 * `line_login`を先に解決することで、LIFFとWebhookが空のDBへ同時に到着しても、両方が
 * 同じ `(provider, providerAccountId)` の一意制約を競合点として使い、Accountを二重作成
 * しないようにします。Messaging APIチャネルとLINE Loginチャネルが同一プロバイダー
 * 配下にあり、userIdと`sub`が一致することが前提です。
 */
export async function resolveAccountByLineMessagingApi(
  db: SharedD1Client,
  providerAccountId: string,
  role: "user" | "admin" = "user",
): Promise<UpsertIdentityResult> {
  const byMessagingApi = await findByIdentity(db, "line", providerAccountId);
  if (byMessagingApi) {
    await linkIdentity(db, {
      accountId: byMessagingApi.account.id,
      provider: "line_login",
      providerAccountId,
    });
    return await applyRequestedRole(db, byMessagingApi, role);
  }

  const canonical = await resolveAccountByLineLogin(db, providerAccountId, role);
  const identity = await linkIdentity(db, {
    accountId: canonical.account.id,
    provider: "line",
    providerAccountId,
  });

  logger.info(
    { event: "account.identity.linked", provider: "line" },
    "Linked Messaging API identity to the LINE account",
  );

  return { account: canonical.account, identity };
}

/** Productionの管理者allowlistから外れたAccountを降格し、発行済みsessionを一括失効する。 */
export async function revokeAdminAccessUnlessAllowed(
  db: SharedD1Client,
  accountId: string,
  allowedLineUserIds: readonly string[],
): Promise<boolean> {
  const account = await db.query.accounts.findFirst({
    columns: { role: true },
    where: (table, { eq }) => eq(table.id, accountId),
  });
  if (!account || account.role !== "admin") return true;
  const allowed =
    allowedLineUserIds.length > 0
      ? await db.query.accountIdentities.findFirst({
          columns: { id: true },
          where: (table, { and, eq, inArray }) =>
            and(
              eq(table.accountId, accountId),
              eq(table.isDeleted, false),
              inArray(table.provider, ["line", "line_login"]),
              inArray(table.providerAccountId, [...allowedLineUserIds]),
            ),
        })
      : undefined;
  if (allowed) return true;
  await db
    .update(accounts)
    .set({
      role: "user",
      sessionVersion: sql`${accounts.sessionVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(accounts.id, accountId), eq(accounts.role, "admin")));
  return false;
}

/** 管理一覧用の最終利用時刻を、requestごとの書き込みを避けて15分単位で更新する。 */
export async function recordAccountActivity(
  db: SharedD1Client,
  accountId: string,
  at = new Date(),
): Promise<void> {
  const updateBefore = new Date(at.getTime() - 15 * 60 * 1_000);
  await db
    .update(accounts)
    .set({ lastActivityAt: at })
    .where(
      and(
        eq(accounts.id, accountId),
        or(isNull(accounts.lastActivityAt), lt(accounts.lastActivityAt, updateBefore)),
      ),
    );
}

/** Accountに紐づく有効なMessaging API identityを配送時に解決する。 */
export async function findLineIdentityByAccountId(
  db: SharedD1Client,
  accountId: string,
): Promise<string | undefined> {
  const identity = await db
    .select({ providerAccountId: accountIdentities.providerAccountId })
    .from(accountIdentities)
    .innerJoin(accounts, eq(accountIdentities.accountId, accounts.id))
    .where(
      and(
        eq(accountIdentities.accountId, accountId),
        eq(accountIdentities.provider, "line"),
        eq(accountIdentities.isDeleted, false),
        eq(accounts.isDeleted, false),
      ),
    )
    .get();
  return identity?.providerAccountId;
}

/** CronがDaily Prompt Queueへ投入するactiveなLINE Account IDだけをページング取得する。 */
export async function listActiveLineAccountIds(
  db: SharedD1Client,
  input: Readonly<{ afterAccountId?: string; limit?: number }> = {},
): Promise<string[]> {
  const limit = input.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Active LINE Account page limit must be between 1 and 100");
  }
  const filters = [
    eq(accountIdentities.provider, "line"),
    eq(accountIdentities.isDeleted, false),
    eq(accounts.status, "active"),
    eq(accounts.isDeleted, false),
    eq(accountAgreementAcceptances.documentKey, currentServiceTerms.documentKey),
    or(
      ...serviceTermsDocumentsSatisfyingCurrentRequirement.map((document) =>
        and(
          eq(accountAgreementAcceptances.documentVersion, document.version),
          eq(accountAgreementAcceptances.documentHash, document.contentHash),
        ),
      ),
    ),
    eq(accountAgreementAcceptances.isDeleted, false),
    ...(input.afterAccountId ? [gt(accounts.id, input.afterAccountId)] : []),
  ];
  const rows = await db
    .selectDistinct({ accountId: accounts.id })
    .from(accounts)
    .innerJoin(accountIdentities, eq(accountIdentities.accountId, accounts.id))
    .innerJoin(accountAgreementAcceptances, eq(accountAgreementAcceptances.accountId, accounts.id))
    .where(and(...filters))
    .orderBy(asc(accounts.id))
    .limit(limit)
    .all();
  return rows.map(({ accountId }) => accountId);
}

/**
 * Upserts accounts and account_identities records in D1 based on provider identity.
 * Uses a single JOIN query to fetch existing identity & account, and D1 batching for new insertions.
 */
export async function upsertIdentity(
  db: SharedD1Client,
  input: UpsertIdentityInput,
): Promise<UpsertIdentityResult> {
  const now = new Date();

  // Find existing identity and linked active account in a single JOIN query
  const found = await findByIdentity(db, input.provider, input.providerAccountId);

  if (found) {
    return await applyRequestedRole(db, found, input.role);
  }

  // Create new account & identity link atomically using D1 batch
  const accountId = crypto.randomUUID();
  const account: typeof accounts.$inferSelect = {
    id: accountId,
    status: "active",
    role: input.role ?? "user",
    sessionVersion: 1,
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    isDeleted: false,
  };

  const identityId = crypto.randomUUID();
  const identity: typeof accountIdentities.$inferSelect = {
    id: identityId,
    accountId,
    provider: input.provider,
    providerAccountId: input.providerAccountId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    isDeleted: false,
  };

  try {
    await db.batch([
      db.insert(accounts).values(account),
      db.insert(accountIdentities).values(identity),
    ]);
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      // providerAccountId は本人識別子なのでログへ出さない
      // ([プロジェクト概要 §8](../../../../../docs/product/project-overview.md#8-プライバシーと安全性))
      logger.warn(
        {
          event: "account.identity.upsert-conflict",
          provider: input.provider,
          reason: "unique-constraint",
        },
        "Unique constraint violation during upsert, fetching existing identity",
      );

      const existing = await findByIdentity(db, input.provider, input.providerAccountId);

      if (existing) {
        return existing;
      }
    }
    throw err;
  }

  return { account, identity };
}
