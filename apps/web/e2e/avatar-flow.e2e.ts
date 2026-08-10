import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";

const avatarId = "00000000-0000-4000-8000-000000000002";

test("画像を確認して保存し、現在のアバターへ即時反映する", async ({ page }) => {
  let state: { currentAvatar: { id: string; imageUrl: string } | null } = {
    currentAvatar: null,
  };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/avatar/images/")) {
      await route.fulfill({ contentType: "image/webp", body: Buffer.from([82, 73, 70, 70]) });
      return;
    }
    if (pathname === "/api/avatar" && request.method() === "POST") {
      state = {
        currentAvatar: { id: avatarId, imageUrl: `/api/avatar/images/${avatarId}` },
      };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(state) });
      return;
    }
    if (pathname === "/api/avatar" && request.method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(state) });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  await page.goto("/profile");
  await page.getByRole("button", { name: /アバターを設定/ }).click();

  const modal = page.getByRole("dialog", { name: "アバター画像を選ぶ" });
  await expect(modal).toBeVisible();
  const save = modal.getByRole("button", { name: "保存" });
  await expect(save).toBeDisabled();
  await modal.getByLabel("アバター用の画像ファイルを選ぶ").setInputFiles({
    name: "selfie.png",
    mimeType: "image/png",
    buffer: Buffer.from([137, 80, 78, 71]),
  });
  await expect(modal.getByRole("img", { name: "保存するアバター画像のプレビュー" })).toBeVisible();
  await expect(save).toBeEnabled();
  await save.click();

  await expect(page.getByRole("button", { name: /アバターを変更/ })).toContainText("設定済み");
  await expect(modal).toHaveCount(0);
});
