import type { KVNamespace } from "@cloudflare/workers-types";
import { D1 } from "@me-builder/lib";
import * as v from "valibot";
import type { SsoVerifiedIdentity } from "../../logic/authentication/sso-provider";
import type { SsoLinkHandoffStager } from "../../logic/authentication/sso-transaction";

const LinkAttemptSchema = v.variant("status", [
  v.object({
    status: v.literal("waiting"),
    accountId: v.pipe(v.string(), v.nonEmpty()),
    confirmationSecretHash: v.pipe(v.string(), v.nonEmpty()),
    expiresAt: v.pipe(v.number(), v.safeInteger()),
  }),
  v.object({
    status: v.literal("ready"),
    accountId: v.pipe(v.string(), v.nonEmpty()),
    confirmationSecretHash: v.pipe(v.string(), v.nonEmpty()),
    expiresAt: v.pipe(v.number(), v.safeInteger()),
    identity: v.object({
      providerKey: v.pipe(v.string(), v.nonEmpty()),
      subject: v.pipe(v.string(), v.nonEmpty()),
      authenticationMethod: v.literal("sso"),
      authenticatedAt: v.pipe(v.number(), v.safeInteger()),
    }),
  }),
  v.object({
    status: v.picklist(["cancelled", "failed"]),
    accountId: v.pipe(v.string(), v.nonEmpty()),
    confirmationSecretHash: v.pipe(v.string(), v.nonEmpty()),
    expiresAt: v.pipe(v.number(), v.safeInteger()),
  }),
]);

type LinkAttempt = v.InferOutput<typeof LinkAttemptSchema>;
const textEncoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export async function hashSsoLinkSecret(value: string): Promise<string> {
  return base64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(value))),
  );
}

async function attemptKey(attemptId: string): Promise<string> {
  return `sso-link-attempt:${await hashSsoLinkSecret(attemptId)}`;
}

export type SsoLinkAttemptStatus = "waiting" | "ready" | "cancelled" | "failed" | "expired";

export function createSsoLinkHandoffStore(db: D1.shared.Client, kv: KVNamespace) {
  const read = async (attemptId: string): Promise<LinkAttempt | undefined> => {
    const parsed = v.safeParse(
      LinkAttemptSchema,
      await kv.get(await attemptKey(attemptId), "json"),
    );
    return parsed.success ? parsed.output : undefined;
  };

  return {
    async put(input: {
      attemptId: string;
      accountId: string;
      confirmationSecretHash: string;
      expiresAt: number;
      ttlSeconds: number;
    }): Promise<void> {
      await kv.put(
        await attemptKey(input.attemptId),
        JSON.stringify({
          status: "waiting",
          accountId: input.accountId,
          confirmationSecretHash: input.confirmationSecretHash,
          expiresAt: input.expiresAt,
        } satisfies LinkAttempt),
        { expirationTtl: input.ttlSeconds },
      );
    },
    stager: {
      async stage(input: {
        attemptId: string;
        accountId: string;
        confirmationSecretHash: string;
        identity: SsoVerifiedIdentity;
      }): Promise<void> {
        const current = await read(input.attemptId);
        if (
          !current ||
          current.status !== "waiting" ||
          current.expiresAt <= Date.now() ||
          current.accountId !== input.accountId ||
          current.confirmationSecretHash !== input.confirmationSecretHash
        ) {
          throw new Error("SSO link attempt is unavailable");
        }
        await kv.put(
          await attemptKey(input.attemptId),
          JSON.stringify({
            ...current,
            status: "ready",
            identity: {
              providerKey: input.identity.providerKey,
              subject: input.identity.subject,
              authenticationMethod: input.identity.authenticationMethod,
              authenticatedAt: input.identity.authenticatedAt.getTime(),
            },
          } satisfies LinkAttempt),
          { expirationTtl: Math.max(60, Math.ceil((current.expiresAt - Date.now()) / 1000)) },
        );
      },
    } satisfies SsoLinkHandoffStager,
    async mark(attemptId: string, status: "cancelled" | "failed"): Promise<void> {
      const current = await read(attemptId);
      if (!current || current.status !== "waiting") return;
      await kv.put(
        await attemptKey(attemptId),
        JSON.stringify({ ...current, status } satisfies LinkAttempt),
        { expirationTtl: Math.max(60, Math.ceil((current.expiresAt - Date.now()) / 1000)) },
      );
    },
    async status(input: {
      attemptId: string;
      accountId: string;
      confirmationSecret: string;
    }): Promise<SsoLinkAttemptStatus> {
      const current = await read(input.attemptId);
      if (!current || current.expiresAt <= Date.now()) return "expired";
      if (
        current.accountId !== input.accountId ||
        current.confirmationSecretHash !== (await hashSsoLinkSecret(input.confirmationSecret))
      ) {
        return "expired";
      }
      return current.status;
    },
    async consumeReady(input: {
      attemptId: string;
      accountId: string;
      confirmationSecret: string;
    }): Promise<SsoVerifiedIdentity | undefined> {
      const current = await read(input.attemptId);
      if (
        !current ||
        current.status !== "ready" ||
        current.expiresAt <= Date.now() ||
        current.accountId !== input.accountId ||
        current.confirmationSecretHash !== (await hashSsoLinkSecret(input.confirmationSecret))
      ) {
        return undefined;
      }
      const stateHash = await hashSsoLinkSecret(`sso-link-confirm:${input.attemptId}`);
      const claimed = await D1.shared.action.ssoAuthentication.claimSsoAuthenticationTransaction(
        db,
        {
          stateHash,
          expiresAt: Math.max(current.expiresAt, Date.now() + 60_000),
          removeExpiredBefore: Date.now(),
        },
      );
      if (!claimed) return undefined;
      await kv.delete(await attemptKey(input.attemptId));
      return {
        ...current.identity,
        authenticatedAt: new Date(current.identity.authenticatedAt),
      };
    },
  };
}
