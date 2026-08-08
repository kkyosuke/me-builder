import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRichMenuList: vi.fn(),
  createRichMenu: vi.fn(),
  setDefaultRichMenu: vi.fn(),
  getDefaultRichMenuId: vi.fn(),
  deleteRichMenu: vi.fn(),
  setRichMenuImage: vi.fn(),
  getRichMenuImage: vi.fn(),
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
  image: new Blob(["image"], { type: "image/jpeg" }),
};

const imageStream = { destroy: vi.fn() };

describe("line.richMenu.registerDefault", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockReturnValue({
      getRichMenuList: mocks.getRichMenuList,
      createRichMenu: mocks.createRichMenu,
      setDefaultRichMenu: mocks.setDefaultRichMenu,
      getDefaultRichMenuId: mocks.getDefaultRichMenuId,
      deleteRichMenu: mocks.deleteRichMenu,
    });
    mocks.createBlobClient.mockReturnValue({
      setRichMenuImage: mocks.setRichMenuImage,
      getRichMenuImage: mocks.getRichMenuImage,
    });
    mocks.getRichMenuList.mockResolvedValue({ richmenus: [] });
    mocks.createRichMenu.mockResolvedValue({ richMenuId: "richmenu-new" });
    mocks.setRichMenuImage.mockResolvedValue({});
    mocks.getRichMenuImage.mockResolvedValue(imageStream);
    mocks.setDefaultRichMenu.mockResolvedValue({});
    mocks.getDefaultRichMenuId.mockResolvedValue({ richMenuId: "richmenu-old" });
    mocks.deleteRichMenu.mockResolvedValue({});
  });

  it("設定が欠けている場合は API を呼ばずスキップすること", async () => {
    const result = await richMenu.registerDefault({ ...params, liffId: undefined });

    expect(result.success).toBe(false);
    expect(result.message).toContain("スキップ");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("左右を私の傾向と診断一覧へ遷移する2ボタンとして登録すること", async () => {
    const result = await richMenu.registerDefault(params);

    expect(result).toMatchObject({ success: true, richMenuId: "richmenu-new" });
    expect(mocks.createRichMenu).toHaveBeenCalledWith(
      expect.objectContaining({
        size: { width: 2500, height: 843 },
        selected: true,
        name: expect.stringMatching(/^me-builder-diagnosis-preview-[0-9a-f]{12}$/),
        chatBarText: "メニューを開く",
        areas: [
          {
            bounds: { x: 0, y: 0, width: 1250, height: 843 },
            action: {
              type: "uri",
              label: "私を知る",
              uri: "https://liff.line.me/1234567890-AbCdEfGh/profile",
            },
          },
          {
            bounds: { x: 1250, y: 0, width: 1250, height: 843 },
            action: {
              type: "uri",
              label: "診断を行う",
              uri: "https://liff.line.me/1234567890-AbCdEfGh",
            },
          },
        ],
      }),
    );
    expect(mocks.setRichMenuImage).toHaveBeenCalledWith("richmenu-new", params.image);
    expect(mocks.setDefaultRichMenu).toHaveBeenCalledWith("richmenu-new");
  });

  it("同じ設定版と画像が登録済みなら再利用し、同じ環境の旧版だけを削除すること", async () => {
    await richMenu.registerDefault(params);
    const currentName = mocks.createRichMenu.mock.calls[0]?.[0]?.name;
    vi.clearAllMocks();
    mocks.getRichMenuList.mockResolvedValue({
      richmenus: [
        {
          richMenuId: "richmenu-current",
          name: currentName,
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
    expect(mocks.getRichMenuImage).toHaveBeenCalledWith("richmenu-current");
    expect(imageStream.destroy).toHaveBeenCalled();
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

  it("同名メニューの画像を確認できなければ再作成すること", async () => {
    await richMenu.registerDefault(params);
    const currentName = mocks.createRichMenu.mock.calls[0]?.[0]?.name;
    vi.clearAllMocks();
    mocks.getRichMenuList.mockResolvedValue({
      richmenus: [{ richMenuId: "richmenu-incomplete", name: currentName }],
    });
    mocks.getRichMenuImage.mockRejectedValue(new Error("image not found"));
    mocks.createRichMenu.mockResolvedValue({ richMenuId: "richmenu-recreated" });

    const result = await richMenu.registerDefault(params);

    expect(result).toMatchObject({ success: true, richMenuId: "richmenu-recreated" });
    expect(mocks.setRichMenuImage).toHaveBeenCalledWith("richmenu-recreated", params.image);
    expect(mocks.setDefaultRichMenu).toHaveBeenCalledWith("richmenu-recreated");
    expect(mocks.deleteRichMenu).toHaveBeenCalledWith("richmenu-incomplete");
  });

  it("既定設定の応答を失ってもLINE側で設定済みなら成功として扱うこと", async () => {
    mocks.setDefaultRichMenu.mockRejectedValue(new Error("response lost"));
    mocks.getDefaultRichMenuId.mockResolvedValue({ richMenuId: "richmenu-new" });

    const result = await richMenu.registerDefault(params);

    expect(result).toMatchObject({ success: true, richMenuId: "richmenu-new" });
    expect(mocks.deleteRichMenu).not.toHaveBeenCalledWith("richmenu-new");
  });

  it("既定設定の結果を確認できなければ新メニューを削除しないこと", async () => {
    mocks.setDefaultRichMenu.mockRejectedValue(new Error("response lost"));
    mocks.getDefaultRichMenuId.mockRejectedValue(new Error("verification failed"));

    const result = await richMenu.registerDefault(params);

    expect(result.success).toBe(false);
    expect(mocks.deleteRichMenu).not.toHaveBeenCalledWith("richmenu-new");
  });

  it("既定設定が失敗し旧メニューが維持されていれば新メニューを削除すること", async () => {
    mocks.setDefaultRichMenu.mockRejectedValue(new Error("rejected"));
    mocks.getDefaultRichMenuId.mockResolvedValue({ richMenuId: "richmenu-old" });

    const result = await richMenu.registerDefault(params);

    expect(result.success).toBe(false);
    expect(mocks.deleteRichMenu).toHaveBeenCalledWith("richmenu-new");
  });
});
