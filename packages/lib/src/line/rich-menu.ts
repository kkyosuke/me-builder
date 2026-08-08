import type { messagingApi } from "@line/bot-sdk";
import { logger } from "@me-builder/shared";
import { client } from "./client";

const MENU_WIDTH = 2500;
const MENU_HEIGHT = 843;

export type RegisterDefaultRichMenuParams = {
  channelAccessToken?: string | undefined;
  /** メニューの用途と環境を表す接頭辞。旧版の特定にも使います。 */
  namePrefix: string;
  liffId?: string | undefined;
  image: Blob;
};

export type RegisterDefaultRichMenuResult = {
  success: boolean;
  message: string;
  richMenuId?: string;
};

function createDefinition(name: string, liffId: string): messagingApi.RichMenuRequest {
  return {
    size: { width: MENU_WIDTH, height: MENU_HEIGHT },
    selected: true,
    name,
    chatBarText: "メニューを開く",
    areas: [
      {
        bounds: { x: 0, y: 0, width: MENU_WIDTH, height: MENU_HEIGHT },
        action: {
          type: "uri",
          label: "診断を行う",
          uri: `https://liff.line.me/${liffId}`,
        },
      },
    ],
  };
}

async function createVersion(liffId: string, image: Blob): Promise<string> {
  const { name: _name, ...definition } = createDefinition("", liffId);
  const definitionBytes = new TextEncoder().encode(JSON.stringify(definition));
  const imageBytes = new Uint8Array(await image.arrayBuffer());
  const versionSource = new Uint8Array(definitionBytes.byteLength + imageBytes.byteLength);
  versionSource.set(definitionBytes);
  versionSource.set(imageBytes, definitionBytes.byteLength);
  const digest = await crypto.subtle.digest("SHA-256", versionSource);
  return Array.from(new Uint8Array(digest).slice(0, 6), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function hasRichMenuImage(
  blobClient: messagingApi.MessagingApiBlobClient,
  richMenuId: string,
): Promise<boolean> {
  try {
    const imageStream = await blobClient.getRichMenuImage(richMenuId);
    imageStream.destroy();
    return true;
  } catch (error) {
    logger.warn(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      `[LINE Rich Menu] 既存メニューの画像を確認できないため再作成します: ${richMenuId}`,
    );
    return false;
  }
}

const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * 「診断を行う」1ボタンのリッチメニューを作成し、全ユーザーの既定値にします。
 *
 * 同じ設定版と画像が登録済みなら再利用します。新しい版を既定値にした後、同じ接頭辞を持つ
 * 旧版だけを削除するため、preview / production や他用途のメニューには触れません。
 */
async function registerDefault(
  params: RegisterDefaultRichMenuParams,
): Promise<RegisterDefaultRichMenuResult> {
  const { channelAccessToken, liffId, image, namePrefix } = params;

  if (!channelAccessToken || !liffId) {
    const message =
      "[LINE Rich Menu] LINE_CHANNEL_ACCESS_TOKEN または LIFF_ID が設定されていないため自動登録をスキップします。";
    logger.info(message);
    return { success: false, message };
  }

  const apiClient = client.create(channelAccessToken);
  const blobClient = client.createBlob(channelAccessToken);
  const version = await createVersion(liffId, image);
  const name = `${namePrefix}-${version}`;
  let createdRichMenuId: string | undefined;
  let canDeleteCreatedMenu = true;

  try {
    const listed = await apiClient.getRichMenuList();
    const existing = listed.richmenus.find((menu) => menu.name === name);
    let richMenuId =
      existing && (await hasRichMenuImage(blobClient, existing.richMenuId))
        ? existing.richMenuId
        : undefined;

    if (!richMenuId) {
      const created = await apiClient.createRichMenu(createDefinition(name, liffId));
      richMenuId = created.richMenuId;
      createdRichMenuId = richMenuId;
      await blobClient.setRichMenuImage(richMenuId, image);
    }

    canDeleteCreatedMenu = false;
    try {
      await apiClient.setDefaultRichMenu(richMenuId);
    } catch (error) {
      const configured = await apiClient.getDefaultRichMenuId().catch(() => undefined);
      if (configured?.richMenuId !== richMenuId) {
        canDeleteCreatedMenu = configured?.richMenuId !== undefined;
        throw error;
      }
      logger.warn(
        "[LINE Rich Menu] 既定設定の応答は失敗しましたが、LINE側で設定済みであることを確認しました。",
      );
    }

    const obsoleteMenus = listed.richmenus.filter(
      (menu) => menu.name.startsWith(`${namePrefix}-`) && menu.richMenuId !== richMenuId,
    );
    for (const obsolete of obsoleteMenus) {
      try {
        await apiClient.deleteRichMenu(obsolete.richMenuId);
      } catch (error) {
        logger.warn(
          { errorName: error instanceof Error ? error.name : "UnknownError" },
          `[LINE Rich Menu] 旧版リッチメニューを削除できませんでした: ${obsolete.richMenuId}`,
        );
      }
    }

    const message = `[LINE Rich Menu] 既定リッチメニューを設定しました: ${richMenuId}`;
    logger.info(message);
    return { success: true, message, richMenuId };
  } catch (error) {
    if (createdRichMenuId && canDeleteCreatedMenu) {
      try {
        await apiClient.deleteRichMenu(createdRichMenuId);
      } catch {
        // 作成途中のメニューを可能な範囲で片付ける。元のエラーを優先して返す。
      }
    }
    const detail = toMessage(error).replaceAll(channelAccessToken, "***");
    const message = `[LINE Rich Menu] 自動登録に失敗しました: ${detail}`;
    logger.error(message);
    return { success: false, message };
  }
}

export const richMenu: {
  registerDefault: (
    params: RegisterDefaultRichMenuParams,
  ) => Promise<RegisterDefaultRichMenuResult>;
} = {
  registerDefault,
};
