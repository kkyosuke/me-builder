import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";

const { getProfileAvatarImage, resolveProfileAvatarImage } = vi.hoisted(() => ({
  getProfileAvatarImage: vi.fn(),
  resolveProfileAvatarImage: vi.fn(),
}));
vi.mock("../logic/profile-avatar-image", () => ({
  getProfileAvatarImage,
  resolveProfileAvatarImage,
}));
vi.mock("../middleware/authentication", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middleware/authentication")>();
  return {
    ...actual,
    requireAuthentication: async (
      c: Parameters<typeof actual.requireAuthentication>[0],
      next: () => Promise<void>,
    ) => {
      const result = {
        type: "authenticated" as const,
        actor: {
          accountId: "account-1",
          authenticationMethod: "liff" as const,
          authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
        },
        accountRole: "user" as const,
        displayProfile: { pictureUrl: "https://profile.line-scdn.net/own" },
      };
      c.set("authenticationResult", result);
      c.set("authenticatedActor", result.actor);
      await next();
    },
  };
});
vi.mock("../middleware/authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middleware/authorization")>();
  return {
    ...actual,
    requireCurrentTerms: async (_c: unknown, next: () => Promise<void>) => next(),
  };
});

const dummyDb = {} as D1Database;
const dummyAvatarBucket = {} as R2Bucket;

function request(env: Record<string, unknown> = {}) {
  return app.request(
    "/api/profile/avatar",
    { headers: { Authorization: "Bearer dummy.id.token" } },
    {
      LIFF_ID: "2010850319-Yl63upAR",
      DB: dummyDb,
      AVATAR_BUCKET: dummyAvatarBucket,
      ...env,
    },
  );
}

describe("GET /api/profile/avatar", () => {
  beforeEach(() => vi.clearAllMocks());

  it("本人画像をno-storeの画像bodyへ変換する", async () => {
    getProfileAvatarImage.mockResolvedValue({
      type: "resolved",
      image: { bytes: Uint8Array.from([1, 2, 3]), contentType: "image/png" },
    });

    const response = await request({ LINE_CHANNEL_ACCESS_TOKEN: "line-token" });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.from([1, 2, 3]));
    expect(getProfileAvatarImage).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({ accountId: "account-1" }),
        verifiedLinePictureUrl: "https://profile.line-scdn.net/own",
        avatarBucket: dummyAvatarBucket,
        lineChannelAccessToken: "line-token",
      }),
    );
  });

  it("画像がなければ204を返す", async () => {
    getProfileAvatarImage.mockResolvedValue({ type: "unavailable" });
    const response = await request();
    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("Private R2 bindingがなければlogicを呼ばず503を返す", async () => {
    const response = await request({ AVATAR_BUCKET: undefined });
    expect(response.status).toBe(503);
    expect(getProfileAvatarImage).not.toHaveBeenCalled();
  });
});
