import { beforeEach, describe, expect, it, vi } from "vitest";
import { shareLiffTextMessage } from "../../liff/infrastructure/liff-client";
import {
  compatibilityInvitationMessage,
  copyCompatibilityInvitationUrl,
  shareCompatibilityInvitationToLine,
} from "./compatibility-invitation-sharing";

vi.mock("../../liff/infrastructure/liff-client", () => ({ shareLiffTextMessage: vi.fn() }));

describe("compatibility invitation sharing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("表示名と招待URLだけでLINE共有文を作る", async () => {
    vi.mocked(shareLiffTextMessage).mockResolvedValue(true);
    const url = `https://example.com/compatibility/invitations/${"1".repeat(64)}`;

    await shareCompatibilityInvitationToLine("あおい", url);

    expect(shareLiffTextMessage).toHaveBeenCalledWith(
      compatibilityInvitationMessage("あおい", url),
    );
    expect(compatibilityInvitationMessage("あおい", url)).toBe(
      `あおいさんから相性診断の招待が届いています。\n${url}`,
    );
  });

  it("Clipboard APIへ招待URLだけを渡す", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await copyCompatibilityInvitationUrl("https://example.com/invitation");

    expect(writeText).toHaveBeenCalledWith("https://example.com/invitation");
  });
});
