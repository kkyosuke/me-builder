import { expect, test } from "@playwright/test";

type LiffE2eState = {
  initCalls: number;
  initStartedPathnames: string[];
  initialized: boolean;
  loginCalls: number;
  restoredPathname: string | null;
  urlChangedBeforeRestore: boolean;
};

test("LIFF初期化を一度だけ行い、初期化後に復元された画面を表示する", async ({ page }) => {
  await page.addInitScript(() => {
    const e2eWindow = window as Window & {
      __LIFF_E2E_CONFIG__?: { initializationDelayMilliseconds: number };
    };
    e2eWindow.__LIFF_E2E_CONFIG__ = { initializationDelayMilliseconds: 800 };
  });
  await page.route("**/api/avatar", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ currentAvatar: null, job: null }),
    });
  });

  const restoredPathname = "/compatibility/invitations/demo";
  await page.goto(`/?liff.state=${encodeURIComponent(restoredPathname)}`);

  await expect(page.getByText("LINEとの接続を準備しています...")).toBeVisible();
  await expect(page.getByRole("button", { name: "プロフィールを開く" })).toHaveCount(0);
  expect(await page.evaluate(() => window.location.pathname)).toBe("/");

  await expect(page.getByRole("heading", { name: "2人の相性を見てみませんか？" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${restoredPathname}$`));

  const liffState = await page.evaluate(() => {
    const e2eWindow = window as Window & { __LIFF_E2E_STATE__?: LiffE2eState };
    return e2eWindow.__LIFF_E2E_STATE__;
  });
  expect(liffState).toEqual({
    initCalls: 1,
    initStartedPathnames: ["/"],
    initialized: true,
    loginCalls: 0,
    restoredPathname,
    urlChangedBeforeRestore: false,
  });
});
