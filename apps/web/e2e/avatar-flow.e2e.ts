import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";

const timestamp = "2026-08-10T00:00:00.000Z";
const jobId = "00000000-0000-4000-8000-000000000001";
const candidateId = "00000000-0000-4000-8000-000000000002";

function job(status: "generating" | "ready" | "selected") {
  return {
    id: jobId,
    status,
    errorCode: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: timestamp,
    candidates:
      status === "ready"
        ? [
            {
              id: candidateId,
              imageUrl: `/api/avatar/images/${candidateId}`,
              expiresAt: timestamp,
            },
          ]
        : [],
  };
}

test("画像を確認して送信し、生成完了後に候補をアバターへ設定する", async ({ page }) => {
  let state: {
    currentAvatar: { id: string; imageUrl: string } | null;
    job: ReturnType<typeof job> | null;
  } = {
    currentAvatar: null,
    job: null,
  };
  let avatarStateReadsAfterUpload = 0;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/avatar/images/")) {
      await route.fulfill({ contentType: "image/webp", body: Buffer.from([82, 73, 70, 70]) });
      return;
    }
    if (pathname === "/api/avatar/uploads" && request.method() === "POST") {
      state = { currentAvatar: null, job: job("generating") };
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        headers: { "Retry-After": "0.5" },
        body: JSON.stringify(state),
      });
      return;
    }
    if (pathname === "/api/avatar" && request.method() === "GET") {
      if (state.job?.status === "generating") {
        avatarStateReadsAfterUpload += 1;
        if (avatarStateReadsAfterUpload >= 1) state = { currentAvatar: null, job: job("ready") };
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(state) });
      return;
    }
    if (pathname === "/api/avatar" && request.method() === "PUT") {
      state = {
        currentAvatar: { id: candidateId, imageUrl: `/api/avatar/images/${candidateId}` },
        job: job("selected"),
      };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(state) });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  await page.goto("/profile");
  await page.getByRole("button", { name: /アバターを設定/ }).click();

  const modal = page.getByRole("dialog", { name: "アバター画像を選ぶ" });
  await expect(modal).toBeVisible();
  const submitUpload = modal.getByRole("button", { name: "この画像で候補を作る" });
  await expect(submitUpload).toBeDisabled();
  await modal.getByLabel("アバター用の画像ファイルを選ぶ").setInputFiles({
    name: "selfie.png",
    mimeType: "image/png",
    buffer: Buffer.from([137, 80, 78, 71]),
  });
  await expect(modal.getByRole("img", { name: "送信する画像のプレビュー" })).toBeVisible();
  await expect(submitUpload).toBeEnabled();
  await submitUpload.click();

  await expect(page.getByRole("button", { name: /アバターを生成中/ })).toBeVisible();
  const readyButton = page.getByRole("button", { name: /候補ができました/ });
  await expect(readyButton).toBeVisible();
  await readyButton.click();

  const candidateModal = page.getByRole("dialog", { name: "候補から選ぶ" });
  await candidateModal.getByRole("button", { name: "候補1を選択" }).click();
  await candidateModal.getByRole("button", { name: "このアバターに設定" }).click();

  await expect(page.getByRole("button", { name: /アバターを変更/ })).toContainText("設定済み");
  await expect(page.getByRole("dialog", { name: "候補から選ぶ" })).toHaveCount(0);
});
