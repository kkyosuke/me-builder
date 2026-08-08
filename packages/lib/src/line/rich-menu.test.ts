import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRichMenuList: vi.fn(),
  createRichMenu: vi.fn(),
  setDefaultRichMenu: vi.fn(),
  deleteRichMenu: vi.fn(),
  setRichMenuImage: vi.fn(),
  createClient: vi.fn(),
  createBlobClient: vi.fn(),
}));

vi.mock("./client", () => ({
  client: {
    create: mocks.createClient,
    createBlob: mocks.createBlobClient,
  },
}));

import { richMenu } from "./rich-menu";

const params = {
  channelAccessToken: "test-channel-token",
  liffId: "1234567890-AbCdEfGh",
  namePrefix: "me-builder-diagnosis-preview",
  version: "a1b2c3d4e5f6",
  image: new Blob(["image"], { type: "image/jpeg" }),
};

describe("line.richMenu.registerDefault", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockReturnValue({
      getRichMenuList: mocks.getRichMenuList,
      createRichMenu: mocks.createRichMenu,
      setDefaultRichMenu: mocks.setDefaultRichMenu,
      deleteRichMenu: mocks.deleteRichMenu,
    });
    mocks.createBlobClient.mockReturnValue({
      setRichMenuImage: mocks.setRichMenuImage,
    });
    mocks.getRichMenuList.mockResolvedValue({ richmenus: [] });
    mocks.createRichMenu.mockResolvedValue({ richMenuId: "richmenu-new" });
    mocks.setRichMenuImage.mockResolvedValue({});
    mocks.setDefaultRichMenu.mockResolvedValue({});
    mocks.deleteRichMenu.mockResolvedValue({});
  });

  it("設定が欠けている場合は API を呼ばずスキップすること", async () => {
    const result = await richMenu.registerDefault({ ...params, liffId: undefined });

    expect(result.success).toBe(false);
    expect(result.message).toContain("スキップ");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("全面を診断 LIFF へ遷移する1ボタンとして登録すること", async () => {
    const result = await richMenu.registerDefault(params);

    expect(result).toMatchObject({ success: true, richMenuId: "richmenu-new" });
    expect(mocks.createRichMenu).toHaveBeenCalledWith({
      size: { width: 2500, height: 843 },
      selected: true,
      name: "me-builder-diagnosis-preview-a1b2c3d4e5f6",
      chatBarText: "メニューを開く",
      areas: [
        {
          bounds: { x: 0, y: 0, width: 2500, height: 843 },
          action: {
            type: "uri",
            label: "診断を行う",
            uri: "https://liff.line.me/1234567890-AbCdEfGh",
          },
        },
      ],
    });
    expect(mocks.setRichMenuImage).toHaveBeenCalledWith("richmenu-new", params.image);
    expect(mocks.setDefaultRichMenu).toHaveBeenCalledWith("richmenu-new");
  });

  it("同じ画像版が登録済みなら再利用し、同じ環境の旧版だけを削除すること", async () => {
    mocks.getRichMenuList.mockResolvedValue({
      richmenus: [
        {
          richMenuId: "richmenu-current",
          name: "me-builder-diagnosis-preview-a1b2c3d4e5f6",
        },
        {
          richMenuId: "richmenu-old",
          name: "me-builder-diagnosis-preview-oldversion",
        },
        {
          richMenuId: "richmenu-production",
          name: "me-builder-diagnosis-production-oldversion",
        },
      ],
    });

    const result = await richMenu.registerDefault(params);

    expect(result).toMatchObject({ success: true, richMenuId: "richmenu-current" });
    expect(mocks.createRichMenu).not.toHaveBeenCalled();
    expect(mocks.setRichMenuImage).not.toHaveBeenCalled();
    expect(mocks.setDefaultRichMenu).toHaveBeenCalledWith("richmenu-current");
    expect(mocks.deleteRichMenu).toHaveBeenCalledTimes(1);
    expect(mocks.deleteRichMenu).toHaveBeenCalledWith("richmenu-old");
  });

  it("画像アップロードに失敗したら作成途中のメニューを削除すること", async () => {
    mocks.setRichMenuImage.mockRejectedValue(new Error("upload failed test-channel-token"));

    const result = await richMenu.registerDefault(params);

    expect(result.success).toBe(false);
    expect(result.message).toContain("upload failed");
    expect(result.message).not.toContain(params.channelAccessToken);
    expect(mocks.deleteRichMenu).toHaveBeenCalledWith("richmenu-new");
    expect(mocks.setDefaultRichMenu).not.toHaveBeenCalled();
  });
});
