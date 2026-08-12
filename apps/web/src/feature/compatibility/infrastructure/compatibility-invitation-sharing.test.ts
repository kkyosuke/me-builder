import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shareLiffTextMessage } from "../../liff/infrastructure/liff-client";
import {
  compatibilityInvitationMessage,
  copyCompatibilityInvitationUrl,
  shareCompatibilityInvitationToLine,
} from "./compatibility-invitation-sharing";

vi.mock("../../liff/infrastructure/liff-client", () => ({ shareLiffTextMessage: vi.fn() }));

describe("compatibility invitation sharing", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("送信者、承諾前は共有されないこと、招待URLをLINE共有文に含める", async () => {
    vi.mocked(shareLiffTextMessage).mockResolvedValue(true);
    const url = `https://example.com/compatibility/invitations/${"1".repeat(64)}`;

    await shareCompatibilityInvitationToLine("あおい", url);

    expect(shareLiffTextMessage).toHaveBeenCalledWith(
      compatibilityInvitationMessage("あおい", url),
    );
    expect(compatibilityInvitationMessage("あおい", url)).toBe(
      `あおいさんから相性診断の招待が届いています。\n内容を確認して承諾するまで、情報の共有は始まりません。\n${url}`,
    );
  });

  it("Clipboard APIへ招待URLだけを渡す", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await copyCompatibilityInvitationUrl("https://example.com/invitation");

    expect(writeText).toHaveBeenCalledWith("https://example.com/invitation");
  });

  it("LIFF共有が使えない外部ブラウザでは端末の共有先を開く", async () => {
    vi.mocked(shareLiffTextMessage).mockResolvedValue(false);
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share });

    await expect(
      shareCompatibilityInvitationToLine("あおい", "https://example.com/invitation"),
    ).resolves.toBe("system");
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "相性診断の招待",
        text: expect.stringContaining("あおいさん"),
      }),
    );
  });
});
